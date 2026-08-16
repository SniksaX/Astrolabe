import { createHash } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import type { Database } from '@astrolabe/db-core';
import { withUserScope } from '@astrolabe/db-core';
import { inferenceClient } from '@astrolabe/inference';
import type { Document, SourceType } from '@astrolabe/shared-types';
import type { Block } from '@astrolabe/shared-types';
import { db } from '../../db.js';
import { HttpError } from '../../lib/httpError.js';
import { PostgresPrivateEmbeddingCache, PostgresPublicEmbeddingCache } from './cache/embeddingCache.js';
import { chunkBlocks } from './chunker.js';
import { ingestionConfig } from './config.js';
import {
  ExtractionError,
  extractDocx,
  extractPdf,
  extractWebPage,
} from './extractors/index.js';
import { PostgresIngestQueue } from './queue.js';
import type { IngestJobHandle } from './queue.js';
import { readUpload, removeUpload, saveUpload, sha256Hex } from './storage.js';

interface DocumentRow {
  id: string;
  owner_id: string;
  source_type: SourceType;
  source_url: string | null;
  title: string;
  status: Document['status'];
  failure_reason: string | null;
  content_hash: string;
  storage_path: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface CreateDocumentOptions {
  /** Raw upload bytes — persisted to UPLOAD_DIR and linked via storage_path. */
  fileBytes?: Buffer;
  originalName?: string;
}

function mapDocument(row: DocumentRow): Document {
  return {
    id: row.id,
    ownerId: row.owner_id,
    sourceType: row.source_type,
    sourceUrl: row.source_url,
    title: row.title,
    status: row.status,
    failureReason: row.failure_reason,
    contentHash: row.content_hash,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function toVectorLiteral(embedding: readonly number[]): string {
  return `[${embedding.join(',')}]`;
}

function isPrivateIp(ip: string): boolean {
  if (ip === '::1' || ip === '0:0:0:0:0:0:0:1') return true;
  if (ip.startsWith('127.') || ip.startsWith('10.') || ip.startsWith('192.168.') || ip.startsWith('169.254.')) {
    return true;
  }
  if (ip.startsWith('172.')) {
    const second = Number.parseInt(ip.split('.')[1] ?? '', 10);
    if (second >= 16 && second <= 31) return true;
  }
  return false;
}

/** Resolve hostname and reject private/link-local ranges (wireframe §5.2.2). */
async function assertPublicHttpUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new HttpError(400, 'invalid URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new HttpError(400, 'only http and https URLs are accepted');
  }
  const hostname = url.hostname;
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
    throw new HttpError(400, 'private addresses are rejected');
  }
  if (isIP(hostname)) {
    if (isPrivateIp(hostname)) throw new HttpError(400, 'private addresses are rejected');
    return url;
  }
  const records = await lookup(hostname, { all: true });
  if (records.length === 0 || records.some((record) => isPrivateIp(record.address))) {
    throw new HttpError(400, 'private addresses are rejected');
  }
  return url;
}

function detectUploadKind(name: string, bytes: Buffer): 'pdf' | 'docx' {
  const lower = name.toLowerCase();
  if (lower.endsWith('.docx')) return 'docx';
  if (lower.endsWith('.pdf')) return 'pdf';
  // PDF magic
  if (bytes.subarray(0, 5).toString('utf8') === '%PDF-') return 'pdf';
  // DOCX is a ZIP
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) return 'docx';
  throw new HttpError(400, 'only PDF and DOCX uploads are accepted');
}

export class DocumentIngestService {
  private readonly publicCache: PostgresPublicEmbeddingCache;
  private readonly privateCache: PostgresPrivateEmbeddingCache;
  private readonly queue: PostgresIngestQueue;

  constructor(private readonly db: Database) {
    this.publicCache = new PostgresPublicEmbeddingCache(db);
    this.privateCache = new PostgresPrivateEmbeddingCache(db);
    this.queue = new PostgresIngestQueue(db);
  }

  async createDocument(
    ownerId: string,
    sourceType: SourceType,
    sourceUrl: string | null,
    title: string,
    options: CreateDocumentOptions = {},
  ): Promise<Document> {
    if (sourceType === 'web' || sourceType === 'youtube') {
      if (!sourceUrl) throw new HttpError(400, 'sourceUrl is required');
      await assertPublicHttpUrl(sourceUrl);
    }

    let contentHash: string;
    let storagePath: string | null = null;
    let fileBytes = options.fileBytes;

    if (sourceType === 'pdf') {
      if (!fileBytes) throw new HttpError(400, 'file is required');
      detectUploadKind(options.originalName ?? title, fileBytes);
      contentHash = sha256Hex(fileBytes);
    } else if (sourceType === 'web' || sourceType === 'youtube') {
      contentHash = sha256Hex(`${sourceType}:${sourceUrl}`);
    } else {
      contentHash = sha256Hex(`${sourceType}:${title}:${sourceUrl ?? ''}:${Date.now()}`);
    }

    const document = await withUserScope(this.db, ownerId, async (client) => {
      const { rows } = await client.query<DocumentRow>(
        `INSERT INTO documents (owner_id, source_type, source_url, title, status, content_hash, storage_path)
         VALUES ($1, $2, $3, $4, 'pending', $5, NULL)
         RETURNING *`,
        [ownerId, sourceType, sourceUrl, title, contentHash],
      );
      const row = rows[0];
      if (!row) throw new Error('failed to insert document');
      return mapDocument(row);
    });

    if (fileBytes) {
      storagePath = await saveUpload(document.id, fileBytes, options.originalName ?? title);
      await withUserScope(this.db, ownerId, async (client) => {
        await client.query(`UPDATE documents SET storage_path = $2, updated_at = now() WHERE id = $1`, [
          document.id,
          storagePath,
        ]);
      });
    }

    const job = await this.queue.enqueue(document.id);
    // Process in-process so upload works without a separate worker; worker.ts
    // still drains any leftover pending jobs after a crash.
    try {
      await this.processJob(job);
      await this.queue.markCompleted(job.id);
    } catch (err) {
      await this.queue.markFailed(job.id, err instanceof Error ? err.message : String(err));
    }

    const refreshed = await this.getDocument(ownerId, document.id);
    return refreshed ?? document;
  }

  async processJob(job: IngestJobHandle): Promise<void> {
    const meta = await this.db.pool.query<DocumentRow>(`SELECT * FROM documents WHERE id = $1`, [job.documentId]);
    const row = meta.rows[0];
    if (!row) throw new Error(`document ${job.documentId} not found`);

    await withUserScope(this.db, row.owner_id, async (client) => {
      await client.query(`UPDATE documents SET status = 'processing', updated_at = now() WHERE id = $1`, [
        row.id,
      ]);
    });

    try {
      const blocks = await this.extractBlocks(row);
      const drafts = chunkBlocks(blocks, row.title);
      if (drafts.length === 0) {
        throw new ExtractionError('web_no_main_content', 'no extractable text');
      }

      const texts = drafts.map((draft) =>
        draft.contextPrefix ? `${draft.contextPrefix}\n\n${draft.content}` : draft.content,
      );
      const vectors = await this.embedTexts(row, texts);

      await withUserScope(this.db, row.owner_id, async (client) => {
        await client.query('DELETE FROM document_chunks WHERE document_id = $1', [row.id]);
        for (let i = 0; i < drafts.length; i++) {
          const draft = drafts[i]!;
          const vector = vectors[i]!;
          const anchor = draft.anchor;
          await client.query(
            `INSERT INTO document_chunks (
               document_id, owner_id, chunk_index, content, context_prefix,
               anchor_kind, anchor_start_sec, anchor_end_sec, anchor_page, anchor_section, embedding
             ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::vector)`,
            [
              row.id,
              row.owner_id,
              draft.chunkIndex,
              draft.content,
              draft.contextPrefix,
              anchor.kind,
              anchor.kind === 'timestamp' ? anchor.startSec : null,
              anchor.kind === 'timestamp' ? anchor.endSec : null,
              anchor.kind === 'page' ? anchor.page : null,
              anchor.kind === 'section' ? anchor.section : null,
              toVectorLiteral(vector),
            ],
          );
        }
        await client.query(
          `UPDATE documents SET status = 'ready', failure_reason = NULL, updated_at = now() WHERE id = $1`,
          [row.id],
        );
      });

      await removeUpload(row.storage_path);
      if (row.storage_path) {
        await withUserScope(this.db, row.owner_id, async (client) => {
          await client.query(`UPDATE documents SET storage_path = NULL WHERE id = $1`, [row.id]);
        });
      }
    } catch (err) {
      const failureReason = err instanceof ExtractionError ? err.reason : null;
      const message = err instanceof Error ? err.message : String(err);
      await withUserScope(this.db, row.owner_id, async (client) => {
        await client.query(
          `UPDATE documents
           SET status = 'failed', failure_reason = $2, updated_at = now()
           WHERE id = $1`,
          [row.id, failureReason ?? message.slice(0, 500)],
        );
      });
      throw err;
    }
  }

  private async extractBlocks(row: DocumentRow): Promise<Block[]> {
    if (row.source_type === 'pdf') {
      if (!row.storage_path) throw new Error('missing storage_path for upload');
      const bytes = await readUpload(row.storage_path);
      const kind = detectUploadKind(row.title, bytes);
      if (kind === 'docx') return extractDocx(bytes);
      return extractPdf(new Uint8Array(bytes));
    }

    if (row.source_type === 'web') {
      if (!row.source_url) throw new Error('missing source_url');
      const url = await assertPublicHttpUrl(row.source_url);
      const response = await fetch(url, {
        redirect: 'follow',
        signal: AbortSignal.timeout(30_000),
        headers: { 'user-agent': 'AstrolabeIngest/0.1' },
      });
      if (!response.ok) throw new ExtractionError('web_no_main_content', `fetch failed (${response.status})`);
      // Re-check final URL after redirects.
      await assertPublicHttpUrl(response.url);
      const html = await response.text();
      return extractWebPage(html, response.url);
    }

    if (row.source_type === 'youtube') {
      throw new ExtractionError('video_no_subtitles', 'YouTube transcript fetch is not wired yet');
    }

    // text: treat source_url as plain text body if present, else title-only placeholder
    const text = row.source_url ?? row.title;
    return [{ kind: 'paragraph', text, locator: { sectionPath: row.title } }];
  }

  private async embedTexts(row: DocumentRow, texts: string[]): Promise<number[][]> {
    const dim = ingestionConfig.embeddingDim;
    const batchSize = ingestionConfig.embeddingBatchSize;
    const vectors: number[][] = [];
    const usePublic = row.source_type === 'web' || row.source_type === 'youtube';

    for (const text of texts) {
      const hash = createHash('sha256').update(text).digest('hex');
      const cached = usePublic
        ? await this.publicCache.get(hash)
        : await this.privateCache.get(row.owner_id, hash);
      if (cached && cached.dim === dim) {
        vectors.push([...cached.embedding]);
        continue;
      }
      const [vector] = await inferenceClient.embed([text], { dim, batchSize });
      if (!vector) throw new Error('empty embedding response');
      vectors.push(vector);
      const payload = { embedding: vector, dim };
      if (usePublic) await this.publicCache.set(hash, payload);
      else await this.privateCache.set(row.owner_id, hash, payload);
    }
    return vectors;
  }

  async getDocument(userId: string, documentId: string): Promise<Document | null> {
    return withUserScope(this.db, userId, async (client) => {
      const { rows } = await client.query<DocumentRow>(
        `SELECT * FROM documents WHERE id = $1 AND owner_id = $2::uuid`,
        [documentId, userId],
      );
      const row = rows[0];
      return row ? mapDocument(row) : null;
    });
  }

  async listDocuments(userId: string): Promise<Document[]> {
    return withUserScope(this.db, userId, async (client) => {
      const { rows } = await client.query<DocumentRow>(
        `SELECT * FROM documents WHERE owner_id = $1::uuid ORDER BY created_at DESC`,
        [userId],
      );
      return rows.map(mapDocument);
    });
  }

  async deleteDocument(userId: string, documentId: string): Promise<void> {
    const existing = await this.getDocument(userId, documentId);
    if (!existing) throw new HttpError(404, 'document not found');
    const row = await this.db.pool.query<{ storage_path: string | null }>(
      `SELECT storage_path FROM documents WHERE id = $1 AND owner_id = $2::uuid`,
      [documentId, userId],
    );
    await withUserScope(this.db, userId, async (client) => {
      await client.query(`DELETE FROM documents WHERE id = $1 AND owner_id = $2::uuid`, [
        documentId,
        userId,
      ]);
    });
    await removeUpload(row.rows[0]?.storage_path ?? null);
  }

  /** RGPD export: called only from auth module's index.ts composition, never imports auth back. */
  async exportUserData(userId: string): Promise<Record<string, unknown>> {
    const documents = await this.listDocuments(userId);
    return { documents };
  }

  /** worker.ts's poll loop: claims one job (if any) and processes it. Returns false when the queue is empty. */
  async pollOnce(): Promise<boolean> {
    const job = await this.queue.claimNext();
    if (!job) return false;
    try {
      await this.processJob(job);
      await this.queue.markCompleted(job.id);
    } catch (err) {
      await this.queue.markFailed(job.id, err instanceof Error ? err.message : String(err));
    }
    return true;
  }
}

export const documentIngestService = new DocumentIngestService(db);

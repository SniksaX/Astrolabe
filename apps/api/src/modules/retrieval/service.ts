import type { PoolClient } from 'pg';
import type { Database } from '@astrolabe/db-core';
import { withReadOnlyUserScope } from '@astrolabe/db-core';
import { inferenceClient } from '@astrolabe/inference';
import type {
  DenseHit,
  RerankedResult,
  SearchQuery,
  SparseHit,
} from '@astrolabe/shared-types';
import { db } from '../../db.js';
import { ingestionConfig } from '../ingestion/config.js';
import { fuseResults } from './fusion.js';
import { retrievalConfig } from './config.js';

const DENSE_FETCH = 40;
const SPARSE_FETCH = 40;

export class RetrievalService {
  constructor(private readonly db: Database) {}

  /**
   * Dense KNN (HNSW, cosine) + tiered FTS (AND, then OR if empty) →
   * fuseResults() → optional TEI/LLM score() over top rerankCandidates.
   */
  async search(query: SearchQuery): Promise<RerankedResult[]> {
    const [queryVector] = await inferenceClient.embed([query.text], {
      dim: ingestionConfig.embeddingDim,
      batchSize: ingestionConfig.embeddingBatchSize,
    });
    if (!queryVector) return [];

    const vectorLiteral = `[${queryVector.join(',')}]`;

    return withReadOnlyUserScope(this.db, query.userId, async (client) => {
      const documentFilter = query.documentIds && query.documentIds.length > 0;
      // owner_id is also in every policy; keep it in SQL because the app DB
      // role may be a superuser (bypasses FORCE RLS) in local docker.
      const denseParams: unknown[] = [vectorLiteral, DENSE_FETCH, query.userId];
      let denseSql = `
        SELECT id::text AS chunk_id,
               document_id::text AS document_id,
               (embedding <=> $1::vector) AS distance
        FROM document_chunks
        WHERE embedding IS NOT NULL
          AND owner_id = $3::uuid`;
      if (documentFilter) {
        denseParams.push(query.documentIds);
        denseSql += ` AND document_id = ANY($${denseParams.length}::uuid[])`;
      }
      denseSql += `
        ORDER BY embedding <=> $1::vector
        LIMIT $2`;

      const denseResult = await client.query<{ chunk_id: string; document_id: string; distance: number }>(
        denseSql,
        denseParams,
      );

      const perDocCount = new Map<string, number>();
      const denseHits: DenseHit[] = [];
      for (const row of denseResult.rows) {
        const count = perDocCount.get(row.document_id) ?? 0;
        if (count >= retrievalConfig.maxChunksPerDocument) continue;
        perDocCount.set(row.document_id, count + 1);
        denseHits.push({
          chunkId: row.chunk_id,
          documentId: row.document_id,
          distance: Number(row.distance),
          rank: denseHits.length + 1,
        });
      }

      const sparseHits = await this.tieredFts(
        client,
        query.text,
        query.userId,
        query.documentIds,
        SPARSE_FETCH,
      );

      const fused = fuseResults(denseHits, sparseHits, {
        method: retrievalConfig.fusionMethod,
        rrfK: retrievalConfig.rrfK,
        denseWeight: retrievalConfig.denseWeight,
        ftsWeight: retrievalConfig.ftsWeight,
      });

      const limited = fused.slice(0, Math.max(query.topK, retrievalConfig.rerankCandidates));

      if (!retrievalConfig.rerankEnabled || limited.length === 0) {
        return limited.slice(0, query.topK).map((item) => ({ ...item, rerankScore: null }));
      }

      const chunkIds = limited.map((item) => item.chunkId);
      const { rows: texts } = await client.query<{ id: string; content: string }>(
        `SELECT id::text AS id, content FROM document_chunks
         WHERE id = ANY($1::uuid[]) AND owner_id = $2::uuid`,
        [chunkIds, query.userId],
      );
      const textById = new Map(texts.map((row) => [row.id, row.content]));
      const candidates = limited.map((item) => ({
        id: item.chunkId,
        text: textById.get(item.chunkId) ?? '',
      }));

      const head = candidates.slice(0, retrievalConfig.rerankCandidates);
      const orderedIds = await inferenceClient.score(query.text, head);
      if (!orderedIds) {
        return limited.slice(0, query.topK).map((item) => ({ ...item, rerankScore: null }));
      }

      const byId = new Map(limited.map((item) => [item.chunkId, item]));
      const reranked: RerankedResult[] = [];
      for (let i = 0; i < orderedIds.length; i++) {
        const id = orderedIds[i]!;
        const base = byId.get(id);
        if (!base) continue;
        reranked.push({ ...base, score: 1 / (i + 1), rerankScore: 1 / (i + 1) });
        byId.delete(id);
      }
      for (const item of limited) {
        if (byId.has(item.chunkId)) {
          reranked.push({ ...item, rerankScore: null });
          byId.delete(item.chunkId);
        }
      }
      return reranked.slice(0, query.topK);
    });
  }

  private async tieredFts(
    client: PoolClient,
    text: string,
    userId: string,
    documentIds: string[] | undefined,
    limit: number,
  ): Promise<SparseHit[]> {
    // Letters/digits only — punctuation like "?" or "c'est" must not reach
    // to_tsquery, or Postgres aborts the whole READ ONLY transaction and the
    // next statement fails with "current transaction is aborted".
    const terms = (text.match(/[\p{L}\p{N}]+/gu) ?? [])
      .map((term) => term.trim())
      .filter((term) => term.length > 0);
    if (terms.length === 0) return [];

    const andQuery = terms.join(' & ');
    const orQuery = terms.join(' | ');

    const run = async (tsQuery: string): Promise<SparseHit[]> => {
      const params: unknown[] = [tsQuery, limit, userId];
      let sql = `
        SELECT id::text AS chunk_id,
               document_id::text AS document_id,
               ts_rank(fts_vector, to_tsquery('english', $1)) AS ts_rank
        FROM document_chunks
        WHERE fts_vector @@ to_tsquery('english', $1)
          AND owner_id = $3::uuid`;
      if (documentIds && documentIds.length > 0) {
        params.push(documentIds);
        sql += ` AND document_id = ANY($${params.length}::uuid[])`;
      }
      sql += ` ORDER BY ts_rank DESC LIMIT $2`;

      // SAVEPOINT: a bad tsquery must not poison the surrounding transaction
      // (catching the JS error alone leaves the txn aborted).
      await client.query('SAVEPOINT fts_attempt');
      try {
        const { rows } = await client.query<{ chunk_id: string; document_id: string; ts_rank: number }>(sql, params);
        await client.query('RELEASE SAVEPOINT fts_attempt');
        return rows.map((row, index) => ({
          chunkId: row.chunk_id,
          documentId: row.document_id,
          tsRank: Number(row.ts_rank),
          rank: index + 1,
        }));
      } catch {
        await client.query('ROLLBACK TO SAVEPOINT fts_attempt');
        return [];
      }
    };

    const strict = await run(andQuery);
    if (strict.length > 0) return strict;
    return run(orQuery);
  }
}

export const retrievalService = new RetrievalService(db);

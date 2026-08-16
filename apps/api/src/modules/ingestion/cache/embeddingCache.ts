import type { Database } from '@astrolabe/db-core';
import { withUserScope } from '@astrolabe/db-core';

export interface CachedEmbedding {
  embedding: readonly number[];
  dim: number;
}

/**
 * Two structurally distinct caches — never merge them into one table/class:
 * public sources (YouTube/web) can share an embedding across every user who
 * ingests the same URL; private uploads must never leak across accounts, so
 * that cache is keyed by userId and lives behind Postgres RLS. Keeping them
 * as separate classes/tables makes "look up someone else's private chunk by
 * content hash" a compile-time impossibility, not a runtime check to forget.
 */
export interface PublicEmbeddingCache {
  get(contentHash: string): Promise<CachedEmbedding | null>;
  set(contentHash: string, embedding: CachedEmbedding): Promise<void>;
}

export interface PrivateEmbeddingCache {
  get(userId: string, contentHash: string): Promise<CachedEmbedding | null>;
  set(userId: string, contentHash: string, embedding: CachedEmbedding): Promise<void>;
}

function toVectorLiteral(embedding: readonly number[]): string {
  return `[${embedding.join(',')}]`;
}

export class PostgresPublicEmbeddingCache implements PublicEmbeddingCache {
  constructor(private readonly db: Database) {}

  async get(contentHash: string): Promise<CachedEmbedding | null> {
    const { rows } = await this.db.pool.query<{ embedding: string; dim: number }>(
      `SELECT embedding::text AS embedding, dim
       FROM public_embedding_cache
       WHERE content_hash = $1`,
      [contentHash],
    );
    const row = rows[0];
    if (!row) return null;
    return { embedding: parseVector(row.embedding), dim: row.dim };
  }

  async set(contentHash: string, embedding: CachedEmbedding): Promise<void> {
    await this.db.pool.query(
      `INSERT INTO public_embedding_cache (content_hash, embedding, dim)
       VALUES ($1, $2::vector, $3)
       ON CONFLICT (content_hash) DO NOTHING`,
      [contentHash, toVectorLiteral(embedding.embedding), embedding.dim],
    );
  }
}

export class PostgresPrivateEmbeddingCache implements PrivateEmbeddingCache {
  constructor(private readonly db: Database) {}

  async get(userId: string, contentHash: string): Promise<CachedEmbedding | null> {
    return withUserScope(this.db, userId, async (client) => {
      const { rows } = await client.query<{ embedding: string; dim: number }>(
        `SELECT embedding::text AS embedding, dim
         FROM private_embedding_cache
         WHERE user_id = $1 AND content_hash = $2`,
        [userId, contentHash],
      );
      const row = rows[0];
      if (!row) return null;
      return { embedding: parseVector(row.embedding), dim: row.dim };
    });
  }

  async set(userId: string, contentHash: string, embedding: CachedEmbedding): Promise<void> {
    await withUserScope(this.db, userId, async (client) => {
      await client.query(
        `INSERT INTO private_embedding_cache (user_id, content_hash, embedding, dim)
         VALUES ($1, $2, $3::vector, $4)
         ON CONFLICT (user_id, content_hash) DO NOTHING`,
        [userId, contentHash, toVectorLiteral(embedding.embedding), embedding.dim],
      );
    });
  }
}

function parseVector(literal: string): number[] {
  const trimmed = literal.replace(/^\[/, '').replace(/\]$/, '');
  if (!trimmed) return [];
  return trimmed.split(',').map((part) => Number.parseFloat(part));
}

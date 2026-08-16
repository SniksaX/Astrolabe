import type { Database } from '@astrolabe/db-core';

export interface IngestJobHandle {
  id: string;
  documentId: string;
}

export interface IngestQueue {
  enqueue(documentId: string): Promise<IngestJobHandle>;
  /** Claims one pending job for exclusive processing (worker.ts poll loop). */
  claimNext(): Promise<IngestJobHandle | null>;
  markCompleted(jobId: string): Promise<void>;
  markFailed(jobId: string, error: string): Promise<void>;
}

/** Claim via `SELECT ... FOR UPDATE SKIP LOCKED` so multiple workers can run safely. */
export class PostgresIngestQueue implements IngestQueue {
  constructor(private readonly db: Database) {}

  async enqueue(documentId: string): Promise<IngestJobHandle> {
    const { rows } = await this.db.pool.query<{ id: string; document_id: string }>(
      `INSERT INTO ingest_jobs (document_id, status)
       VALUES ($1, 'pending')
       RETURNING id, document_id`,
      [documentId],
    );
    const row = rows[0];
    if (!row) throw new Error('failed to enqueue ingest job');
    return { id: row.id, documentId: row.document_id };
  }

  async claimNext(): Promise<IngestJobHandle | null> {
    const client = await this.db.getClient();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query<{ id: string; document_id: string }>(
        `SELECT id, document_id
         FROM ingest_jobs
         WHERE status = 'pending'
         ORDER BY enqueued_at
         FOR UPDATE SKIP LOCKED
         LIMIT 1`,
      );
      const row = rows[0];
      if (!row) {
        await client.query('COMMIT');
        return null;
      }
      await client.query(
        `UPDATE ingest_jobs
         SET status = 'processing', started_at = now()
         WHERE id = $1`,
        [row.id],
      );
      await client.query('COMMIT');
      return { id: row.id, documentId: row.document_id };
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  async markCompleted(jobId: string): Promise<void> {
    await this.db.pool.query(
      `UPDATE ingest_jobs
       SET status = 'ready', finished_at = now(), error = NULL
       WHERE id = $1`,
      [jobId],
    );
  }

  async markFailed(jobId: string, error: string): Promise<void> {
    await this.db.pool.query(
      `UPDATE ingest_jobs
       SET status = 'failed', finished_at = now(), error = $2
       WHERE id = $1`,
      [jobId, error.slice(0, 2000)],
    );
  }
}

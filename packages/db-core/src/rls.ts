import type { PoolClient } from 'pg';
import type { Database } from './pool.js';

/**
 * Runs `fn` inside a transaction with `app.user_id` set via SET LOCAL, so
 * every RLS policy keyed on current_setting('app.user_id') scopes rows to
 * this user for the lifetime of the transaction only — never leaks across
 * requests via a pooled connection. Commits on success, rolls back on any
 * throw (including a throw from `fn` itself).
 */
export async function withUserScope<T>(
  db: Database,
  userId: string,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT set_config('app.user_id', $1, true)`, [userId]);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

export interface ReadOnlyUserScopeOptions {
  /** Defaults to 15000ms — matches the retrieval-path timeout audited in the source RAG services. */
  statementTimeoutMs?: number;
}

/**
 * Read-only counterpart for retrieval/analytics paths: BEGIN READ ONLY,
 * scoped to the user, bounded by a statement timeout, always rolled back
 * (there's nothing to commit) even on success — a defensive guarantee this
 * path never writes, borrowed from the audited GED/Tickets search services.
 */
export async function withReadOnlyUserScope<T>(
  db: Database,
  userId: string,
  fn: (client: PoolClient) => Promise<T>,
  options: ReadOnlyUserScopeOptions = {},
): Promise<T> {
  const statementTimeoutMs = options.statementTimeoutMs ?? 15_000;
  if (!Number.isInteger(statementTimeoutMs) || statementTimeoutMs <= 0) {
    throw new RangeError('statementTimeoutMs must be a positive integer');
  }

  const client = await db.getClient();
  try {
    await client.query('BEGIN READ ONLY');
    await client.query(`SELECT set_config('app.user_id', $1, true)`, [userId]);
    // statement_timeout's value position doesn't accept a bound parameter in
    // Postgres; safe here because statementTimeoutMs is validated above, not
    // sourced from request input.
    await client.query(`SET LOCAL statement_timeout = ${statementTimeoutMs}`);
    return await fn(client);
  } finally {
    await client.query('ROLLBACK').catch(() => undefined);
    client.release();
  }
}

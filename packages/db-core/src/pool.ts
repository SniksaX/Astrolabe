import { Pool, type PoolClient } from 'pg';

export class Database {
  readonly pool: Pool;

  constructor(databaseUrl: string) {
    this.pool = new Pool({ connectionString: databaseUrl });
  }

  async getClient(): Promise<PoolClient> {
    return this.pool.connect();
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.pool.query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Fails fast at boot if a table a module depends on hasn't been migrated
   * yet, rather than surfacing a confusing runtime error on first request.
   */
  async assertTablesExist(tableNames: readonly string[]): Promise<void> {
    const { rows } = await this.pool.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ANY($1::text[])`,
      [tableNames],
    );
    const found = new Set(rows.map((row) => row.table_name));
    const missing = tableNames.filter((name) => !found.has(name));
    if (missing.length > 0) {
      throw new Error(`missing required tables, run migrations: ${missing.join(', ')}`);
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

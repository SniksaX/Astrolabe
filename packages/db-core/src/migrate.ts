import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Pool } from 'pg';

interface MigrationFile {
  /** Relative posix path from the migrations root — unique, sortable, stable across reruns. */
  id: string;
  absolutePath: string;
}

function collectMigrations(rootDir: string): MigrationFile[] {
  const files: MigrationFile[] = [];

  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const absolutePath = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(absolutePath);
      } else if (entry.name.endsWith('.sql')) {
        const id = relative(rootDir, absolutePath).split(sep).join('/');
        files.push({ id, absolutePath });
      }
    }
  };

  walk(rootDir);
  return files.sort((a, b) => a.id.localeCompare(b.id));
}

export async function runMigrations(databaseUrl: string, migrationsDir: string): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    await pool.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
         id text PRIMARY KEY,
         applied_at timestamptz NOT NULL DEFAULT now()
       )`,
    );

    const { rows } = await pool.query<{ id: string }>('SELECT id FROM schema_migrations');
    const applied = new Set(rows.map((row) => row.id));

    for (const migration of collectMigrations(migrationsDir)) {
      if (applied.has(migration.id)) continue;

      const sql = readFileSync(migration.absolutePath, 'utf8');
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (id) VALUES ($1)', [migration.id]);
        await client.query('COMMIT');
        // eslint-disable-next-line no-console
        console.log(`applied migration: ${migration.id}`);
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`migration failed: ${migration.id} — ${(err as Error).message}`);
      } finally {
        client.release();
      }
    }
  } finally {
    await pool.end();
  }
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required');
  }
  const migrationsDir = process.argv[2] ?? 'infra/migrations';
  await runMigrations(databaseUrl, migrationsDir);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}

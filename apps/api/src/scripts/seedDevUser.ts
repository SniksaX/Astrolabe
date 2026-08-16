/**
 * Local-only helper: ensure a known account exists for development login.
 *
 *   npm run seed:dev-user -w apps/api
 *
 * Email/password overridable via DEV_USER_EMAIL / DEV_USER_PASSWORD.
 * Never use in production.
 */
import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
import { db } from '../db.js';
import { hashPassword } from '../modules/auth/passwordHash.js';
import { validatePasswordPolicy } from '../modules/auth/passwordPolicy.js';

// Prefer monorepo root .env when run from apps/api.
loadEnv({ path: resolve(process.cwd(), '../../.env') });
loadEnv();

const email = (process.env.DEV_USER_EMAIL ?? 'dev@astrolabe.local').trim().toLowerCase();
const password = process.env.DEV_USER_PASSWORD ?? 'Astrolabe-Dev-2026!';

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('seed:dev-user refused in production');
  }

  const policy = validatePasswordPolicy(password);
  if (!policy.valid) {
    throw new Error(policy.reason ?? 'password policy failed');
  }

  const passwordHash = await hashPassword(password);
  const { rows } = await db.pool.query<{ id: string }>(
    `INSERT INTO users (email, password_hash, age_confirmed, email_verified_at)
     VALUES ($1, $2, true, now())
     ON CONFLICT (email) DO UPDATE
       SET password_hash = EXCLUDED.password_hash,
           failed_attempts = 0,
           locked_until = NULL
     RETURNING id`,
    [email, passwordHash],
  );

  await db.pool.query(
    `UPDATE users
     SET failed_attempts = 0, locked_until = NULL
     WHERE email = $1`,
    [email],
  );

  console.info(
    JSON.stringify({
      ok: true,
      email,
      password,
      userId: rows[0]?.id ?? null,
      hint: 'Use these credentials on /login (dev only).',
    }),
  );
  await db.close();
}

main().catch(async (err) => {
  console.error(err);
  try {
    await db.close();
  } catch {
    /* ignore */
  }
  process.exit(1);
});

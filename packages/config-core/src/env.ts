/**
 * Fail-fast env helpers. Every helper throws at call time (import-time, in
 * practice, since config modules call these at module load) rather than
 * letting a missing/malformed value surface later as a confusing runtime
 * error — the "secure/correct by default" pattern audited in the source
 * RAG services' config.ts files.
 */

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`missing required env var: ${name}`);
  }
  return value;
}

export function optionalEnv(name: string, fallback: string): string {
  const value = process.env[name];
  return value === undefined || value === '' ? fallback : value;
}

export function requireEnvInt(name: string): number {
  const raw = requireEnv(name);
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value)) {
    throw new Error(`env var ${name} must be an integer (got ${JSON.stringify(raw)})`);
  }
  return value;
}

export function optionalEnvInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value)) {
    throw new Error(`env var ${name} must be an integer (got ${JSON.stringify(raw)})`);
  }
  return value;
}

export function optionalEnvBool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  if (raw !== 'true' && raw !== 'false') {
    throw new Error(`env var ${name} must be true|false (got ${JSON.stringify(raw)})`);
  }
  return raw === 'true';
}

/**
 * For secrets like JWT_SECRET: no default is ever allowed, and it must
 * clear a minimum length or the process refuses to boot.
 */
export function requireSecret(name: string, minLength = 32): string {
  const value = requireEnv(name);
  if (value.length < minLength) {
    throw new Error(
      `env var ${name} must be at least ${minLength} characters (got ${value.length}). ` +
        `Generate one with: node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"`,
    );
  }
  return value;
}

/**
 * For values that get interpolated directly into SQL because Postgres
 * won't accept them as a bound parameter (e.g. a full-text-search config
 * name). Must never be sourced from request input — this only guards
 * against a typo'd or malicious server-side config value.
 */
export function requireSqlIdentifier(name: string): string {
  const value = requireEnv(name);
  if (!/^[a-z_][a-z0-9_]*$/.test(value)) {
    throw new Error(
      `env var ${name} must be a safe lowercase SQL identifier (got ${JSON.stringify(value)})`,
    );
  }
  return value;
}

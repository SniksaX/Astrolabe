import { config as loadDotenv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { optionalEnv, optionalEnvInt, requireEnv } from '@astrolabe/config-core';

// Resolved relative to this file (not process.cwd()) so `.env` at the repo
// root loads correctly whether this runs via `npm run dev -w apps/api`
// (cwd = apps/api), the root `npm run dev`, or the built dist/ output.
loadDotenv({ path: join(dirname(fileURLToPath(import.meta.url)), '../../../.env') });

/**
 * Only the config every module needs regardless of which one is exercised.
 * Module-specific config (JWT secret, embedding API, ...) lives inside each
 * module's own config.ts and is validated there — keeps config ownership
 * aligned with module boundaries instead of one growing global object.
 */
export interface ServerConfig {
  port: number;
  nodeEnv: 'development' | 'production' | 'test';
  databaseUrl: string;
  /** Origin allowed by CORS to send credentialed requests (cookie-based auth needs an exact origin, not '*'). */
  webOrigin: string;
}

function loadServerConfig(): ServerConfig {
  const nodeEnv = optionalEnv('NODE_ENV', 'development');
  if (nodeEnv !== 'development' && nodeEnv !== 'production' && nodeEnv !== 'test') {
    throw new Error(`NODE_ENV must be development|production|test (got ${JSON.stringify(nodeEnv)})`);
  }
  return {
    port: optionalEnvInt('PORT', 4000),
    nodeEnv,
    databaseUrl: requireEnv('DATABASE_URL'),
    webOrigin: optionalEnv('WEB_ORIGIN', 'http://localhost:3000'),
  };
}

export const serverConfig = loadServerConfig();

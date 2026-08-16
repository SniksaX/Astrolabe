import { optionalEnv, optionalEnvInt, parseDurationMs, requireSecret } from '@astrolabe/config-core';

export interface AuthConfig {
  jwtSecret: string;
  jwtIssuer: string;
  jwtAudience: string;
  accessTokenTtlMs: number;
  refreshTokenTtlMs: number;
  argon2: { memoryCost: number; timeCost: number; parallelism: number };
  lockout: { maxAttempts: number; windowMinutes: number };
}

/**
 * JWT_SECRET is required at boot (no default, minimum 32 chars) because every
 * module's router pulls in requireJwt from this module — auth is the one
 * piece of config that's genuinely global, unlike e.g. EMBEDDING_API.
 */
function loadAuthConfig(): AuthConfig {
  return {
    jwtSecret: requireSecret('JWT_SECRET'),
    jwtIssuer: optionalEnv('JWT_ISSUER', 'astrolabe-api'),
    jwtAudience: optionalEnv('JWT_AUDIENCE', 'astrolabe-web'),
    accessTokenTtlMs: parseDurationMs(optionalEnv('ACCESS_TOKEN_TTL', '15m')),
    refreshTokenTtlMs: parseDurationMs(optionalEnv('REFRESH_TOKEN_TTL', '30d')),
    argon2: {
      memoryCost: optionalEnvInt('ARGON2_MEMORY_COST', 19_456),
      timeCost: optionalEnvInt('ARGON2_TIME_COST', 2),
      parallelism: optionalEnvInt('ARGON2_PARALLELISM', 1),
    },
    lockout: {
      maxAttempts: optionalEnvInt('LOCKOUT_MAX_ATTEMPTS', 10),
      windowMinutes: optionalEnvInt('LOCKOUT_WINDOW_MINUTES', 15),
    },
  };
}

export const authConfig = loadAuthConfig();

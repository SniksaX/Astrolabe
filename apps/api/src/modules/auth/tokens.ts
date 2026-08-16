import { createHash, randomBytes } from 'node:crypto';
import jwt from 'jsonwebtoken';
import type { AccountTier, JwtClaims } from '@astrolabe/shared-types';
import { authConfig } from './config.js';

export interface AccessTokenPayload {
  sub: string;
  tier: AccountTier;
}

export class InvalidTokenError extends Error {}

export function signAccessToken(payload: AccessTokenPayload): string {
  return jwt.sign(payload, authConfig.jwtSecret, {
    algorithm: 'HS256',
    issuer: authConfig.jwtIssuer,
    audience: authConfig.jwtAudience,
    expiresIn: Math.floor(authConfig.accessTokenTtlMs / 1000),
  });
}

export function verifyAccessToken(token: string): JwtClaims {
  try {
    const decoded = jwt.verify(token, authConfig.jwtSecret, {
      // Pinned explicitly — defeats alg-confusion / "alg: none" attacks.
      algorithms: ['HS256'],
      issuer: authConfig.jwtIssuer,
      audience: authConfig.jwtAudience,
    });
    if (typeof decoded === 'string') {
      throw new InvalidTokenError('unexpected string payload');
    }
    // Shape is guaranteed by signAccessToken being the sole issuer of tokens under this secret/issuer/audience.
    return decoded as JwtClaims;
  } catch (err) {
    throw new InvalidTokenError(err instanceof Error ? err.message : 'invalid token');
  }
}

export interface IssuedRefreshToken {
  /** Returned to the client once — never stored. */
  token: string;
  /** Stored in the DB; the raw token can't be recovered from it. */
  tokenHash: string;
  expiresAt: Date;
}

export function issueRefreshToken(): IssuedRefreshToken {
  const token = randomBytes(48).toString('base64url');
  return {
    token,
    tokenHash: hashRefreshToken(token),
    expiresAt: new Date(Date.now() + authConfig.refreshTokenTtlMs),
  };
}

export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

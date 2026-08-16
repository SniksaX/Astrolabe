import type { Response } from 'express';
import { authConfig } from './config.js';

export const SESSION_COOKIE = 'astrolabe_session';
export const REFRESH_COOKIE = 'astrolabe_refresh';

/**
 * astrolabe_session carries the access token — this is what apps/web's
 * middleware/layout check for presence (real verification happens here,
 * API-side, via requireJwt). astrolabe_refresh is scoped to /api/auth only:
 * no other route needs it, and the web app never reads it directly.
 */
export function setSessionCookies(res: Response, accessToken: string, refreshToken: string): void {
  const secure = process.env.NODE_ENV === 'production';
  res.cookie(SESSION_COOKIE, accessToken, {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    path: '/',
    maxAge: authConfig.accessTokenTtlMs,
  });
  res.cookie(REFRESH_COOKIE, refreshToken, {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    path: '/api/auth',
    maxAge: authConfig.refreshTokenTtlMs,
  });
}

export function clearSessionCookies(res: Response): void {
  res.clearCookie(SESSION_COOKIE, { path: '/' });
  res.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
}

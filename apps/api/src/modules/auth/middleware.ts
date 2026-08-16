import type { NextFunction, Request, Response } from 'express';
import { HttpError } from '../../lib/httpError.js';
import { SESSION_COOKIE } from './cookies.js';
import { InvalidTokenError, verifyAccessToken } from './tokens.js';

/** Accepts either a Bearer header (API clients) or the astrolabe_session cookie (browser) — same token, two ways to carry it. */
export function requireJwt(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  const bearerToken = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : undefined;
  const cookieToken = req.cookies?.[SESSION_COOKIE] as string | undefined;
  const token = bearerToken ?? cookieToken;
  if (!token) {
    next(new HttpError(401, 'missing bearer token or session cookie'));
    return;
  }
  try {
    req.auth = verifyAccessToken(token);
    next();
  } catch (err) {
    next(new HttpError(401, err instanceof InvalidTokenError ? err.message : 'invalid token'));
  }
}

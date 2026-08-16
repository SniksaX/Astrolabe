import type { NextFunction, Request, Response } from 'express';
import { HttpError } from '../lib/httpError.js';

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({ error: 'not_found', path: req.path });
}

/** Strips anything that looks like a bearer token or a DB connection string before it reaches logs. */
function redact(message: string): string {
  return message
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [redacted]')
    .replace(/postgres:\/\/[^\s]+/gi, 'postgres://[redacted]');
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- Express requires 4-arg signature to be recognized as an error handler.
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof SyntaxError && 'body' in err) {
    res.status(400).json({ error: 'malformed_json' });
    return;
  }

  const statusCode = err instanceof HttpError ? err.statusCode : 500;
  const message = err instanceof Error ? err.message : 'internal_error';
  console.error(`[error] ${req.method} ${req.path} -> ${statusCode}: ${redact(message)}`);
  res.status(statusCode).json({ error: statusCode === 500 ? 'internal_error' : message });
}

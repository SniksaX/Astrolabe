import type { Response } from 'express';
import type { ChatStreamEvent } from '@astrolabe/shared-types';

export class SseWriter {
  constructor(private readonly res: Response) {
    this.res.setHeader('content-type', 'text/event-stream');
    this.res.setHeader('cache-control', 'no-cache');
    this.res.setHeader('connection', 'keep-alive');
    this.res.flushHeaders();
  }

  send(event: ChatStreamEvent): void {
    this.res.write(`data: ${JSON.stringify(event)}\n\n`);
  }

  close(): void {
    this.res.end();
  }
}

/**
 * Tied to the response, not the request: a client that stops reading (closes
 * the tab, navigates away) fires 'close' on `res` even when `req` never
 * emits anything — this is what actually lets an abandoned stream cancel the
 * upstream LLM call instead of leaking it.
 */
export function onClientDisconnect(res: Response, onAbort: () => void): void {
  res.on('close', onAbort);
}

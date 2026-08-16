import './config.js';
import { db } from './db.js';
import { documentIngestService } from './modules/ingestion/index.js';

const POLL_INTERVAL_MS = 2000;
let shuttingDown = false;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pollLoop(): Promise<void> {
  while (!shuttingDown) {
    const didWork = await documentIngestService.pollOnce().catch((err: unknown) => {
      console.error('[worker] poll failed:', err instanceof Error ? err.message : err);
      return false;
    });
    if (!didWork) {
      await sleep(POLL_INTERVAL_MS);
    }
  }
}

function shutdown(signal: string): void {
  console.log(`${signal} received, worker shutting down`);
  shuttingDown = true;
  db.close().finally(() => process.exit(0));
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

pollLoop().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});

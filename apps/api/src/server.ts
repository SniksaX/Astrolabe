import './config.js';
import { createApp } from './app.js';
import { serverConfig } from './config.js';
import { db } from './db.js';

async function main(): Promise<void> {
  const healthy = await db.healthCheck();
  if (!healthy) {
    throw new Error('database health check failed at boot');
  }

  const app = createApp();
  const server = app.listen(serverConfig.port, () => {
    console.log(`api listening on :${serverConfig.port} (${serverConfig.nodeEnv})`);
  });

  const shutdown = (signal: string): void => {
    console.log(`${signal} received, shutting down`);
    server.close(() => {
      db.close()
        .then(() => process.exit(0))
        .catch(() => process.exit(1));
    });
    // Hard-exit fallback in case a connection never drains.
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});

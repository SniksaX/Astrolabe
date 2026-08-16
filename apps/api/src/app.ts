import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type Express } from 'express';
import { serverConfig } from './config.js';
import { authRouter } from './modules/auth/index.js';
import { conversationsRouter } from './modules/conversations/index.js';
import { generationRouter } from './modules/generation/index.js';
import { ingestionRouter } from './modules/ingestion/index.js';
import { retrievalRouter } from './modules/retrieval/index.js';
import { errorHandler, notFoundHandler } from './middlewares/errorMiddleware.js';

export function createApp(): Express {
  const app = express();

  // Cookie-based session auth needs an exact origin + credentials:true —
  // the default cors() (origin '*', no credentials) can't carry Set-Cookie
  // across the web (:3000) / api (:4000) origin split.
  app.use(cors({ origin: serverConfig.webOrigin, credentials: true }));
  app.use(cookieParser());
  app.use(express.json({ limit: '2mb' }));

  app.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  app.use('/api/auth', authRouter);
  app.use('/api/conversations', conversationsRouter);
  app.use('/api/ingestion', ingestionRouter);
  app.use('/api/retrieval', retrievalRouter);
  app.use('/api/generation', generationRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

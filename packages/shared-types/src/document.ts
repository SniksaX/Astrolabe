import type { SourceType } from './chunk.js';

export type IngestStatus = 'pending' | 'processing' | 'ready' | 'failed';

export interface Document {
  id: string;
  ownerId: string;
  sourceType: SourceType;
  sourceUrl: string | null;
  title: string;
  status: IngestStatus;
  /** Set when status is 'failed' — one of three explicit ingestion failure modes (see ADR 0006). */
  failureReason: string | null;
  contentHash: string;
  createdAt: string;
  updatedAt: string;
}

export interface IngestJob {
  id: string;
  documentId: string;
  status: IngestStatus;
  error: string | null;
  enqueuedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

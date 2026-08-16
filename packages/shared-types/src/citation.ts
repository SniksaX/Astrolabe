import type { ChunkAnchor, SourceType } from './chunk.js';

export interface Citation {
  chunkId: string;
  documentId: string;
  documentTitle: string;
  sourceType: SourceType;
  anchor: ChunkAnchor;
  snippet: string;
  score: number;
  /** Present for live websearch hits (not corpus chunks). */
  url?: string;
}

export type SourceType = 'youtube' | 'pdf' | 'web' | 'text';

/**
 * How a chunk maps back to a point in its source. YouTube chunks anchor to a
 * time range (click-to-seek); document chunks anchor to a page or heading.
 */
export type ChunkAnchor =
  | { kind: 'timestamp'; startSec: number; endSec: number }
  | { kind: 'page'; page: number }
  | { kind: 'section'; section: string | null };

export interface Chunk {
  id: string;
  documentId: string;
  chunkIndex: number;
  content: string;
  /** LLM-generated one-sentence context blurb, prepended before embedding. */
  contextPrefix: string | null;
  anchor: ChunkAnchor;
}

export type FusionMethod = 'rrf' | 'weighted';

export interface SearchQuery {
  text: string;
  userId: string;
  documentIds?: string[];
  topK: number;
}

export interface DenseHit {
  chunkId: string;
  documentId: string;
  distance: number;
  rank: number;
}

export interface SparseHit {
  chunkId: string;
  documentId: string;
  tsRank: number;
  rank: number;
}

export interface FusedResult {
  chunkId: string;
  documentId: string;
  score: number;
  denseRank: number | null;
  ftsRank: number | null;
}

export interface RerankedResult extends FusedResult {
  rerankScore: number | null;
}

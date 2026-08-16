import type { DenseHit, FusedResult, FusionMethod, SparseHit } from '@astrolabe/shared-types';

export interface FusionOptions {
  method: FusionMethod;
  rrfK?: number;
  denseWeight?: number;
  ftsWeight?: number;
}

interface MutableFusedResult {
  documentId: string;
  score: number;
  denseRank: number | null;
  ftsRank: number | null;
}

function getOrInit(scores: Map<string, MutableFusedResult>, chunkId: string, documentId: string): MutableFusedResult {
  const existing = scores.get(chunkId);
  if (existing) return existing;
  const created: MutableFusedResult = { documentId, score: 0, denseRank: null, ftsRank: null };
  scores.set(chunkId, created);
  return created;
}

function toSortedFusedResults(scores: Map<string, MutableFusedResult>): FusedResult[] {
  return [...scores.entries()]
    .map(([chunkId, entry]) => ({ chunkId, ...entry }))
    .sort((a, b) => b.score - a.score);
}

/** score = weight / (k + rank), summed per arm; a chunk missing from one arm contributes 0 from it, not a penalty. */
function fuseRrf(dense: readonly DenseHit[], sparse: readonly SparseHit[], options: FusionOptions): FusedResult[] {
  const k = options.rrfK ?? 60;
  const denseWeight = options.denseWeight ?? 0.55;
  const ftsWeight = options.ftsWeight ?? 0.45;
  const scores = new Map<string, MutableFusedResult>();

  for (const hit of dense) {
    const entry = getOrInit(scores, hit.chunkId, hit.documentId);
    entry.score += denseWeight / (k + hit.rank);
    entry.denseRank = hit.rank;
  }
  for (const hit of sparse) {
    const entry = getOrInit(scores, hit.chunkId, hit.documentId);
    entry.score += ftsWeight / (k + hit.rank);
    entry.ftsRank = hit.rank;
  }
  return toSortedFusedResults(scores);
}

function minMax(values: readonly number[]): (value: number) => number {
  if (values.length === 0) return () => 0;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min;
  return (value) => (range === 0 ? 1 : (value - min) / range);
}

/** Min-max normalizes each arm's raw scores into [0,1] before a weighted sum — an alternative to RRF, selectable via config. */
function fuseWeighted(dense: readonly DenseHit[], sparse: readonly SparseHit[], options: FusionOptions): FusedResult[] {
  const denseWeight = options.denseWeight ?? 0.55;
  const ftsWeight = options.ftsWeight ?? 0.45;

  const denseWithRaw = dense.map((hit) => ({ hit, raw: 1 - hit.distance }));
  const sparseWithRaw = sparse.map((hit) => ({ hit, raw: hit.tsRank }));
  const normalizeDense = minMax(denseWithRaw.map((d) => d.raw));
  const normalizeFts = minMax(sparseWithRaw.map((d) => d.raw));

  const scores = new Map<string, MutableFusedResult>();
  for (const { hit, raw } of denseWithRaw) {
    const entry = getOrInit(scores, hit.chunkId, hit.documentId);
    entry.score += denseWeight * normalizeDense(raw);
    entry.denseRank = hit.rank;
  }
  for (const { hit, raw } of sparseWithRaw) {
    const entry = getOrInit(scores, hit.chunkId, hit.documentId);
    entry.score += ftsWeight * normalizeFts(raw);
    entry.ftsRank = hit.rank;
  }
  return toSortedFusedResults(scores);
}

export function fuseResults(
  dense: readonly DenseHit[],
  sparse: readonly SparseHit[],
  options: FusionOptions,
): FusedResult[] {
  return options.method === 'rrf' ? fuseRrf(dense, sparse, options) : fuseWeighted(dense, sparse, options);
}

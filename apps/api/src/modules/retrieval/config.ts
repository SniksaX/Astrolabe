import { optionalEnv, optionalEnvBool, optionalEnvInt } from '@astrolabe/config-core';
import type { FusionMethod } from '@astrolabe/shared-types';

export interface RetrievalConfig {
  /**
   * Explicit on/off switch, default false (ADR 0004: reranking is disabled
   * by default). When enabled, RetrievalService calls inferenceClient.score()
   * which prefers RERANKER_API_URL (TEI) when set, else INFERENCE_MODEL_JUDGE.
   */
  rerankEnabled: boolean;
  rerankCandidates: number;
  fusionMethod: FusionMethod;
  rrfK: number;
  denseWeight: number;
  ftsWeight: number;
  maxChunksPerDocument: number;
}

function loadRetrievalConfig(): RetrievalConfig {
  const fusionMethod = optionalEnv('FUSION_METHOD', 'rrf');
  if (fusionMethod !== 'rrf' && fusionMethod !== 'weighted') {
    throw new Error(`FUSION_METHOD must be rrf|weighted (got ${JSON.stringify(fusionMethod)})`);
  }
  return {
    rerankEnabled: optionalEnvBool('RERANK_ENABLED', false),
    rerankCandidates: optionalEnvInt('RERANK_CANDIDATES', 50),
    fusionMethod,
    rrfK: optionalEnvInt('RRF_K', 60),
    denseWeight: Number.parseFloat(optionalEnv('DENSE_WEIGHT', '0.55')),
    ftsWeight: Number.parseFloat(optionalEnv('FTS_WEIGHT', '0.45')),
    maxChunksPerDocument: optionalEnvInt('MAX_CHUNKS_PER_DOCUMENT', 3),
  };
}

export const retrievalConfig = loadRetrievalConfig();

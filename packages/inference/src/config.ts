import { optionalEnv, optionalEnvBool } from '@astrolabe/config-core';

export interface InferenceConfig {
  apiUrl: string;
  apiKey: string;
  modelGeneration: string;
  modelJudge: string;
  embeddingApiUrl: string;
  embeddingModel: string;
  /**
   * Optional TEI-compatible reranker base URL (POST /rerank). When set,
   * InferenceClient.score() prefers it over the LLM-judge path (ADR 0004
   * addendum: TEI remains a reversible evolution behind the same call site).
   */
  rerankerApiUrl: string;
}

/**
 * Unconfigured/blank values are valid at boot — each method validates its
 * own URL lazily at call time (same "not exercised by every request"
 * rationale as apps/api/src/modules/ingestion/config.ts previously used for
 * embeddings alone). Named after the capability (INFERENCE_*), not a
 * specific provider: cahier des charges §4.6 acts an interchangeable
 * provider by configuration — dev on a local server, prod on an EU-hosted
 * provider — a name like LLAMA_CPP_API would make that swap invisible in
 * the one place it needs to stay visible.
 */
function loadInferenceConfig(): InferenceConfig {
  const useExternalAi = optionalEnvBool('USE_EXTERNAL_AI', true);
  return {
    apiUrl: useExternalAi ? optionalEnv('INFERENCE_API_URL', '') : '',
    apiKey: optionalEnv('INFERENCE_API_KEY', ''),
    modelGeneration: optionalEnv('INFERENCE_MODEL_GENERATION', ''),
    // Cheapest/fastest model in the catalogue, distinct from generation
    // (ADR 0004) — used only by score()'s LLM-judge reranking when no TEI
    // reranker URL is configured.
    modelJudge: optionalEnv('INFERENCE_MODEL_JUDGE', ''),
    // Separate from apiUrl on purpose: the embedding model is typically
    // served by a distinct process (different port in .env.example) even
    // when the chat/judge model comes from an EU-hosted provider.
    embeddingApiUrl: optionalEnv('EMBEDDING_API_URL', ''),
    embeddingModel: optionalEnv('EMBEDDING_MODEL', 'text-embedding-3-small'),
    rerankerApiUrl: optionalEnv('RERANKER_API_URL', ''),
  };
}

export const inferenceConfig = loadInferenceConfig();

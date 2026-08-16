import { optionalEnvInt } from '@astrolabe/config-core';

export interface IngestionConfig {
  /** Expected embedding vector dimension — validated by InferenceClient.embed at call time. */
  embeddingDim: number;
  embeddingBatchSize: number;
}

/**
 * embeddingApiUrl/embeddingModel now live in packages/inference's own config
 * (shared with score()/stream()) — this module only keeps the settings that
 * are its own concern: how many texts to batch per call, and the dimension
 * it expects back to validate against document_chunks' vector(1024) column.
 */
function loadIngestionConfig(): IngestionConfig {
  return {
    embeddingDim: optionalEnvInt('EMBEDDING_MODEL_DIM', 1024),
    embeddingBatchSize: optionalEnvInt('EMBEDDING_BATCH_SIZE', 32),
  };
}

export const ingestionConfig = loadIngestionConfig();

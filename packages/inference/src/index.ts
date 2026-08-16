export { InferenceError } from './errors.js';
export { inferenceConfig, type InferenceConfig } from './config.js';
export {
  InferenceClient,
  type EmbedOptions,
  type ScoreCandidate,
  type ScoreOptions,
  type InferenceChatMessage,
  type StreamOptions,
  type InferenceStreamEvent,
  type CompleteOptions,
  type CompleteResult,
} from './client.js';

import { inferenceConfig } from './config.js';
import { InferenceClient } from './client.js';

export const inferenceClient = new InferenceClient(inferenceConfig);

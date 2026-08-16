import { optionalEnvInt } from '@astrolabe/config-core';
import type { EffortTier } from '@astrolabe/shared-types';

export interface EffortSettings {
  maxTokens: number;
  decompose: boolean;
  retrievalTopK: number;
  /** Multiplier applied to CONTEXT_CHAR_BUDGET for this tier. */
  contextBudgetMultiplier: number;
  /** Hard cap on citations packed into the final prompt. */
  maxCitations: number;
  /** Max characters of body text per excerpt (after optional prefix). */
  maxExcerptChars: number;
  /** Soft cap of chunks kept per document when packing. */
  maxChunksPerDocument: number;
  /**
   * off — never think (low).
   * optional — client `thinking` flag (medium / high).
   * on — always think (unused; high uses optional so CoT is not forced).
   */
  thinking: 'off' | 'optional' | 'on';
  /** High: reflect on retrieved context and optionally re-run search. */
  agentic: boolean;
  maxAgentRounds: number;
  /** Medium/high: when history exists, detect ambiguity and ask with options. */
  clarifyCheck: boolean;
  /** Minimum tokens reserved for the visible answer when thinking is on. */
  answerTokenFloor: number;
}

/** One knob controlling latency vs. quality — "quick answer" vs. "deep study mode". */
export const EFFORT_CONFIGS: Record<EffortTier, EffortSettings> = {
  low: {
    maxTokens: 512,
    decompose: false,
    retrievalTopK: 5,
    contextBudgetMultiplier: 0.4,
    maxCitations: 4,
    maxExcerptChars: 600,
    maxChunksPerDocument: 2,
    thinking: 'off',
    agentic: false,
    maxAgentRounds: 0,
    clarifyCheck: false,
    answerTokenFloor: 256,
  },
  medium: {
    maxTokens: 1024,
    decompose: true,
    retrievalTopK: 8,
    contextBudgetMultiplier: 0.7,
    maxCitations: 6,
    maxExcerptChars: 700,
    maxChunksPerDocument: 2,
    thinking: 'optional',
    agentic: false,
    maxAgentRounds: 0,
    clarifyCheck: true,
    answerTokenFloor: 512,
  },
  high: {
    maxTokens: 1536,
    decompose: true,
    retrievalTopK: 10,
    contextBudgetMultiplier: 0.9,
    maxCitations: 8,
    maxExcerptChars: 700,
    maxChunksPerDocument: 2,
    thinking: 'optional',
    agentic: true,
    maxAgentRounds: 1,
    clarifyCheck: true,
    answerTokenFloor: 768,
  },
};

export interface GenerationConfig {
  contextCharBudget: number;
}

function loadGenerationConfig(): GenerationConfig {
  return {
    contextCharBudget: optionalEnvInt('CONTEXT_CHAR_BUDGET', 12_000),
  };
}

export const generationConfig = loadGenerationConfig();

import type { Citation } from './citation.js';

export type ChatRole = 'user' | 'assistant';
export type EffortTier = 'low' | 'medium' | 'high';

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

/** Per-request sampling / retrieval overrides (llama.cpp OpenAI-compatible). */
export interface ChatGenerationOptions {
  temperature?: number;
  /** Sampling top-k (llama.cpp). */
  topK?: number;
  topP?: number;
  minP?: number;
  repeatPenalty?: number;
  maxTokens?: number;
  /** Corpus retrieval top-k override (dense+FTS pipeline). */
  retrievalTopK?: number;
}

/** Relative trust when both corpus RAG and web search contribute context. */
export interface SourceWeights {
  rag: number;
  web: number;
}

export interface ChatRequest {
  userId: string;
  message: string;
  history: ChatMessage[];
  documentIds?: string[];
  effort: EffortTier;
  /** When true, live web snippets may augment (or replace empty) corpus context. */
  webSearch?: boolean;
  /**
   * When false, skip corpus retrieval entirely (web-only research).
   * Omitted or true → RAG on (default).
   */
  useRag?: boolean;
  /**
   * Medium/high: opt into Qwen thinking (`reasoning_content`) via gear checkbox.
   * Low ignores; high no longer forces thinking (agentic loop is independent).
   */
  thinking?: boolean;
  generation?: ChatGenerationOptions;
  /** Applied when both useRag and webSearch are active; normalized server-side. */
  sourceWeights?: SourceWeights;
  /** Persist turns into this conversation; created server-side when omitted. */
  conversationId?: string;
  /** Correlation id for structured chat logs (set by the controller). */
  requestId?: string;
}

export type ChatStreamEvent =
  | { kind: 'conversation'; conversationId: string; title: string | null }
  | { kind: 'status'; step: string; label: string }
  | {
      kind: 'clarification';
      question: string;
      options: string[];
    }
  | { kind: 'sub_queries'; queries: string[] }
  | { kind: 'citations'; citations: Citation[] }
  | { kind: 'reasoning'; delta: string }
  | { kind: 'content'; delta: string }
  | { kind: 'done' }
  | { kind: 'error'; message: string };

export type QuestionType = 'multiple_choice' | 'short_answer';

export interface QuizQuestion {
  id: string;
  prompt: string;
  type: QuestionType;
  choices: string[] | null;
  answer: string;
  citations: Citation[];
}

export interface Quiz {
  id: string;
  documentId: string;
  questions: QuizQuestion[];
}

export interface Flashcard {
  id: string;
  documentId: string;
  front: string;
  back: string;
  citations: Citation[];
}

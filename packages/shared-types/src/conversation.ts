import type { ChatRole } from './generation.js';
import type { ChatGenerationOptions, EffortTier } from './generation.js';

export interface ConversationSettings {
  effort?: EffortTier;
  thinking?: boolean;
  webSearch?: boolean;
  useRag?: boolean;
  ragWeight?: number;
  generation?: ChatGenerationOptions;
}

export interface Conversation {
  id: string;
  ownerId: string;
  title: string | null;
  createdAt: string;
  /** Latest message timestamp when available (list endpoint). */
  updatedAt?: string;
  /** Last chat UI config for this conversation. */
  settings?: ConversationSettings;
}

export type MessageInputKind = 'text' | 'voice';

/** Display citation stored on the message (survives web hits + deleted chunks). */
export interface MessageCitationSnapshot {
  documentTitle: string;
  snippet: string;
  url?: string;
  chunkId?: string;
  documentId?: string;
  score?: number;
}

export interface MessageClarification {
  question: string;
  options: string[];
}

export interface Message {
  id: string;
  conversationId: string;
  /** Denormalized (same rationale as `document_chunks.ownerId`): RLS filters without a join. */
  ownerId: string;
  role: ChatRole;
  content: string;
  inputKind: MessageInputKind;
  /** Which model produced this message — null for 'user' role. */
  model: string | null;
  /** Feeds the cost chapter (C29) — null for 'user' role. */
  tokenCount: number | null;
  createdAt: string;
  /** Model thinking / CoT (assistant). */
  reasoning?: string | null;
  /** Pipeline status labels (Étapes). */
  activity?: string[];
  /** Citations as shown in the UI (corpus + web). */
  citations?: MessageCitationSnapshot[];
  /** Clarification UI payload when this turn asked the user to choose. */
  clarification?: MessageClarification | null;
}

/**
 * Composite key (messageId, chunkId), no surrogate id — a message can't cite
 * the same chunk twice. Deliberately not denormalizing documentTitle/anchor/
 * snippet here: those live on document_chunks/documents already, a join at
 * read time is enough. Consequence (documented in docs/journal.md and
 * docs/ModelisationAstrolabe.html): deleting a document cascades to its
 * chunks, which cascades to any citation pointing at them — the historical
 * message keeps its text, but loses that citation. The UI must show this
 * explicitly (e.g. "source removed") rather than silently rendering fewer
 * citations than the message originally had.
 *
 * Prefer `Message.citations` (citations_json snapshot) for UI reload; this
 * table remains the referential link for corpus chunks that still exist.
 */
export interface MessageCitation {
  messageId: string;
  chunkId: string;
  rank: number;
  score: number;
}

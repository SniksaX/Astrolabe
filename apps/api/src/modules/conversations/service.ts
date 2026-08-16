import type { PoolClient } from 'pg';
import { withUserScope } from '@astrolabe/db-core';
import type {
  Conversation,
  ConversationSettings,
  Message,
  MessageCitationSnapshot,
  MessageClarification,
  ChatMessage,
  Citation,
} from '@astrolabe/shared-types';
import { inferenceClient, inferenceConfig } from '@astrolabe/inference';
import { db } from '../../db.js';
import { HttpError } from '../../lib/httpError.js';

interface ConversationRow {
  id: string;
  owner_id: string;
  title: string | null;
  created_at: Date;
  updated_at?: Date | null;
  settings?: unknown;
}

interface MessageRow {
  id: string;
  conversation_id: string;
  owner_id: string;
  role: 'user' | 'assistant';
  content: string;
  input_kind: 'text' | 'voice';
  model: string | null;
  token_count: number | null;
  created_at: Date;
  reasoning?: string | null;
  activity?: unknown;
  citations_json?: unknown;
  clarification?: unknown;
}

function parseSettings(raw: unknown): ConversationSettings {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
  return raw as ConversationSettings;
}

function parseStringArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((item): item is string => typeof item === 'string');
}

function parseCitationsJson(raw: unknown): MessageCitationSnapshot[] {
  if (!Array.isArray(raw)) return [];
  const out: MessageCitationSnapshot[] = [];
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue;
    const row = item as Record<string, unknown>;
    if (typeof row.documentTitle !== 'string' || typeof row.snippet !== 'string') continue;
    const snap: MessageCitationSnapshot = {
      documentTitle: row.documentTitle,
      snippet: row.snippet,
    };
    if (typeof row.url === 'string') snap.url = row.url;
    if (typeof row.chunkId === 'string') snap.chunkId = row.chunkId;
    if (typeof row.documentId === 'string') snap.documentId = row.documentId;
    if (typeof row.score === 'number') snap.score = row.score;
    out.push(snap);
  }
  return out;
}

function parseClarification(raw: unknown): MessageClarification | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const row = raw as { question?: unknown; options?: unknown };
  if (typeof row.question !== 'string') return null;
  const options = Array.isArray(row.options)
    ? row.options.filter((o): o is string => typeof o === 'string')
    : [];
  return { question: row.question, options };
}

function mapConversation(row: ConversationRow): Conversation {
  const conversation: Conversation = {
    id: row.id,
    ownerId: row.owner_id,
    title: row.title,
    createdAt: row.created_at.toISOString(),
    settings: parseSettings(row.settings),
  };
  if (row.updated_at) conversation.updatedAt = row.updated_at.toISOString();
  return conversation;
}

function mapMessage(row: MessageRow): Message {
  const message: Message = {
    id: row.id,
    conversationId: row.conversation_id,
    ownerId: row.owner_id,
    role: row.role,
    content: row.content,
    inputKind: row.input_kind,
    model: row.model,
    tokenCount: row.token_count,
    createdAt: row.created_at.toISOString(),
  };
  if (row.reasoning) message.reasoning = row.reasoning;
  const activity = parseStringArray(row.activity);
  if (activity.length > 0) message.activity = activity;
  const citations = parseCitationsJson(row.citations_json);
  if (citations.length > 0) message.citations = citations;
  const clarification = parseClarification(row.clarification);
  if (clarification) message.clarification = clarification;
  return message;
}

function citationsToSnapshot(citations: Citation[]): MessageCitationSnapshot[] {
  return citations.map((c) => {
    const snap: MessageCitationSnapshot = {
      documentTitle: c.documentTitle,
      snippet: c.snippet,
    };
    if (c.url) snap.url = c.url;
    snap.chunkId = c.chunkId;
    snap.documentId = c.documentId;
    snap.score = c.score;
    return snap;
  });
}

function titleFromMessage(message: string): string {
  const cleaned = message.replace(/\s+/g, ' ').trim();
  if (cleaned.length <= 60) return cleaned;
  return `${cleaned.slice(0, 57)}…`;
}

/** Temporary sidebar label until the first Q+A is summarized. */
const PENDING_TITLE = 'Nouvelle conversation';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MESSAGE_SELECT = `id, conversation_id, owner_id, role, content, input_kind, model, token_count, created_at,
        reasoning, activity, citations_json, clarification`;

export interface AssistantMessageMeta {
  reasoning?: string;
  activity?: string[];
  clarification?: MessageClarification | null;
}

export class ConversationService {
  async list(userId: string): Promise<Conversation[]> {
    return withUserScope(db, userId, async (client) => {
      const { rows } = await client.query<ConversationRow>(
        `SELECT c.id,
                c.owner_id,
                c.title,
                c.created_at,
                c.settings,
                coalesce(
                  (SELECT max(m.created_at) FROM messages m
                   WHERE m.conversation_id = c.id AND m.owner_id = $1::uuid),
                  c.created_at
                ) AS updated_at
         FROM conversations c
         WHERE c.owner_id = $1::uuid
         ORDER BY updated_at DESC`,
        [userId],
      );
      return rows.map(mapConversation);
    });
  }

  async create(userId: string, title: string | null = null): Promise<Conversation> {
    return withUserScope(db, userId, async (client) => {
      const { rows } = await client.query<ConversationRow>(
        `INSERT INTO conversations (owner_id, title)
         VALUES ($1::uuid, $2)
         RETURNING id, owner_id, title, created_at, created_at AS updated_at, settings`,
        [userId, title],
      );
      return mapConversation(rows[0]!);
    });
  }

  async get(userId: string, conversationId: string): Promise<Conversation | null> {
    return withUserScope(db, userId, async (client) => {
      const { rows } = await client.query<ConversationRow>(
        `SELECT id, owner_id, title, created_at, created_at AS updated_at, settings
         FROM conversations
         WHERE id = $1::uuid AND owner_id = $2::uuid`,
        [conversationId, userId],
      );
      const row = rows[0];
      return row ? mapConversation(row) : null;
    });
  }

  async getWithMessages(
    userId: string,
    conversationId: string,
  ): Promise<{ conversation: Conversation; messages: Message[] } | null> {
    return withUserScope(db, userId, async (client) => {
      const { rows: convRows } = await client.query<ConversationRow>(
        `SELECT id, owner_id, title, created_at, created_at AS updated_at, settings
         FROM conversations
         WHERE id = $1::uuid AND owner_id = $2::uuid`,
        [conversationId, userId],
      );
      const conv = convRows[0];
      if (!conv) return null;
      const { rows: msgRows } = await client.query<MessageRow>(
        `SELECT ${MESSAGE_SELECT}
         FROM messages
         WHERE conversation_id = $1::uuid AND owner_id = $2::uuid
         ORDER BY created_at ASC`,
        [conversationId, userId],
      );
      return { conversation: mapConversation(conv), messages: msgRows.map(mapMessage) };
    });
  }

  async updateSettings(
    userId: string,
    conversationId: string,
    settings: ConversationSettings,
  ): Promise<ConversationSettings> {
    return withUserScope(db, userId, async (client) => {
      await this.assertOwned(client, userId, conversationId);
      const { rows } = await client.query<{ settings: unknown }>(
        `UPDATE conversations
         SET settings = coalesce(settings, '{}'::jsonb) || $3::jsonb
         WHERE id = $1::uuid AND owner_id = $2::uuid
         RETURNING settings`,
        [conversationId, userId, JSON.stringify(settings)],
      );
      return parseSettings(rows[0]?.settings);
    });
  }

  async delete(userId: string, conversationId: string): Promise<void> {
    const existing = await this.get(userId, conversationId);
    if (!existing) throw new HttpError(404, 'conversation not found');
    await withUserScope(db, userId, async (client) => {
      await client.query(`DELETE FROM conversations WHERE id = $1::uuid AND owner_id = $2::uuid`, [
        conversationId,
        userId,
      ]);
    });
  }

  /**
   * Ensures a conversation owned by the user exists. Creates one titled from
   * the first user message when conversationId is absent.
   */
  async ensureForChat(
    userId: string,
    conversationId: string | undefined,
    _firstMessage: string,
  ): Promise<Conversation> {
    if (conversationId) {
      const existing = await this.get(userId, conversationId);
      if (!existing) throw new HttpError(404, 'conversation not found');
      return existing;
    }
    return this.create(userId, PENDING_TITLE);
  }

  async updateTitle(userId: string, conversationId: string, title: string): Promise<void> {
    const cleaned = title.replace(/\s+/g, ' ').trim().slice(0, 80);
    if (!cleaned) return;
    await withUserScope(db, userId, async (client) => {
      await client.query(
        `UPDATE conversations SET title = $3
         WHERE id = $1::uuid AND owner_id = $2::uuid`,
        [conversationId, userId, cleaned],
      );
    });
  }

  /**
   * After the first assistant reply, replace the placeholder title with a
   * short topic summary (user question + answer gist). Fail-open: keep pending.
   */
  async maybeSummarizeTitle(
    userId: string,
    conversationId: string,
    userMessage: string,
    assistantMessage: string,
  ): Promise<string | null> {
    const conv = await this.get(userId, conversationId);
    if (!conv) return null;
    const { rows } = await withUserScope(db, userId, async (client) =>
      client.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM messages
         WHERE conversation_id = $1::uuid AND owner_id = $2::uuid`,
        [conversationId, userId],
      ),
    );
    const count = Number(rows[0]?.n ?? 0);
    if (count > 2) return null;

    const result = await inferenceClient.complete(
      [
        {
          role: 'system',
          content:
            'Résume le sujet de cette conversation en français, 3 à 6 mots maximum. ' +
            'Pas de guillemets, pas de ponctuation finale, pas de phrase complète. Exemple: MongoDB fonctionnement',
        },
        {
          role: 'user',
          content:
            `Question: ${userMessage.slice(0, 300)}\n` +
            `Réponse: ${assistantMessage.slice(0, 500)}\n\nTitre:`,
        },
      ],
      { maxTokens: 32, temperature: 0.1, enableThinking: false, timeoutMs: 20_000 },
    );
    const raw = result?.content?.trim().replace(/^["«]|["»]$/g, '').split('\n')[0]?.trim() ?? '';
    const title = raw.slice(0, 60) || titleFromMessage(userMessage);
    await this.updateTitle(userId, conversationId, title);
    return title;
  }

  async listHistoryAsChatMessages(
    userId: string,
    conversationId: string,
    limit = 40,
  ): Promise<ChatMessage[]> {
    return withUserScope(db, userId, async (client) => {
      const { rows } = await client.query<{ role: 'user' | 'assistant'; content: string }>(
        `SELECT role, content
         FROM (
           SELECT role, content, created_at
           FROM messages
           WHERE conversation_id = $1::uuid AND owner_id = $2::uuid
           ORDER BY created_at DESC
           LIMIT $3
         ) recent
         ORDER BY created_at ASC`,
        [conversationId, userId, limit],
      );
      return rows.map((row) => ({ role: row.role, content: row.content }));
    });
  }

  async appendUserMessage(
    userId: string,
    conversationId: string,
    content: string,
  ): Promise<Message> {
    return withUserScope(db, userId, async (client) => {
      await this.assertOwned(client, userId, conversationId);
      const { rows } = await client.query<MessageRow>(
        `INSERT INTO messages (conversation_id, owner_id, role, content, input_kind)
         VALUES ($1::uuid, $2::uuid, 'user', $3, 'text')
         RETURNING ${MESSAGE_SELECT}`,
        [conversationId, userId, content],
      );
      // Keep placeholder until summarized after the first assistant reply.
      await client.query(
        `UPDATE conversations
         SET title = $3
         WHERE id = $1::uuid AND owner_id = $2::uuid AND (title IS NULL OR title = '')`,
        [conversationId, userId, PENDING_TITLE],
      );
      return mapMessage(rows[0]!);
    });
  }

  async appendAssistantMessage(
    userId: string,
    conversationId: string,
    content: string,
    citations: Citation[] = [],
    meta: AssistantMessageMeta = {},
  ): Promise<Message> {
    return withUserScope(db, userId, async (client) => {
      await this.assertOwned(client, userId, conversationId);
      const model = inferenceConfig.modelGeneration || null;
      const snapshot = citationsToSnapshot(citations);
      const { rows } = await client.query<MessageRow>(
        `INSERT INTO messages (
           conversation_id, owner_id, role, content, input_kind, model,
           reasoning, activity, citations_json, clarification
         )
         VALUES (
           $1::uuid, $2::uuid, 'assistant', $3, 'text', $4,
           $5, $6::jsonb, $7::jsonb, $8::jsonb
         )
         RETURNING ${MESSAGE_SELECT}`,
        [
          conversationId,
          userId,
          content,
          model,
          meta.reasoning?.trim() ? meta.reasoning : null,
          JSON.stringify(meta.activity ?? []),
          JSON.stringify(snapshot),
          meta.clarification ? JSON.stringify(meta.clarification) : null,
        ],
      );
      const message = mapMessage(rows[0]!);
      await this.insertCorpusCitations(client, userId, message.id, citations);
      return message;
    });
  }

  private async assertOwned(
    client: PoolClient,
    userId: string,
    conversationId: string,
  ): Promise<void> {
    const { rows } = await client.query<{ id: string }>(
      `SELECT id FROM conversations WHERE id = $1::uuid AND owner_id = $2::uuid`,
      [conversationId, userId],
    );
    if (!rows[0]) throw new HttpError(404, 'conversation not found');
  }

  private async insertCorpusCitations(
    client: PoolClient,
    userId: string,
    messageId: string,
    citations: Citation[],
  ): Promise<void> {
    let rank = 0;
    for (const citation of citations) {
      if (!UUID_RE.test(citation.chunkId)) continue;
      // Only persist citations that still exist for this owner (skip synthetic web ids).
      const { rows } = await client.query<{ id: string }>(
        `SELECT id FROM document_chunks WHERE id = $1::uuid AND owner_id = $2::uuid`,
        [citation.chunkId, userId],
      );
      if (!rows[0]) continue;
      rank += 1;
      await client.query(
        `INSERT INTO message_citations (message_id, chunk_id, rank, score)
         VALUES ($1::uuid, $2::uuid, $3, $4)
         ON CONFLICT DO NOTHING`,
        [messageId, citation.chunkId, rank, citation.score],
      );
    }
  }
}

export const conversationService = new ConversationService();

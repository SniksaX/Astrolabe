const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function parseError(response: Response): Promise<never> {
  let message = `request failed (${response.status})`;
  try {
    const body = (await response.json()) as { error?: string };
    if (body.error) message = body.error;
  } catch {
    // response wasn't JSON — keep the generic message
  }
  throw new ApiError(response.status, message);
}

export interface SignupInput {
  email: string;
  password: string;
  ageConfirmed: boolean;
  consentAccepted: boolean;
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface DocumentDto {
  id: string;
  ownerId: string;
  sourceType: 'youtube' | 'pdf' | 'web' | 'text';
  sourceUrl: string | null;
  title: string;
  status: 'pending' | 'processing' | 'ready' | 'failed';
  failureReason: string | null;
  contentHash: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * credentials: 'include' on every call — the API is on a different origin
 * (port 4000 vs 3000) and sets astrolabe_session/astrolabe_refresh as
 * httpOnly cookies; without this the browser won't send or store them.
 */
export async function signup(input: SignupInput): Promise<void> {
  const response = await fetch(`${API_URL}/api/auth/signup`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!response.ok) await parseError(response);
}

export async function login(input: LoginInput): Promise<void> {
  const response = await fetch(`${API_URL}/api/auth/login`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!response.ok) await parseError(response);
}

export async function logout(): Promise<void> {
  const response = await fetch(`${API_URL}/api/auth/logout`, {
    method: 'POST',
    credentials: 'include',
  });
  if (!response.ok) await parseError(response);
}

export interface MeDto {
  id: string;
  email: string;
  tier: string;
}

export async function getMe(): Promise<MeDto> {
  const response = await fetch(`${API_URL}/api/auth/me`, { credentials: 'include' });
  if (!response.ok) await parseError(response);
  return (await response.json()) as MeDto;
}

export async function listDocuments(): Promise<DocumentDto[]> {
  const response = await fetch(`${API_URL}/api/ingestion/documents`, {
    credentials: 'include',
  });
  if (!response.ok) await parseError(response);
  return (await response.json()) as DocumentDto[];
}

export async function uploadDocument(file: File): Promise<DocumentDto> {
  const body = new FormData();
  body.append('file', file);
  const response = await fetch(`${API_URL}/api/ingestion/documents/upload`, {
    method: 'POST',
    credentials: 'include',
    body,
  });
  if (!response.ok) await parseError(response);
  return (await response.json()) as DocumentDto;
}

export async function createUrlDocument(input: {
  sourceType: 'web' | 'youtube' | 'text';
  sourceUrl: string;
  title: string;
}): Promise<DocumentDto> {
  const response = await fetch(`${API_URL}/api/ingestion/documents`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!response.ok) await parseError(response);
  return (await response.json()) as DocumentDto;
}

export async function deleteDocument(id: string): Promise<void> {
  const response = await fetch(`${API_URL}/api/ingestion/documents/${id}`, {
    method: 'DELETE',
    credentials: 'include',
  });
  if (!response.ok) await parseError(response);
}

export type ChatStreamEvent =
  | { kind: 'conversation'; conversationId: string; title: string | null }
  | { kind: 'status'; step: string; label: string }
  | { kind: 'clarification'; question: string; options: string[] }
  | { kind: 'sub_queries'; queries: string[] }
  | {
      kind: 'citations';
      citations: {
        chunkId: string;
        documentId: string;
        documentTitle: string;
        snippet: string;
        score: number;
        url?: string;
      }[];
    }
  | { kind: 'reasoning'; delta: string }
  | { kind: 'content'; delta: string }
  | { kind: 'done' }
  | { kind: 'error'; message: string };

export interface ConversationDto {
  id: string;
  ownerId: string;
  title: string | null;
  createdAt: string;
  updatedAt?: string;
  settings?: {
    effort?: 'low' | 'medium' | 'high';
    thinking?: boolean;
    webSearch?: boolean;
    useRag?: boolean;
    ragWeight?: number;
    generation?: {
      temperature?: number;
      topK?: number;
      topP?: number;
      minP?: number;
      repeatPenalty?: number;
      maxTokens?: number;
      retrievalTopK?: number;
    };
  };
}

export interface MessageDto {
  id: string;
  conversationId: string;
  ownerId: string;
  role: 'user' | 'assistant';
  content: string;
  inputKind: 'text' | 'voice';
  model: string | null;
  tokenCount: number | null;
  createdAt: string;
  reasoning?: string | null;
  activity?: string[];
  citations?: { documentTitle: string; snippet: string; url?: string }[];
  clarification?: { question: string; options: string[] } | null;
}

export async function listConversations(): Promise<ConversationDto[]> {
  const response = await fetch(`${API_URL}/api/conversations`, { credentials: 'include' });
  if (!response.ok) await parseError(response);
  return (await response.json()) as ConversationDto[];
}

export async function getConversation(
  id: string,
): Promise<{ conversation: ConversationDto; messages: MessageDto[] }> {
  const response = await fetch(`${API_URL}/api/conversations/${id}`, { credentials: 'include' });
  if (!response.ok) await parseError(response);
  return (await response.json()) as { conversation: ConversationDto; messages: MessageDto[] };
}

export async function patchConversationSettings(
  id: string,
  settings: NonNullable<ConversationDto['settings']>,
): Promise<NonNullable<ConversationDto['settings']>> {
  const response = await fetch(`${API_URL}/api/conversations/${id}/settings`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(settings),
  });
  if (!response.ok) await parseError(response);
  const body = (await response.json()) as { settings: NonNullable<ConversationDto['settings']> };
  return body.settings;
}

export async function deleteConversation(id: string): Promise<void> {
  const response = await fetch(`${API_URL}/api/conversations/${id}`, {
    method: 'DELETE',
    credentials: 'include',
  });
  if (!response.ok) await parseError(response);
}

/** Consumes SSE from POST /api/generation/chat. */
export async function streamChat(
  message: string,
  onEvent: (event: ChatStreamEvent) => void,
  options: {
    conversationId?: string;
    effort?: 'low' | 'medium' | 'high';
    thinking?: boolean;
    webSearch?: boolean;
    useRag?: boolean;
    generation?: {
      temperature?: number;
      topK?: number;
      topP?: number;
      minP?: number;
      repeatPenalty?: number;
      maxTokens?: number;
      retrievalTopK?: number;
    };
    sourceWeights?: { rag: number; web: number };
  } = {},
): Promise<void> {
  const response = await fetch(`${API_URL}/api/generation/chat`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      message,
      history: [],
      effort: options.effort ?? 'medium',
      ...(options.conversationId ? { conversationId: options.conversationId } : {}),
      ...(options.thinking ? { thinking: true } : {}),
      ...(options.webSearch ? { webSearch: true } : {}),
      ...(options.useRag === false ? { useRag: false } : {}),
      ...(options.generation ? { generation: options.generation } : {}),
      ...(options.sourceWeights ? { sourceWeights: options.sourceWeights } : {}),
    }),
  });
  if (!response.ok) await parseError(response);
  if (!response.body) throw new ApiError(500, 'empty stream');

  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    const chunks = buffer.split('\n\n');
    buffer = chunks.pop() ?? '';
    for (const chunk of chunks) {
      const line = chunk
        .split('\n')
        .map((part) => part.trim())
        .find((part) => part.startsWith('data:'));
      if (!line) continue;
      const raw = line.slice(5).trim();
      if (!raw || raw === '[DONE]') continue;
      try {
        onEvent(JSON.parse(raw) as ChatStreamEvent);
      } catch {
        // skip malformed SSE frames
      }
    }
  }
}

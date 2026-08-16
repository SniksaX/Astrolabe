import { InferenceError } from './errors.js';
import type { InferenceConfig } from './config.js';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface EmbedOptions {
  /** Expected vector dimension — validated strictly, never silently accepted. */
  dim: number;
  batchSize?: number;
  maxRetries?: number;
  timeoutMs?: number;
}

interface EmbeddingApiResponse {
  data: { embedding: number[]; index: number }[];
}

export interface ScoreCandidate {
  id: string;
  text: string;
}

export interface ScoreOptions {
  timeoutMs?: number;
  /** Judge sees only this many chars per candidate — it's ranking relevance, not reading the whole chunk. */
  maxCandidateChars?: number;
}

interface ChatCompletionResponse {
  choices: { message?: { content?: string; reasoning_content?: string } }[];
}

export interface InferenceChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface StreamOptions {
  maxTokens?: number;
  temperature?: number;
  /** llama.cpp sampling — omitted keys are left to server defaults. */
  topK?: number;
  topP?: number;
  minP?: number;
  repeatPenalty?: number;
  /** When true, Qwen emits reasoning_content; surfaced as {kind:'reasoning'}. */
  enableThinking?: boolean;
  timeoutMs?: number;
}

export type InferenceStreamEvent =
  | { kind: 'delta'; content: string }
  | { kind: 'reasoning'; content: string }
  | { kind: 'done' }
  | { kind: 'error'; message: string };

export interface CompleteOptions {
  maxTokens?: number;
  temperature?: number;
  enableThinking?: boolean;
  timeoutMs?: number;
}

export interface CompleteResult {
  content: string;
  reasoning: string;
}

interface ChatCompletionChunk {
  choices: { delta?: { content?: string; reasoning_content?: string } }[];
}

/**
 * Single OpenAI-compatible client for every inference concern (ADR 0004
 * addendum, docs/journal.md): embed, score, stream, transcribe. Fail
 * philosophy differs deliberately per method — embed and transcribe are
 * required steps (throw InferenceError), score is an optional optimization
 * (returns null on any failure), stream can't silently succeed with no
 * answer so it yields an {kind:'error'} event the caller turns straight
 * into a ChatStreamEvent rather than throwing mid-generator.
 */
export class InferenceClient {
  constructor(private readonly config: InferenceConfig) {}

  async embed(texts: readonly string[], options: EmbedOptions): Promise<number[][]> {
    if (!this.config.embeddingApiUrl) {
      throw new InferenceError('embedding API is not configured (EMBEDDING_API_URL)');
    }
    const batchSize = options.batchSize ?? 32;
    const vectors: number[][] = [];
    for (let i = 0; i < texts.length; i += batchSize) {
      vectors.push(...(await this.embedBatchWithRetry(texts.slice(i, i + batchSize), options)));
    }
    return vectors;
  }

  private async embedBatchWithRetry(batch: readonly string[], options: EmbedOptions): Promise<number[][]> {
    const maxRetries = options.maxRetries ?? 3;
    let lastError: unknown;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        return await this.embedBatch(batch, options);
      } catch (err) {
        lastError = err;
        if (attempt < maxRetries - 1) {
          await sleep(250 * 2 ** attempt);
        }
      }
    }
    throw new InferenceError(
      `embedding request failed after ${maxRetries} attempts: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
    );
  }

  private async embedBatch(batch: readonly string[], options: EmbedOptions): Promise<number[][]> {
    const response = await fetch(`${this.config.embeddingApiUrl}/v1/embeddings`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: this.config.embeddingModel, input: batch }),
      signal: AbortSignal.timeout(options.timeoutMs ?? 60_000),
    });
    if (!response.ok) {
      throw new InferenceError(`embedding API responded ${response.status}`);
    }
    const payload = (await response.json()) as EmbeddingApiResponse;
    const vectors = [...payload.data].sort((a, b) => a.index - b.index).map((item) => item.embedding);
    if (vectors.length !== batch.length) {
      throw new InferenceError(`expected ${batch.length} vectors, got ${vectors.length}`);
    }
    for (const vector of vectors) {
      if (vector.length !== options.dim) {
        throw new InferenceError(`expected ${options.dim}-dim vectors, got ${vector.length}`);
      }
    }
    return vectors;
  }

  /**
   * Reranking (ADR 0004 + TEI evolution): prefers a TEI `/rerank` endpoint
   * when `RERANKER_API_URL` is set; otherwise falls back to the LLM-judge
   * chat completion. Returns candidate ids in judged order, or null on any
   * failure — callers fall back to fusion order.
   */
  async score(query: string, candidates: readonly ScoreCandidate[], options: ScoreOptions = {}): Promise<string[] | null> {
    if (candidates.length === 0) return [];
    if (this.config.rerankerApiUrl) {
      return this.scoreWithTei(query, candidates, options);
    }
    return this.scoreWithLlmJudge(query, candidates, options);
  }

  private async scoreWithTei(
    query: string,
    candidates: readonly ScoreCandidate[],
    options: ScoreOptions,
  ): Promise<string[] | null> {
    const maxCandidateChars = options.maxCandidateChars ?? 400;
    try {
      const response = await fetch(`${this.config.rerankerApiUrl}/rerank`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          query,
          texts: candidates.map((candidate) => candidate.text.slice(0, maxCandidateChars)),
          raw_scores: false,
        }),
        signal: AbortSignal.timeout(options.timeoutMs ?? 10_000),
      });
      if (!response.ok) return null;
      const payload = (await response.json()) as { index: number; score: number }[];
      if (!Array.isArray(payload)) return null;
      const ordered = [...payload].sort((a, b) => b.score - a.score);
      const ids: string[] = [];
      const seen = new Set<number>();
      for (const item of ordered) {
        if (!Number.isInteger(item.index) || item.index < 0 || item.index >= candidates.length) return null;
        if (seen.has(item.index)) continue;
        seen.add(item.index);
        ids.push(candidates[item.index]!.id);
      }
      // Append any candidates the reranker omitted, preserving original order.
      for (const candidate of candidates) {
        if (!ids.includes(candidate.id)) ids.push(candidate.id);
      }
      return ids;
    } catch {
      return null;
    }
  }

  private async scoreWithLlmJudge(
    query: string,
    candidates: readonly ScoreCandidate[],
    options: ScoreOptions,
  ): Promise<string[] | null> {
    if (!this.config.apiUrl || !this.config.modelJudge) return null;
    const maxCandidateChars = options.maxCandidateChars ?? 400;
    const listing = candidates
      .map((candidate, index) => `[${index + 1}] ${candidate.text.slice(0, maxCandidateChars)}`)
      .join('\n\n');
    const prompt =
      `Query: ${query}\n\nCandidates:\n${listing}\n\n` +
      `Return ONLY a JSON array of the candidate numbers above (1-${candidates.length}), ` +
      `ordered from most to least relevant to the query. No prose, no explanation, no per-item score.`;

    try {
      const response = await fetch(`${this.config.apiUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(this.config.apiKey ? { authorization: `Bearer ${this.config.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: this.config.modelJudge,
          temperature: 0,
          messages: [{ role: 'user', content: prompt }],
          chat_template_kwargs: { enable_thinking: false },
        }),
        signal: AbortSignal.timeout(options.timeoutMs ?? 10_000),
      });
      if (!response.ok) return null;
      const payload = (await response.json()) as ChatCompletionResponse;
      const content = payload.choices[0]?.message?.content;
      if (!content) return null;
      const order = this.parseJudgeOrder(content, candidates.length);
      if (!order) return null;
      return order.map((oneBasedIndex) => candidates[oneBasedIndex - 1]!.id);
    } catch {
      return null;
    }
  }

  private parseJudgeOrder(content: string, candidateCount: number): number[] | null {
    const match = content.match(/\[[\s\S]*\]/);
    if (!match) return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(match[0]);
    } catch {
      return null;
    }
    if (!Array.isArray(parsed)) return null;
    const seen = new Set<number>();
    for (const value of parsed) {
      if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > candidateCount) return null;
      seen.add(value);
    }
    if (seen.size !== parsed.length) return null;
    return parsed as number[];
  }

  /**
   * Streams a chat completion. Any failure (unconfigured, network, bad
   * status) yields {kind:'error'} rather than throwing — generation has no
   * fallback for "couldn't reach the model", so the caller surfaces this as
   * a ChatStreamEvent error rather than crashing the whole request.
   */
  async *stream(messages: readonly InferenceChatMessage[], options: StreamOptions = {}): AsyncGenerator<InferenceStreamEvent> {
    if (!this.config.apiUrl || !this.config.modelGeneration) {
      yield { kind: 'error', message: 'generation API is not configured (INFERENCE_API_URL / INFERENCE_MODEL_GENERATION)' };
      return;
    }

    let response: Response;
    try {
      response = await fetch(`${this.config.apiUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(this.config.apiKey ? { authorization: `Bearer ${this.config.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: this.config.modelGeneration,
          stream: true,
          messages,
          ...(options.maxTokens !== undefined ? { max_tokens: options.maxTokens } : {}),
          ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
          ...(options.topK !== undefined ? { top_k: options.topK } : {}),
          ...(options.topP !== undefined ? { top_p: options.topP } : {}),
          ...(options.minP !== undefined ? { min_p: options.minP } : {}),
          ...(options.repeatPenalty !== undefined ? { repeat_penalty: options.repeatPenalty } : {}),
          chat_template_kwargs: { enable_thinking: options.enableThinking === true },
        }),
        signal: AbortSignal.timeout(options.timeoutMs ?? 120_000),
      });
    } catch (err) {
      yield { kind: 'error', message: `generation request failed: ${err instanceof Error ? err.message : String(err)}` };
      return;
    }

    if (!response.ok || !response.body) {
      yield { kind: 'error', message: `generation API responded ${response.status}` };
      return;
    }

    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = '';
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          const data = line.startsWith('data:') ? line.slice(5).trim() : '';
          if (!data) continue;
          if (data === '[DONE]') {
            yield { kind: 'done' };
            return;
          }
          try {
            const chunk = JSON.parse(data) as ChatCompletionChunk;
            const delta = chunk.choices[0]?.delta;
            if (delta?.reasoning_content) {
              yield { kind: 'reasoning', content: delta.reasoning_content };
            }
            if (delta?.content) {
              yield { kind: 'delta', content: delta.content };
            }
          } catch {
            // Best-effort SSE parsing, consistent with the "OpenAI-compatible" contract
            // tolerating minor shape differences across providers — skip, don't abort the stream.
          }
        }
      }
      yield { kind: 'done' };
    } catch (err) {
      yield { kind: 'error', message: `generation stream interrupted: ${err instanceof Error ? err.message : String(err)}` };
    }
  }

  /**
   * Non-streaming completion for decomposition / agentic reflection.
   * Returns null on any failure (fail-open for orchestration helpers).
   */
  async complete(
    messages: readonly InferenceChatMessage[],
    options: CompleteOptions = {},
  ): Promise<CompleteResult | null> {
    if (!this.config.apiUrl || !this.config.modelGeneration) return null;
    try {
      const response = await fetch(`${this.config.apiUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(this.config.apiKey ? { authorization: `Bearer ${this.config.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: this.config.modelGeneration,
          stream: false,
          messages,
          max_tokens: options.maxTokens ?? 512,
          temperature: options.temperature ?? 0.2,
          chat_template_kwargs: { enable_thinking: options.enableThinking === true },
        }),
        signal: AbortSignal.timeout(options.timeoutMs ?? 60_000),
      });
      if (!response.ok) return null;
      const payload = (await response.json()) as ChatCompletionResponse;
      const message = payload.choices[0]?.message;
      return {
        content: message?.content ?? '',
        reasoning: message?.reasoning_content ?? '',
      };
    } catch {
      return null;
    }
  }

  /** module voice/ is deferred to J4 (docs/journal.md) — kept as a typed stub so the four-usage shape is stable now. */
  async transcribe(_audio: Blob | Buffer, _options: Record<string, never> = {}): Promise<{ text: string }> {
    throw new InferenceError('InferenceClient.transcribe: not implemented — module voice/ is deferred to J4');
  }
}

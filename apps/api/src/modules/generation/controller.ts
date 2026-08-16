import type { Request, Response } from 'express';
import type {
  ChatGenerationOptions,
  ChatRequest,
  Citation,
  EffortTier,
  SourceWeights,
} from '@astrolabe/shared-types';
import { HttpError } from '../../lib/httpError.js';
import { chatLog, newRequestId } from '../../lib/chatLog.js';
import { conversationService } from '../conversations/service.js';
import { chatOrchestrationService } from './service.js';
import { onClientDisconnect, SseWriter } from './sse.js';

function isEffortTier(value: unknown): value is EffortTier {
  return value === 'low' || value === 'medium' || value === 'high';
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function parseOptionalNumber(value: unknown, min: number, max: number): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return Math.min(max, Math.max(min, value));
}

function parseOptionalInt(value: unknown, min: number, max: number): number | undefined {
  if (typeof value !== 'number' || !Number.isInteger(value)) return undefined;
  return Math.min(max, Math.max(min, value));
}

function parseGeneration(raw: unknown): ChatGenerationOptions | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const body = raw as Record<string, unknown>;
  const generation: ChatGenerationOptions = {};
  const temperature = parseOptionalNumber(body.temperature, 0, 2);
  if (temperature !== undefined) generation.temperature = temperature;
  const topK = parseOptionalInt(body.topK, 0, 200);
  if (topK !== undefined) generation.topK = topK;
  const topP = parseOptionalNumber(body.topP, 0, 1);
  if (topP !== undefined) generation.topP = topP;
  const minP = parseOptionalNumber(body.minP, 0, 1);
  if (minP !== undefined) generation.minP = minP;
  const repeatPenalty = parseOptionalNumber(body.repeatPenalty, 0.5, 2);
  if (repeatPenalty !== undefined) generation.repeatPenalty = repeatPenalty;
  const maxTokens = parseOptionalInt(body.maxTokens, 16, 8192);
  if (maxTokens !== undefined) generation.maxTokens = maxTokens;
  const retrievalTopK = parseOptionalInt(body.retrievalTopK, 1, 50);
  if (retrievalTopK !== undefined) generation.retrievalTopK = retrievalTopK;
  return Object.keys(generation).length > 0 ? generation : undefined;
}

function parseSourceWeights(raw: unknown): SourceWeights | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const body = raw as { rag?: unknown; web?: unknown };
  if (typeof body.rag !== 'number' || typeof body.web !== 'number') return undefined;
  return { rag: clamp01(body.rag), web: clamp01(body.web) };
}

/** Thin by design: parse/validate input, call the service, shape the response — no business logic here. */
export class GenerationController {
  async chat(req: Request, res: Response): Promise<void> {
    const userId = req.auth?.sub;
    if (!userId) throw new HttpError(401, 'unauthenticated');

    const body = req.body as {
      message?: unknown;
      history?: unknown;
      documentIds?: unknown;
      effort?: unknown;
      webSearch?: unknown;
      useRag?: unknown;
      thinking?: unknown;
      generation?: unknown;
      sourceWeights?: unknown;
      conversationId?: unknown;
    };
    if (typeof body.message !== 'string' || body.message.trim().length === 0) {
      throw new HttpError(400, 'message is required');
    }
    const message = body.message.trim();
    const effort = isEffortTier(body.effort) ? body.effort : 'medium';
    const documentIds = Array.isArray(body.documentIds)
      ? body.documentIds.filter((id): id is string => typeof id === 'string')
      : undefined;
    const webSearch = body.webSearch === true;
    const useRag = body.useRag !== false;
    const thinking = body.thinking === true;
    const generation = parseGeneration(body.generation);
    const sourceWeights = parseSourceWeights(body.sourceWeights);
    const conversationId =
      typeof body.conversationId === 'string' && body.conversationId.trim()
        ? body.conversationId.trim()
        : undefined;

    const conversation = await conversationService.ensureForChat(userId, conversationId, message);
    const history = await conversationService.listHistoryAsChatMessages(userId, conversation.id);

    await conversationService.appendUserMessage(userId, conversation.id, message);
    const titled = (await conversationService.get(userId, conversation.id)) ?? conversation;
    const requestId = newRequestId();

    const request: ChatRequest = {
      userId,
      message,
      history,
      effort,
      conversationId: conversation.id,
      requestId,
      ...(documentIds ? { documentIds } : {}),
      ...(webSearch ? { webSearch: true } : {}),
      ...(useRag ? {} : { useRag: false }),
      ...(thinking ? { thinking: true } : {}),
      ...(generation ? { generation } : {}),
      ...(sourceWeights ? { sourceWeights } : {}),
    };

    const writer = new SseWriter(res);
    const abortController = new AbortController();
    onClientDisconnect(res, () => abortController.abort());

    writer.send({
      kind: 'conversation',
      conversationId: titled.id,
      title: titled.title,
    });

    let assistantContent = '';
    let citations: Citation[] = [];
    let reasoning = '';
    let activity: string[] = [];
    let clarification: { question: string; options: string[] } | null = null;

    // Persist the knobs used for this turn on the conversation.
    await conversationService.updateSettings(userId, conversation.id, {
      effort,
      thinking,
      webSearch,
      useRag,
      ...(sourceWeights ? { ragWeight: sourceWeights.rag } : {}),
      ...(generation ? { generation } : {}),
    });

    try {
      for await (const event of chatOrchestrationService.streamChat(request)) {
        if (event.kind === 'content') assistantContent += event.delta;
        if (event.kind === 'citations') citations = event.citations;
        if (event.kind === 'reasoning') reasoning += event.delta;
        if (event.kind === 'status') activity.push(event.label);
        if (event.kind === 'clarification') {
          clarification = { question: event.question, options: event.options };
        }
        writer.send(event);
        if (abortController.signal.aborted) break;
      }

      if (assistantContent.trim().length > 0 && !abortController.signal.aborted) {
        await conversationService.appendAssistantMessage(
          userId,
          conversation.id,
          assistantContent,
          citations,
          {
            ...(reasoning.trim() ? { reasoning } : {}),
            ...(activity.length > 0 ? { activity } : {}),
            ...(clarification ? { clarification } : {}),
          },
        );
        const summarized = await conversationService.maybeSummarizeTitle(
          userId,
          conversation.id,
          message,
          assistantContent,
        );
        if (summarized) {
          writer.send({
            kind: 'conversation',
            conversationId: conversation.id,
            title: summarized,
          });
        }
      }
    } catch (err) {
      chatLog('chat.error', {
        requestId,
        userId: userId.slice(0, 8),
        message: err instanceof Error ? err.message : 'stream failed',
      });
      writer.send({ kind: 'error', message: err instanceof Error ? err.message : 'stream failed' });
    } finally {
      writer.close();
    }
  }
}

export const generationController = new GenerationController();

import { inferenceClient } from '@astrolabe/inference';
import type {
  ChatRequest,
  ChatStreamEvent,
  Citation,
  ChunkAnchor,
  SourceType,
} from '@astrolabe/shared-types';
import { withReadOnlyUserScope } from '@astrolabe/db-core';
import { db } from '../../db.js';
import { chatLog } from '../../lib/chatLog.js';
import type { RetrievalService } from '../retrieval/index.js';
import { retrievalService } from '../retrieval/index.js';
import type { RerankedResult } from '@astrolabe/shared-types';
import { EFFORT_CONFIGS, generationConfig } from './config.js';
import type { DecompositionService } from './decomposition.js';
import { decompositionService } from './decomposition.js';
import { reflectOnContext } from './agentReflect.js';
import {
  compressCitationsDigest,
  deriveSections,
  looksTruncated,
  scoreExcerptForSection,
} from './contextPack.js';
import {
  detectTopicMismatch,
  filterWebHitsToTopic,
  resolveSearchQueries,
} from './queryResolve.js';
import { searchWeb, webHitIds, type WebSearchHit } from './webSearch.js';

/** Max CoT chars streamed to the client (full CoT kept server-side for continue). */
const CLIENT_REASONING_CAP = 800;
interface ChunkContextRow {
  id: string;
  document_id: string;
  content: string;
  context_prefix: string | null;
  title: string;
  source_type: SourceType;
  anchor_kind: 'timestamp' | 'page' | 'section';
  anchor_start_sec: string | null;
  anchor_end_sec: string | null;
  anchor_page: number | null;
  anchor_section: string | null;
}

function toAnchor(row: ChunkContextRow): ChunkAnchor {
  if (row.anchor_kind === 'timestamp') {
    return {
      kind: 'timestamp',
      startSec: Number(row.anchor_start_sec ?? 0),
      endSec: Number(row.anchor_end_sec ?? 0),
    };
  }
  if (row.anchor_kind === 'page') {
    return { kind: 'page', page: row.anchor_page ?? 1 };
  }
  return { kind: 'section', section: row.anchor_section };
}

function normalizeWeights(
  useRag: boolean,
  webSearchOn: boolean,
  raw: { rag: number; web: number } | undefined,
): { rag: number; web: number } {
  if (useRag && webSearchOn) {
    const rag = Number.isFinite(raw?.rag) ? Math.min(1, Math.max(0, raw!.rag)) : 0.6;
    const web = Number.isFinite(raw?.web) ? Math.min(1, Math.max(0, raw!.web)) : 0.4;
    const sum = rag + web;
    if (sum <= 0) return { rag: 0.5, web: 0.5 };
    return { rag: rag / sum, web: web / sum };
  }
  if (useRag) return { rag: 1, web: 0 };
  if (webSearchOn) return { rag: 0, web: 1 };
  return { rag: 0, web: 0 };
}

function mergeChunkHits(
  into: Map<string, { score: number; documentId: string }>,
  results: RerankedResult[],
): void {
  for (const hit of results) {
    const existing = into.get(hit.chunkId);
    if (!existing || hit.score > existing.score) {
      into.set(hit.chunkId, { score: hit.score, documentId: hit.documentId });
    }
  }
}

function mergeWebHits(into: WebSearchHit[], extra: WebSearchHit[]): WebSearchHit[] {
  const seen = new Set(into.map((hit) => hit.url));
  const out = [...into];
  for (const hit of extra) {
    if (seen.has(hit.url)) continue;
    seen.add(hit.url);
    out.push(hit);
  }
  return out;
}

function statusEvent(step: string, label: string): ChatStreamEvent {
  return { kind: 'status', step, label };
}

export class ChatOrchestrationService {
  constructor(
    private readonly retrieval: RetrievalService,
    private readonly decomposition: DecompositionService,
  ) {}

  async *streamChat(request: ChatRequest): AsyncGenerator<ChatStreamEvent> {
    const requestId = request.requestId ?? 'unknown';
    const logBase = {
      requestId,
      userId: request.userId.slice(0, 8),
      conversationId: request.conversationId ?? null,
      effort: request.effort,
    };
    const started = Date.now();
    chatLog('chat.start', { ...logBase, webSearch: request.webSearch === true, useRag: request.useRag !== false });

    const effort = EFFORT_CONFIGS[request.effort];
    const webSearchOn = request.webSearch === true;
    const useRag = request.useRag !== false;
    const gen = request.generation;
    const retrievalTopK = gen?.retrievalTopK ?? effort.retrievalTopK;
    const weights = normalizeWeights(useRag, webSearchOn, request.sourceWeights);
    const sections = deriveSections(request.message, request.history);
    const multiSection = sections.length >= 2;
    // Multi-section answers need tokens for content, not CoT.
    const enableThinking =
      !multiSection &&
      (effort.thinking === 'on' || (effort.thinking === 'optional' && request.thinking === true));
    const totalBudget = Math.floor(
      generationConfig.contextCharBudget * effort.contextBudgetMultiplier,
    );
    const requestedMax = gen?.maxTokens ?? effort.maxTokens;
    // Keep full max_tokens for the answer; prompt caps CoT length when thinking is on.
    const answerMaxTokens = requestedMax;

    if (!useRag && !webSearchOn) {
      chatLog('chat.error', { ...logBase, reason: 'no_source_channel' });
      yield {
        kind: 'error',
        message: 'Activez au moins une source : documents (RAG) ou recherche web.',
      };
      return;
    }

    const resolved = resolveSearchQueries({
      message: request.message,
      history: request.history,
    });
    chatLog('query.resolve', {
      ...logBase,
      vague: resolved.vague,
      grounded: resolved.grounded,
      rewritten: resolved.rewritten,
      topic: resolved.topic,
      searchQuery: resolved.searchQuery.slice(0, 160),
      webQuery: resolved.webQuery.slice(0, 160),
    });
    if (resolved.rewritten && resolved.topic) {
      yield statusEvent('agent', `Sujet repris de l’historique : ${resolved.topic}`);
      chatLog('agent.decision', {
        ...logBase,
        decision: 'ground_history',
        topic: resolved.topic,
      });
    }

    let queries = [resolved.searchQuery];
    let webSearchQuery = resolved.webQuery;

    if (useRag && effort.decompose) {
      yield statusEvent('decompose', 'Décomposition de la question…');
      chatLog('decompose.start', logBase);
      try {
        const decomposed = await this.decomposition.decompose(
          resolved.searchQuery,
          resolved.topic,
        );
        if (decomposed.subQueries.length > 0) queries = decomposed.subQueries;
        chatLog('decompose.end', { ...logBase, queryCount: queries.length });
      } catch {
        queries = [resolved.searchQuery];
        chatLog('decompose.error', { ...logBase, fallback: true });
      }
    }

    yield { kind: 'sub_queries', queries };

    const bestByChunk = new Map<string, { score: number; documentId: string }>();
    let webHits: WebSearchHit[] = [];

    // First retrieval round
    {
      yield statusEvent(
        'search',
        useRag && webSearchOn
          ? 'Recherche dans vos documents et sur le web…'
          : useRag
            ? 'Recherche dans vos documents…'
            : 'Recherche sur le web…',
      );
      const t0 = Date.now();
      const [perQuery, web] = await Promise.all([
        useRag
          ? Promise.all(
              queries.map((text) =>
                this.retrieval.search({
                  text,
                  userId: request.userId,
                  topK: retrievalTopK,
                  ...(request.documentIds ? { documentIds: request.documentIds } : {}),
                }),
              ),
            )
          : Promise.resolve([] as RerankedResult[][]),
        webSearchOn ? searchWeb(webSearchQuery) : Promise.resolve([] as WebSearchHit[]),
      ]);
      for (const results of perQuery) mergeChunkHits(bestByChunk, results);
      if (web.length > 0) webHits = mergeWebHits(webHits, web);
      chatLog('search.round', {
        ...logBase,
        round: 0,
        ragQueries: queries.length,
        chunkHits: bestByChunk.size,
        webHits: webHits.length,
        webQuery: webSearchQuery.slice(0, 160),
        ms: Date.now() - t0,
      });
    }

    // When the user already named the topic, drop off-topic web (e.g. CCM vs MongoDB).
    if (webSearchOn && resolved.grounded && resolved.topic) {
      const before = webHits.length;
      webHits = filterWebHitsToTopic(webHits, resolved.topic);
      if (webHits.length !== before) {
        chatLog('topic.filter_web', {
          ...logBase,
          before,
          after: webHits.length,
          topic: resolved.topic,
        });
        yield statusEvent(
          'agent',
          `Filtrage web hors sujet (conservé : ${webHits.length}/${before})`,
        );
      }
    }

    if (bestByChunk.size === 0 && webHits.length === 0) {
      chatLog('chat.error', { ...logBase, reason: 'no_hits' });
      yield {
        kind: 'error',
        message: webSearchOn && !useRag
          ? 'Aucun résultat web exploitable pour cette question.'
          : webSearchOn
            ? 'Aucune source indexée ni résultat web exploitable pour cette question.'
            : 'Aucune source indexée trouvée pour répondre à cette question.',
      };
      return;
    }

    // Deterministic topic mismatch → clarify before answering.
    const corpusTitles = await this.sampleCorpusTitles(request.userId, bestByChunk);
    const mismatch = detectTopicMismatch({
      message: request.message,
      history: request.history,
      topic: resolved.topic,
      vague: resolved.vague,
      grounded: resolved.grounded,
      corpusTitles,
      webHits,
    });
    if (mismatch.needsClarification) {
      chatLog('topic.mismatch', {
        ...logBase,
        topic: mismatch.topic,
        webDominant: mismatch.webDominantLabel,
      });
      chatLog('agent.decision', { ...logBase, decision: 'clarify_mismatch' });
      yield statusEvent('agent', 'Clarification requise (ambiguïté web / corpus)');
      const question = mismatch.clarifyingQuestion;
      const options = mismatch.options;
      yield statusEvent('clarify', 'Demande de clarification…');
      yield { kind: 'clarification', question, options };
      yield {
        kind: 'content',
        delta: `${question}\n\n${options.map((o, i) => `${i + 1}. ${o}`).join('\n')}\n${options.length + 1}. Autre…`,
      };
      yield { kind: 'done' };
      chatLog('chat.end', { ...logBase, outcome: 'clarify_mismatch', ms: Date.now() - started });
      return;
    }

    // High effort: reflect and optionally refine — or ask the user to clarify.
    // Medium: one ambiguity check when history exists (no refine loop).
    const runClarifyOnly =
      !effort.agentic && effort.clarifyCheck && request.history.length > 0;

    if (effort.agentic || runClarifyOnly) {
      const maxRounds = effort.agentic ? effort.maxAgentRounds : 1;
      for (let round = 0; round < maxRounds; round++) {
        const digest = await this.buildDigest(request.userId, bestByChunk, webHits);
        yield statusEvent('reflect', 'Évaluation des sources…');
        chatLog('reflect.start', { ...logBase, round, digestChars: digest.length });
        const reflection = await reflectOnContext({
          question: request.message,
          history: request.history,
          contextDigest: digest,
          topicMismatchHint: mismatch.mismatch,
          historyTopic: resolved.topic,
        });
        chatLog('reflect.end', {
          ...logBase,
          round,
          sufficient: reflection.sufficient,
          needsClarification: reflection.needsClarification,
          queryCount: reflection.queries.length,
        });

        if (reflection.critique) {
          // Agent decision line → status (Étapes), not CoT bucket
          yield statusEvent('agent', reflection.critique.slice(0, 240));
        }

        if (reflection.needsClarification) {
          const question =
            reflection.clarifyingQuestion ??
            'Pouvez-vous préciser votre question ?';
          const options =
            reflection.options.length > 0
              ? reflection.options
              : ['Préciser le sujet de la question'];
          yield statusEvent('clarify', 'Demande de clarification…');
          chatLog('clarify', {
            ...logBase,
            questionChars: question.length,
            optionCount: options.length,
          });
          chatLog('agent.decision', { ...logBase, decision: 'clarify' });
          yield { kind: 'clarification', question, options };
          yield {
            kind: 'content',
            delta: `${question}\n\n${options.map((o, i) => `${i + 1}. ${o}`).join('\n')}\n${options.length + 1}. Autre…`,
          };
          yield { kind: 'done' };
          chatLog('chat.end', { ...logBase, outcome: 'clarify', ms: Date.now() - started });
          return;
        }

        if (!effort.agentic || reflection.sufficient) {
          yield statusEvent('agent', 'Sources suffisantes — rédaction');
          chatLog('agent.decision', { ...logBase, decision: 'answer' });
          break;
        }

        const nextQueries =
          reflection.queries.length > 0 ? reflection.queries : [`${resolved.searchQuery} détails`];
        webSearchQuery = reflection.webQuery ?? resolved.webQuery;
        yield { kind: 'sub_queries', queries: nextQueries };
        yield statusEvent('refine', 'Relance de recherche…');
        yield statusEvent('agent', `Relance de recherche : ${nextQueries.join(' · ').slice(0, 120)}`);
        chatLog('refine', { ...logBase, round, queries: nextQueries.join(' | ') });
        chatLog('agent.decision', { ...logBase, decision: 'refine' });

        {
          yield statusEvent(
            'search',
            useRag && webSearchOn
              ? 'Recherche dans vos documents et sur le web…'
              : useRag
                ? 'Recherche dans vos documents…'
                : 'Recherche sur le web…',
          );
          const t0 = Date.now();
          const [perQuery, web] = await Promise.all([
            useRag
              ? Promise.all(
                  nextQueries.map((text) =>
                    this.retrieval.search({
                      text,
                      userId: request.userId,
                      topK: retrievalTopK,
                      ...(request.documentIds ? { documentIds: request.documentIds } : {}),
                    }),
                  ),
                )
              : Promise.resolve([] as RerankedResult[][]),
            webSearchOn ? searchWeb(webSearchQuery) : Promise.resolve([] as WebSearchHit[]),
          ]);
          for (const results of perQuery) mergeChunkHits(bestByChunk, results);
          if (web.length > 0) {
            let extra = web;
            if (resolved.topic) extra = filterWebHitsToTopic(web, resolved.topic);
            webHits = mergeWebHits(webHits, extra);
          }
          chatLog('search.round', {
            ...logBase,
            round: round + 1,
            ragQueries: nextQueries.length,
            chunkHits: bestByChunk.size,
            webHits: webHits.length,
            ms: Date.now() - t0,
          });
        }
      }
    }

    const ranked = [...bestByChunk.entries()].sort((a, b) => b[1].score - a[1].score);

    if (multiSection) {
      const perSectionCiteCap = Math.min(
        4,
        Math.max(3, Math.floor(effort.maxCitations / sections.length) + 1),
      );
      const mergedCitations: Citation[] = [];
      const sectionContexts: { section: string; contextParts: string[] }[] = [];

      for (const section of sections) {
        const pack = await this.buildCitationsAndContext({
          userId: request.userId,
          ranked,
          webHits,
          weights,
          totalBudget: Math.floor(totalBudget * 0.5),
          useRag,
          webSearchOn,
          maxCitations: perSectionCiteCap,
          maxExcerptChars: effort.maxExcerptChars,
          maxChunksPerDocument: effort.maxChunksPerDocument,
          sectionFilter: section,
        });

        const remapped: string[] = [];
        for (let i = 0; i < pack.citations.length; i++) {
          const cite = pack.citations[i]!;
          const part = pack.contextParts[i]!;
          let n = mergedCitations.findIndex((c) => c.chunkId === cite.chunkId) + 1;
          if (n === 0) {
            if (mergedCitations.length >= effort.maxCitations) continue;
            mergedCitations.push(cite);
            n = mergedCitations.length;
          }
          remapped.push(part.replace(/^\[#\d+\]/, `[#${n}]`));
        }
        if (remapped.length === 0 && mergedCitations.length > 0) {
          // Fallback: reuse first few global citations text via snippets
          for (const c of mergedCitations.slice(0, perSectionCiteCap)) {
            const n = mergedCitations.indexOf(c) + 1;
            remapped.push(`[#${n}] (corpus — ${c.documentTitle})\n${c.snippet}`);
          }
        }
        sectionContexts.push({ section, contextParts: remapped });
      }

      chatLog('pack.stats', {
        ...logBase,
        citationCount: mergedCitations.length,
        contextChars: sectionContexts.reduce(
          (acc, s) => acc + s.contextParts.join('').length,
          0,
        ),
        dropped: 0,
        maxCitations: effort.maxCitations,
        multiSection: true,
        sectionCount: sections.length,
      });

      if (mergedCitations.length === 0) {
        chatLog('chat.error', { ...logBase, reason: 'no_citations' });
        yield {
          kind: 'error',
          message: 'Aucune source exploitable pour répondre à cette question.',
        };
        return;
      }

      yield { kind: 'citations', citations: mergedCitations };

      if (webSearchOn && webHits.length === 0 && ranked.length > 0) {
        yield {
          kind: 'content',
          delta: '(Recherche web indisponible pour le moment — réponse à partir de vos sources.)\n\n',
        };
      }

      const systemParts = this.buildSystemParts({
        historyLen: request.history.length,
        useRag,
        webSearchOn,
        weights,
        enableThinking: false,
        answerTokenFloor: effort.answerTokenFloor,
      });

      yield* this.streamSectionedAnswer({
        request,
        sectionContexts,
        systemParts,
        effort,
        gen,
        logBase,
        started,
        allCitations: mergedCitations,
      });
      return;
    }

    const built = await this.buildCitationsAndContext({
      userId: request.userId,
      ranked,
      webHits,
      weights,
      totalBudget,
      useRag,
      webSearchOn,
      maxCitations: effort.maxCitations,
      maxExcerptChars: effort.maxExcerptChars,
      maxChunksPerDocument: effort.maxChunksPerDocument,
    });

    chatLog('pack.stats', {
      ...logBase,
      citationCount: built.citations.length,
      contextChars: built.contextChars,
      dropped: built.dropped,
      maxCitations: effort.maxCitations,
      multiSection: false,
      sectionCount: 0,
    });

    if (built.citations.length === 0) {
      chatLog('chat.error', { ...logBase, reason: 'no_citations' });
      yield {
        kind: 'error',
        message: 'Aucune source exploitable pour répondre à cette question.',
      };
      return;
    }

    yield { kind: 'citations', citations: built.citations };

    if (webSearchOn && webHits.length === 0 && ranked.length > 0) {
      yield {
        kind: 'content',
        delta: '(Recherche web indisponible pour le moment — réponse à partir de vos sources.)\n\n',
      };
    }

    const systemParts = this.buildSystemParts({
      historyLen: request.history.length,
      useRag,
      webSearchOn,
      weights,
      enableThinking,
      answerTokenFloor: effort.answerTokenFloor,
    });

    const userContent = `Extraits:\n\n${built.contextParts.join('\n\n---\n\n')}\n\nQuestion: ${request.message}`;

    const messages = [
      { role: 'system' as const, content: systemParts.join(' ') },
      ...request.history.map((message) => ({
        role: message.role as 'user' | 'assistant',
        content: message.content,
      })),
      { role: 'user' as const, content: userContent },
    ];

    yield statusEvent('answer', 'Rédaction de la réponse…');
    chatLog('answer.start', {
      ...logBase,
      enableThinking,
      maxTokens: answerMaxTokens,
      contextChars: built.contextChars,
      citationCount: built.citations.length,
    });

    let reasoningAccum = '';
    let contentAccum = '';
    let reasoningYielded = 0;

    for await (const event of inferenceClient.stream(messages, {
      maxTokens: answerMaxTokens,
      temperature: gen?.temperature ?? 0.2,
      enableThinking,
      ...(gen?.topK !== undefined ? { topK: gen.topK } : {}),
      ...(gen?.topP !== undefined ? { topP: gen.topP } : {}),
      ...(gen?.minP !== undefined ? { minP: gen.minP } : {}),
      ...(gen?.repeatPenalty !== undefined ? { repeatPenalty: gen.repeatPenalty } : {}),
    })) {
      if (event.kind === 'reasoning') {
        reasoningAccum += event.content;
        if (reasoningYielded < CLIENT_REASONING_CAP) {
          const slice = event.content.slice(0, CLIENT_REASONING_CAP - reasoningYielded);
          if (slice) {
            reasoningYielded += slice.length;
            yield { kind: 'reasoning', delta: slice };
          }
        }
      } else if (event.kind === 'delta') {
        contentAccum += event.content;
        yield { kind: 'content', delta: event.content };
      } else if (event.kind === 'error') {
        chatLog('answer.error', { ...logBase, message: event.message });
        yield { kind: 'error', message: event.message };
        return;
      }
    }

    chatLog('answer.end', {
      ...logBase,
      reasoningChars: reasoningAccum.length,
      contentChars: contentAccum.length,
    });

    const emptyAfterThinking =
      enableThinking &&
      reasoningAccum.length >= 800 &&
      contentAccum.trim().length < 40;
    const midCut = looksTruncated(contentAccum, answerMaxTokens);

    if (emptyAfterThinking || midCut) {
      yield* this.continueAnswer({
        request,
        systemParts,
        userContent,
        citations: built.citations,
        reasoningAccum,
        contentAccum,
        emptyAfterThinking,
        gen,
        effort,
        logBase,
        started,
      });
      return;
    }

    yield { kind: 'done' };
    chatLog('chat.end', { ...logBase, outcome: 'ok', ms: Date.now() - started });
  }

  private buildSystemParts(input: {
    historyLen: number;
    useRag: boolean;
    webSearchOn: boolean;
    weights: { rag: number; web: number };
    enableThinking: boolean;
    answerTokenFloor: number;
  }): string[] {
    const systemParts = ['Tu es Astrolabe, un assistant documentaire.'];
    if (input.historyLen > 0) {
      systemParts.push(
        'Tiens compte de l’historique : une question courte peut renvoyer au sujet précédent. ' +
          'Si plusieurs interprétations restent possibles, NE rédige PAS une double réponse : ' +
          'pose UNIQUEMENT une question de clarification courte.',
      );
    }
    if (input.useRag && input.webSearchOn) {
      const ragPct = Math.round(input.weights.rag * 100);
      const webPct = Math.round(input.weights.web * 100);
      systemParts.push(
        `Tu disposes d’extraits corpus (documents indexés) et de résultats web publics.`,
        `Pondération de confiance demandée par l’utilisateur : corpus RAG ${ragPct} %, web ${webPct} %.`,
        input.weights.rag >= input.weights.web
          ? 'En cas de tension entre sources, privilégie le corpus comme source de vérité.'
          : 'En cas de tension entre sources, privilégie les résultats web comme source de vérité.',
      );
    } else if (input.webSearchOn) {
      systemParts.push(
        'Réponds à partir des résultats web fournis uniquement (le corpus documentaire est désactivé).',
      );
    } else {
      systemParts.push('Réponds uniquement à partir des extraits de documents fournis.');
    }
    if (input.enableThinking) {
      systemParts.push(
        `Raisonnement ≤ 5 phrases courtes, puis réponse citée (réserve au moins ~${input.answerTokenFloor} tokens pour la réponse). ` +
          'Ne laisse pas le raisonnement consommer tout le budget.',
      );
    } else {
      systemParts.push('Réponds directement, sans digression.');
    }
    systemParts.push(
      'Chaque affirmation importante doit renvoyer à une citation [#n].',
      'Si les extraits ne suffisent pas, dis-le clairement ou pose une question de clarification.',
      'Réponds en français.',
    );
    return systemParts;
  }

  private async *continueAnswer(input: {
    request: ChatRequest;
    systemParts: string[];
    userContent: string;
    citations: Citation[];
    reasoningAccum: string;
    contentAccum: string;
    emptyAfterThinking: boolean;
    gen: ChatRequest['generation'];
    effort: (typeof EFFORT_CONFIGS)[keyof typeof EFFORT_CONFIGS];
    logBase: Record<string, unknown>;
    started: number;
  }): AsyncGenerator<ChatStreamEvent> {
    const { request, systemParts, citations, reasoningAccum, contentAccum, emptyAfterThinking } =
      input;
    const continueMax = Math.max(
      input.effort.answerTokenFloor,
      input.gen?.maxTokens ?? input.effort.maxTokens,
    );

    yield statusEvent('answer', 'Reprise de la réponse…');
    chatLog('answer.continue', {
      ...input.logBase,
      reason: emptyAfterThinking ? 'empty_after_thinking' : 'mid_truncation',
      contentChars: contentAccum.length,
      reasoningChars: reasoningAccum.length,
    });

    const digest = compressCitationsDigest(citations);
    let continueUser: string;

    if (emptyAfterThinking) {
      yield statusEvent('summarize_reasoning', 'Synthèse du raisonnement…');
      chatLog('summarize_reasoning.start', {
        ...input.logBase,
        reasoningChars: reasoningAccum.length,
      });
      const summaryResult = await inferenceClient.complete(
        [
          {
            role: 'system',
            content:
              'Résume le raisonnement suivant en français, en 120 mots maximum. ' +
              'Garde les conclusions utiles pour rédiger une réponse citée. Pas de JSON.',
          },
          { role: 'user', content: reasoningAccum.slice(-12_000) },
        ],
        { maxTokens: 256, temperature: 0.1, enableThinking: false, timeoutMs: 45_000 },
      );
      const summary = summaryResult?.content?.trim() ?? reasoningAccum.slice(0, 600);
      chatLog('summarize_reasoning.end', { ...input.logBase, summaryChars: summary.length });
      continueUser =
        `Digest des sources:\n${digest}\n\nQuestion: ${request.message}\n\n` +
        `---\nRésumé de ton raisonnement antérieur:\n${summary}\n\n` +
        `Rédige maintenant la réponse finale complète, citée, en français. Ne recommence pas le raisonnement.`;
    } else {
      const tail = contentAccum.slice(-400);
      continueUser =
        `Digest des sources:\n${digest}\n\nQuestion: ${request.message}\n\n` +
        `---\nTa réponse a été coupée. Voici la fin déjà écrite:\n« ${tail} »\n\n` +
        `Continue EXACTEMENT à partir de là (pas de reprise du début, pas de titre redondant). ` +
        `Termine les phrases et couvre ce qui manque, avec citations [#n].`;
    }

    const continueMessages = [
      { role: 'system' as const, content: systemParts.join(' ') },
      ...request.history.map((message) => ({
        role: message.role as 'user' | 'assistant',
        content: message.content,
      })),
      { role: 'user' as const, content: continueUser },
    ];

    for await (const event of inferenceClient.stream(continueMessages, {
      maxTokens: continueMax,
      temperature: input.gen?.temperature ?? 0.2,
      enableThinking: false,
      ...(input.gen?.topK !== undefined ? { topK: input.gen.topK } : {}),
      ...(input.gen?.topP !== undefined ? { topP: input.gen.topP } : {}),
      ...(input.gen?.minP !== undefined ? { minP: input.gen.minP } : {}),
      ...(input.gen?.repeatPenalty !== undefined
        ? { repeatPenalty: input.gen.repeatPenalty }
        : {}),
    })) {
      if (event.kind === 'delta') yield { kind: 'content', delta: event.content };
      else if (event.kind === 'error') {
        yield { kind: 'error', message: event.message };
        return;
      }
    }

    yield { kind: 'done' };
    chatLog('chat.end', {
      ...input.logBase,
      outcome: 'continued',
      ms: Date.now() - input.started,
    });
  }

  private async *streamSectionedAnswer(input: {
    request: ChatRequest;
    sectionContexts: { section: string; contextParts: string[] }[];
    systemParts: string[];
    effort: (typeof EFFORT_CONFIGS)[keyof typeof EFFORT_CONFIGS];
    gen: ChatRequest['generation'];
    logBase: Record<string, unknown>;
    started: number;
    allCitations: Citation[];
  }): AsyncGenerator<ChatStreamEvent> {
    const { request, effort, gen } = input;

    chatLog('section.start', {
      ...input.logBase,
      sections: input.sectionContexts.map((s) => s.section).join(' | '),
    });

    for (let s = 0; s < input.sectionContexts.length; s++) {
      const { section, contextParts } = input.sectionContexts[s]!;
      yield statusEvent('answer', `Rédaction — ${section}…`);

      const heading = `## ${section}\n\n`;
      yield { kind: 'content', delta: s === 0 ? heading : `\n\n${heading}` };

      const sectionSystem = [
        ...input.systemParts,
        `Tu rédiges UNIQUEMENT la section « ${section} ». Pas d’introduction globale, pas de conclusion des autres volets. ` +
          `Utilise les citations [#n] fournies. 1 à 3 courts paragraphes.`,
      ];
      const sectionUser =
        `Extraits:\n\n${contextParts.join('\n\n---\n\n')}\n\n` +
        `Question globale: ${request.message}\n` +
        `Rédige uniquement la section: ${section}`;

      const sectionMax = Math.min(512, gen?.maxTokens ?? effort.maxTokens);
      let sectionContent = '';

      for await (const event of inferenceClient.stream(
        [
          { role: 'system', content: sectionSystem.join(' ') },
          { role: 'user', content: sectionUser },
        ],
        {
          maxTokens: sectionMax,
          temperature: gen?.temperature ?? 0.2,
          enableThinking: false,
          ...(gen?.topK !== undefined ? { topK: gen.topK } : {}),
          ...(gen?.topP !== undefined ? { topP: gen.topP } : {}),
          ...(gen?.minP !== undefined ? { minP: gen.minP } : {}),
          ...(gen?.repeatPenalty !== undefined ? { repeatPenalty: gen.repeatPenalty } : {}),
        },
      )) {
        if (event.kind === 'delta') {
          sectionContent += event.content;
          yield { kind: 'content', delta: event.content };
        } else if (event.kind === 'error') {
          yield { kind: 'error', message: event.message };
          return;
        }
      }

      if (looksTruncated(sectionContent, sectionMax)) {
        yield statusEvent('answer', 'Reprise de la réponse…');
        chatLog('answer.continue', {
          ...input.logBase,
          reason: 'section_mid_truncation',
          section,
        });
        const digest = compressCitationsDigest(input.allCitations.slice(0, 6));
        const tail = sectionContent.slice(-400);
        for await (const event of inferenceClient.stream(
          [
            { role: 'system', content: sectionSystem.join(' ') },
            {
              role: 'user',
              content:
                `Digest:\n${digest}\n\nSection: ${section}\n` +
                `Fin déjà écrite:\n« ${tail} »\n\nContinue exactement à partir de là, sans recommencer.`,
            },
          ],
          {
            maxTokens: effort.answerTokenFloor,
            temperature: gen?.temperature ?? 0.2,
            enableThinking: false,
          },
        )) {
          if (event.kind === 'delta') yield { kind: 'content', delta: event.content };
          else if (event.kind === 'error') {
            yield { kind: 'error', message: event.message };
            return;
          }
        }
      }

      chatLog('section.end', {
        ...input.logBase,
        section,
        chars: sectionContent.length,
        contextBlocks: contextParts.length,
      });
    }

    yield { kind: 'done' };
    chatLog('chat.end', {
      ...input.logBase,
      outcome: 'sectioned',
      ms: Date.now() - input.started,
    });
  }

  private async sampleCorpusTitles(
    userId: string,
    bestByChunk: Map<string, { score: number; documentId: string }>,
  ): Promise<string[]> {
    const ranked = [...bestByChunk.entries()].sort((a, b) => b[1].score - a[1].score).slice(0, 12);
    if (ranked.length === 0) return [];
    const chunkIds = ranked.map(([id]) => id);
    try {
      const rows = await withReadOnlyUserScope(db, userId, async (client) => {
        const { rows: found } = await client.query<{ title: string }>(
          `SELECT DISTINCT d.title
           FROM document_chunks c
           JOIN documents d ON d.id = c.document_id
           WHERE c.id = ANY($1::uuid[]) AND c.owner_id = $2::uuid
           LIMIT 12`,
          [chunkIds, userId],
        );
        return found;
      });
      return rows.map((r) => r.title);
    } catch {
      return [];
    }
  }

  private async buildDigest(
    userId: string,
    bestByChunk: Map<string, { score: number; documentId: string }>,
    webHits: WebSearchHit[],
  ): Promise<string> {
    const parts: string[] = [];
    const ranked = [...bestByChunk.entries()].sort((a, b) => b[1].score - a[1].score).slice(0, 12);
    if (ranked.length > 0) {
      const chunkIds = ranked.map(([id]) => id);
      const rows = await withReadOnlyUserScope(db, userId, async (client) => {
        const { rows: found } = await client.query<{ id: string; title: string; content: string }>(
          `SELECT c.id::text AS id, d.title, left(c.content, 220) AS content
           FROM document_chunks c
           JOIN documents d ON d.id = c.document_id
           WHERE c.id = ANY($1::uuid[]) AND c.owner_id = $2::uuid`,
          [chunkIds, userId],
        );
        return found;
      });
      for (const row of rows) {
        parts.push(`- [corpus] ${row.title}: ${row.content}`);
      }
    }
    for (const hit of webHits.slice(0, 8)) {
      parts.push(`- [web] ${hit.title}: ${hit.snippet.slice(0, 220)}`);
    }
    return parts.join('\n') || '(aucun extrait)';
  }

  private async buildCitationsAndContext(input: {
    userId: string;
    ranked: [string, { score: number; documentId: string }][];
    webHits: WebSearchHit[];
    weights: { rag: number; web: number };
    totalBudget: number;
    useRag: boolean;
    webSearchOn: boolean;
    maxCitations: number;
    maxExcerptChars: number;
    maxChunksPerDocument: number;
    /** When set, reuse global [#n] numbers for matching chunk ids. */
    preferCitationNumbers?: Map<string, number>;
    /** Optional section title to prefer matching excerpts. */
    sectionFilter?: string;
  }): Promise<{
    citations: Citation[];
    contextParts: string[];
    contextChars: number;
    dropped: number;
  }> {
    const citations: Citation[] = [];
    const contextParts: string[] = [];
    let dropped = 0;
    const ragBudget =
      input.useRag && input.webSearchOn
        ? Math.floor(input.totalBudget * input.weights.rag)
        : input.useRag
          ? input.totalBudget
          : 0;
    const webBudget =
      input.useRag && input.webSearchOn
        ? Math.floor(input.totalBudget * input.weights.web)
        : input.webSearchOn
          ? input.totalBudget
          : 0;

    const appendCorpus = async (): Promise<void> => {
      if (input.ranked.length === 0 || ragBudget <= 0) return;
      let usedChars = 0;
      const chunkIds = input.ranked.map(([id]) => id);
      const rows = await withReadOnlyUserScope(db, input.userId, async (client) => {
        const { rows: found } = await client.query<ChunkContextRow>(
          `SELECT c.id::text AS id,
                  c.document_id::text AS document_id,
                  c.content,
                  c.context_prefix,
                  d.title,
                  d.source_type,
                  c.anchor_kind,
                  c.anchor_start_sec::text,
                  c.anchor_end_sec::text,
                  c.anchor_page,
                  c.anchor_section
           FROM document_chunks c
           JOIN documents d ON d.id = c.document_id
           WHERE c.id = ANY($1::uuid[])
             AND c.owner_id = $2::uuid`,
          [chunkIds, input.userId],
        );
        return found;
      });
      const rowById = new Map(rows.map((row) => [row.id, row]));

      type Candidate = {
        chunkId: string;
        meta: { score: number; documentId: string };
        row: ChunkContextRow;
        sectionScore: number;
      };
      const candidates: Candidate[] = [];
      for (const [chunkId, meta] of input.ranked) {
        const row = rowById.get(chunkId);
        if (!row) continue;
        const text = `${row.context_prefix ?? ''}\n${row.content}\n${row.title}`;
        const sectionScore = input.sectionFilter
          ? scoreExcerptForSection(text, input.sectionFilter)
          : 0;
        candidates.push({ chunkId, meta, row, sectionScore });
      }
      candidates.sort((a, b) => {
        if (input.sectionFilter && b.sectionScore !== a.sectionScore) {
          return b.sectionScore - a.sectionScore;
        }
        return b.meta.score - a.meta.score;
      });

      const perDoc = new Map<string, number>();

      for (const cand of candidates) {
        if (citations.length >= input.maxCitations) {
          dropped += 1;
          continue;
        }
        const docCount = perDoc.get(cand.row.document_id) ?? 0;
        if (docCount >= input.maxChunksPerDocument) {
          dropped += 1;
          continue;
        }

        const body = cand.row.content.slice(0, input.maxExcerptChars);
        const block = cand.row.context_prefix ? `${cand.row.context_prefix}\n${body}` : body;
        if (usedChars > 0 && usedChars + block.length > ragBudget) {
          dropped += 1;
          break;
        }
        usedChars += block.length;
        perDoc.set(cand.row.document_id, docCount + 1);

        const n =
          input.preferCitationNumbers?.get(cand.chunkId) ?? citations.length + 1;
        // When remapping, keep citation list aligned with displayed numbers only for fresh packs.
        const displayN = input.preferCitationNumbers ? n : citations.length + 1;
        contextParts.push(`[#${displayN}] (corpus — ${cand.row.title})\n${block}`);
        citations.push({
          chunkId: cand.chunkId,
          documentId: cand.row.document_id,
          documentTitle: cand.row.title,
          sourceType: cand.row.source_type,
          anchor: toAnchor(cand.row),
          snippet: body.slice(0, 400),
          score: cand.meta.score * input.weights.rag,
        });
      }
    };

    const appendWeb = (): void => {
      if (input.webHits.length === 0 || webBudget <= 0) return;
      let usedChars = 0;
      for (const hit of input.webHits) {
        if (citations.length >= input.maxCitations) {
          dropped += 1;
          continue;
        }
        const snippet = hit.snippet.slice(0, input.maxExcerptChars);
        const block = `${hit.title}\n${hit.url}\n${snippet}`;
        if (usedChars > 0 && usedChars + block.length > webBudget) {
          dropped += 1;
          break;
        }
        usedChars += block.length;
        const ids = webHitIds(hit.url);
        const displayN = citations.length + 1;
        contextParts.push(`[#${displayN}] (web — ${hit.title} — ${hit.url})\n${snippet}`);
        citations.push({
          chunkId: ids.chunkId,
          documentId: ids.documentId,
          documentTitle: hit.title,
          sourceType: 'web',
          anchor: { kind: 'section', section: hit.url },
          snippet: snippet || hit.title,
          score: 0.5 * input.weights.web,
          url: hit.url,
        });
      }
    };

    if (input.weights.rag >= input.weights.web) {
      await appendCorpus();
      appendWeb();
    } else {
      appendWeb();
      await appendCorpus();
    }

    const contextChars = contextParts.join('').length;
    return { citations, contextParts, contextChars, dropped };
  }
}

export const chatOrchestrationService = new ChatOrchestrationService(retrievalService, decompositionService);

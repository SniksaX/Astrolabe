import type { ChatMessage } from '@astrolabe/shared-types';
import type { WebSearchHit } from './webSearch.js';

const STOPWORDS = new Set([
  'cest',
  'quoi',
  'comment',
  'marche',
  'pourquoi',
  'quand',
  'est',
  'une',
  'des',
  'les',
  'the',
  'and',
  'pour',
  'avec',
  'dans',
  'sur',
  'pas',
  'non',
  'oui',
  'tout',
  'tous',
  'toutes',
  'plus',
  'aussi',
  'bien',
  'fait',
  'faire',
  'etre',
  'avoir',
  'cette',
  'cela',
  'donc',
  'mais',
  'comme',
  'autre',
  'autre…',
  'autre...',
  'explique',
  'expliquer',
  'fonctionne',
  'fonctionnement',
  'dis',
  'moi',
  'svp',
  'please',
  'what',
  'how',
  'does',
  'work',
  'works',
]);

const VAGUE_RE =
  /^(comment\s+[çc]a\s+marche\b|et\s+[çc]a\s*\??|pourquoi\s*\??|comment\s*\??|c['']est\s+quoi\s*\??|et\s+ensuite\s*\??|ok\s*\??|oui\s*\??|non\s*\??|explique\s*\??|details?\s*\??|détails?\s*\??)$/i;

/**
 * Tokenize for topic matching (ASCII-ish, lowercased).
 */
export function topicTokens(text: string): string[] {
  const normalized = text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase();
  return normalized
    .split(/[^a-z0-9]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 2 && !STOPWORDS.has(t));
}

/** True when the follow-up is underspecified and likely depends on history. */
export function isVagueFollowUp(message: string): boolean {
  const trimmed = message.trim();
  if (trimmed.length === 0) return true;
  if (trimmed.length <= 40 && VAGUE_RE.test(trimmed)) return true;
  if (trimmed.length <= 28) {
    const tokens = topicTokens(trimmed);
    return tokens.length <= 1;
  }
  // « comment ça marche ? » with light punctuation / extra words
  if (/comment\s+[çc]a\s+marche/i.test(trimmed) && topicTokens(trimmed).length <= 1) {
    return true;
  }
  return false;
}

/**
 * Pull a concrete topic from recent history (prefer user turns, then assistant).
 */
export function extractHistoryTopic(history: ChatMessage[]): string | null {
  for (let i = history.length - 1; i >= 0; i--) {
    const turn = history[i];
    if (!turn) continue;
    // Skip clarification option lists
    if (turn.role === 'assistant' && /^\d+\.\s+/m.test(turn.content) && /autre/i.test(turn.content)) {
      continue;
    }
    const tokens = topicTokens(turn.content.slice(0, 500));
    // Prefer distinctive tokens (length >= 5 or known tech-ish)
    const preferred = tokens.filter(
      (t) => t.length >= 5 || /mongo|sql|docker|react|node|kafka|redis|nginx/i.test(t),
    );
    const pick = preferred[0] ?? tokens.find((t) => t.length >= 4) ?? null;
    if (pick) return pick;
  }
  return null;
}

/** Message already names the history topic (user disambiguated). */
export function messageGroundsTopic(message: string, topic: string | null): boolean {
  if (!topic) return false;
  const msgTokens = new Set(topicTokens(message));
  return topicTokens(topic).some((t) => msgTokens.has(t));
}

export function scoreTextAgainstTopic(text: string, topic: string): number {
  const tokens = topicTokens(topic);
  if (tokens.length === 0) return 0;
  const hay = text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase();
  let score = 0;
  for (const t of tokens) {
    if (hay.includes(t)) score += 1;
  }
  return score;
}

export interface ResolvedQueries {
  /** Original user message. */
  message: string;
  /** Topic taken from history when follow-up is vague. */
  topic: string | null;
  vague: boolean;
  grounded: boolean;
  /** Query used for corpus retrieval / decomposition. */
  searchQuery: string;
  /** Query used for web search. */
  webQuery: string;
  rewritten: boolean;
}

/**
 * History-grounded rewrite for vague follow-ups.
 * Deterministic — no LLM. Fail-open: returns the raw message when no topic.
 */
export function resolveSearchQueries(input: {
  message: string;
  history: ChatMessage[];
}): ResolvedQueries {
  const message = input.message.trim();
  const topic = extractHistoryTopic(input.history);
  const vague = isVagueFollowUp(message);
  const grounded = messageGroundsTopic(message, topic);

  if (topic && (vague || (!grounded && message.length < 80 && /comment|pourquoi|comment\s+[çc]a/i.test(message)))) {
    const searchQuery = grounded ? message : `${topic} ${message}`.replace(/\s+/g, ' ').trim();
    const webQuery = grounded
      ? message
      : `${topic} fonctionnement OR architecture OR comment ça marche`.replace(/\s+/g, ' ').trim();
    return {
      message,
      topic,
      vague,
      grounded,
      searchQuery,
      webQuery,
      rewritten: searchQuery !== message || webQuery !== message,
    };
  }

  if (topic && grounded) {
    return {
      message,
      topic,
      vague: false,
      grounded: true,
      searchQuery: message,
      webQuery: message,
      rewritten: false,
    };
  }

  return {
    message,
    topic,
    vague,
    grounded,
    searchQuery: message,
    webQuery: message,
    rewritten: false,
  };
}

export interface TopicMismatchResult {
  mismatch: boolean;
  needsClarification: boolean;
  topic: string | null;
  webDominantLabel: string | null;
  clarifyingQuestion: string;
  options: string[];
}

/**
 * Detect when history topic matches corpus but web results dominate a different entity.
 */
export function detectTopicMismatch(input: {
  message: string;
  history: ChatMessage[];
  topic: string | null;
  vague: boolean;
  grounded: boolean;
  corpusTitles: string[];
  webHits: WebSearchHit[];
}): TopicMismatchResult {
  const empty: TopicMismatchResult = {
    mismatch: false,
    needsClarification: false,
    topic: input.topic,
    webDominantLabel: null,
    clarifyingQuestion: '',
    options: [],
  };

  if (!input.topic || input.webHits.length === 0) return empty;
  if (input.grounded) return empty;

  const topic = input.topic;
  const corpusOnTopic = input.corpusTitles.filter((t) => scoreTextAgainstTopic(t, topic) > 0).length;
  const webScores = input.webHits.map((h) => ({
    hit: h,
    score: scoreTextAgainstTopic(`${h.title} ${h.snippet}`, topic),
  }));
  const webOnTopic = webScores.filter((w) => w.score > 0).length;
  const webOffTopic = webScores.filter((w) => w.score === 0);
  const offRatio = webOffTopic.length / input.webHits.length;

  // Mismatch: vague ask, corpus knows the topic, web mostly elsewhere
  const mismatch =
    input.vague &&
    (corpusOnTopic > 0 || input.history.length > 0) &&
    offRatio >= 0.5 &&
    webOnTopic < Math.ceil(input.webHits.length / 2);

  if (!mismatch) return empty;

  const webDominantLabel = pickWebDominantLabel(webOffTopic.map((w) => w.hit)) ?? 'un autre sujet (résultats web)';
  const topicLabel = topic.charAt(0).toUpperCase() + topic.slice(1);

  return {
    mismatch: true,
    needsClarification: true,
    topic,
    webDominantLabel,
    clarifyingQuestion: `Votre question est ambiguë. De quoi parlez-vous ?`,
    options: [
      `Fonctionnement de ${topicLabel}`,
      webDominantLabel.startsWith('Le ') || webDominantLabel.startsWith('La ')
        ? webDominantLabel
        : `Le sujet « ${webDominantLabel} »`,
    ].slice(0, 4),
  };
}

function pickWebDominantLabel(hits: WebSearchHit[]): string | null {
  if (hits.length === 0) return null;
  // Prefer recurring title phrases (e.g. Comment ça marche)
  const blob = hits.map((h) => h.title).join(' | ');
  if (/comment\s+[çc]a\s+marche/i.test(blob)) return 'Le site Comment ça marche ? (CCM)';
  const first = hits[0]?.title?.trim();
  if (!first) return null;
  return first.length > 60 ? `${first.slice(0, 57)}…` : first;
}

/** Drop web hits that do not mention the conversation topic (when grounded). */
export function filterWebHitsToTopic(hits: WebSearchHit[], topic: string | null): WebSearchHit[] {
  if (!topic || hits.length === 0) return hits;
  const kept = hits.filter((h) => scoreTextAgainstTopic(`${h.title} ${h.snippet}`, topic) > 0);
  // If everything would be dropped, keep original (fail-open) unless clearly CCM vs tech topic
  if (kept.length === 0) {
    const allCcm = hits.every((h) => /comment\s+[çc]a\s+marche|\bccm\b/i.test(`${h.title} ${h.snippet}`));
    if (allCcm && !/comment|ccm/i.test(topic)) return [];
    return hits;
  }
  return kept;
}

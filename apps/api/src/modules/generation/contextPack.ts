/**
 * Helpers for packing RAG/web context under a small llama.cpp window.
 */

const MULTI_TOPIC_RE =
  /\b(tout|tous|toutes|les\s*3|les\s*trois|all\s*three|toutes?\s+les|tous\s+les\s+aspects|les\s+trois\s+volets)\b/i;

/** Detect « tout / les 3 / tous les aspects » style multi-topic asks. */
export function isMultiTopicAsk(message: string, history: { role: string; content: string }[]): boolean {
  const text = message.trim();
  if (MULTI_TOPIC_RE.test(text)) return true;
  // Short replies like « tout » after a clarification with options.
  if (text.length <= 40 && /^(tout|tous|les\s*3|ok\s*tout|tout\s*les?\s*3)/i.test(text)) {
    return history.some((m) => m.role === 'assistant' && /1\.|options|préciser|aspect/i.test(m.content));
  }
  return false;
}

/**
 * Derive section titles from the last assistant clarification (numbered options)
 * or fall back to generic facets for multi-topic Mongo-style asks.
 */
export function deriveSections(
  message: string,
  history: { role: string; content: string }[],
): string[] {
  for (let i = history.length - 1; i >= 0; i--) {
    const turn = history[i];
    if (turn?.role !== 'assistant') continue;
    const lines = turn.content.split('\n').map((l) => l.trim());
    const options: string[] = [];
    for (const line of lines) {
      const match = line.match(/^\d+\.\s+(.+?)(?:…)?$/);
      if (match?.[1] && !/^autre/i.test(match[1])) options.push(match[1].trim());
    }
    if (options.length >= 2) return options.slice(0, 4);
  }
  if (isMultiTopicAsk(message, history)) {
    return ['Installation et configuration', 'Architecture et stockage', 'Requêtes et index'];
  }
  return [];
}

export function looksTruncated(content: string, maxTokens: number): boolean {
  const trimmed = content.trim();
  if (trimmed.length === 0) return true;
  // Rough: ~3 chars/token — near budget and no terminal punctuation.
  const nearBudget = trimmed.length >= Math.floor(maxTokens * 2.2);
  const endsClean = /[.!?…»")\]]\s*$/u.test(trimmed);
  const endsMidWord = /[A-Za-zÀ-ÿ]{3,}$/u.test(trimmed) && !endsClean;
  return (nearBudget && !endsClean) || endsMidWord;
}

export function scoreExcerptForSection(text: string, section: string): number {
  const hay = text.toLowerCase();
  const terms = section
    .toLowerCase()
    .split(/[^a-zàâäéèêëïîôùûüç0-9]+/i)
    .filter((t) => t.length > 2);
  let score = 0;
  for (const term of terms) {
    if (hay.includes(term)) score += 1;
  }
  // Light boosts for common facet vocabulary.
  if (/install|docker|atlas|compass|connect|config/i.test(section) && /install|docker|atlas|compass|mongoose\.connect|uri/i.test(hay))
    score += 2;
  if (/architecture|stockage|scalab|bson|denorm|cap|acid/i.test(section) && /architecture|bson|scalab|denorm|répliqu|shard|cap|acid|base/i.test(hay))
    score += 2;
  if (/requ[eê]te|index|agr[eé]g|crud|pipeline/i.test(section) && /index|aggreg|find\(|insert|update|pipeline|\$match|lean\(/i.test(hay))
    score += 2;
  return score;
}

export function compressCitationsDigest(
  citations: { documentTitle: string; snippet: string }[],
): string {
  return citations
    .map((c, i) => `[#${i + 1}] ${c.documentTitle}: ${c.snippet.slice(0, 160)}`)
    .join('\n');
}

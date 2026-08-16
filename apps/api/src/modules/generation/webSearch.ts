import { createHash } from 'node:crypto';
import { parseHTML } from 'linkedom';

export interface WebSearchHit {
  title: string;
  url: string;
  snippet: string;
}

const DDG_HTML = 'https://html.duckduckgo.com/html/';
const MAX_RESULTS = 5;
const TIMEOUT_MS = 8_000;

/**
 * Live web snippets via DuckDuckGo HTML (no API key). Fail-open: any network
 * or parse failure returns [] so chat can continue with corpus-only context.
 * Snippets only — no follow-up page fetch (keeps SSRF surface closed).
 */
export async function searchWeb(query: string): Promise<WebSearchHit[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  try {
    const body = new URLSearchParams({ q: trimmed });
    const response = await fetch(DDG_HTML, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'user-agent': 'AstrolabeWebSearch/0.1',
      },
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: 'follow',
    });
    if (!response.ok) return [];
    const html = await response.text();
    return parseDdgHtml(html).slice(0, MAX_RESULTS);
  } catch {
    return [];
  }
}

function parseDdgHtml(html: string): WebSearchHit[] {
  const { document } = parseHTML(html);
  const hits: WebSearchHit[] = [];
  const results = document.querySelectorAll('.result, .web-result, .results_links');

  for (const node of results) {
    const titleEl =
      node.querySelector('a.result__a') ??
      node.querySelector('.result__title a') ??
      node.querySelector('a[href]');
    const snippetEl =
      node.querySelector('.result__snippet') ??
      node.querySelector('.result__body') ??
      node.querySelector('.snippet');
    if (!titleEl) continue;

    const title = (titleEl.textContent ?? '').replace(/\s+/g, ' ').trim();
    let href = titleEl.getAttribute('href') ?? '';
    href = unwrapDdgRedirect(href);
    const snippet = (snippetEl?.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (!title || !href.startsWith('http')) continue;
    hits.push({ title, url: href, snippet: snippet.slice(0, 400) });
  }

  return hits;
}

/** DDG wraps outbound links as //duckduckgo.com/l/?uddg=<encoded>. */
function unwrapDdgRedirect(href: string): string {
  try {
    const absolute = href.startsWith('//') ? `https:${href}` : href;
    const url = new URL(absolute, 'https://duckduckgo.com');
    const uddg = url.searchParams.get('uddg');
    if (uddg) return decodeURIComponent(uddg);
    return absolute;
  } catch {
    return href;
  }
}

/** Stable synthetic ids for Citation rows that are not in Postgres. */
export function webHitIds(url: string): { chunkId: string; documentId: string } {
  const digest = createHash('sha256').update(url).digest('hex').slice(0, 32);
  const a = digest.slice(0, 8);
  const b = digest.slice(8, 12);
  const c = digest.slice(12, 16);
  const d = digest.slice(16, 20);
  const e = digest.slice(20, 32);
  const uuid = `${a}-${b}-${c}-${d}-${e}`;
  return { chunkId: uuid, documentId: uuid };
}

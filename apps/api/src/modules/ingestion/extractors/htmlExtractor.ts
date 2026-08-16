import { parseHTML } from 'linkedom';
import { isProbablyReaderable, Readability } from '@mozilla/readability';
import type { Block, BlockKind } from '@astrolabe/shared-types';
import { ExtractionError } from './errors.js';

const HEADING_LEVEL_BY_TAG: Record<string, number> = { H1: 1, H2: 2, H3: 3, H4: 4, H5: 5, H6: 6 };

// Readability.parse() doesn't reliably return null on unreadable pages — fed
// a <nav>-only page in testing, it still returned a non-null article whose
// textContent was a single word. isProbablyReaderable() is the intended
// pre-check for exactly this; the length floor below is a second, blunter
// safety net in case that heuristic itself passes on near-empty content.
const MIN_ARTICLE_TEXT_LENGTH = 200;

/**
 * DOCX (via mammoth) and web pages (via Readability) both reduce to HTML —
 * this is the one walker both go through (ADR 0006), so the two extractors
 * below differ only in how they get to that HTML, not in how blocks are
 * produced from it.
 *
 * `root` is a linkedom element — typed `any` deliberately: linkedom's own
 * TypeScript support is partial (`parseHTML` resolves to `Window &
 * typeof globalThis`), and apps/api's tsconfig has no "dom" lib to check
 * against the real DOM types either. Correctness here is verified at
 * runtime, not by the type checker.
 */
function walkToBlocks(root: any): Block[] {
  const blocks: Block[] = [];
  const headingStack: string[] = [];

  const sectionPath = (): string | undefined => {
    const path = headingStack.filter(Boolean);
    return path.length > 0 ? path.join(' > ') : undefined;
  };

  const withLocator = (kind: BlockKind, text: string): Block => {
    const section = sectionPath();
    return { kind, text, locator: section !== undefined ? { sectionPath: section } : {} };
  };

  const visit = (node: any): void => {
    const tag = node.tagName;
    const headingLevel = HEADING_LEVEL_BY_TAG[tag];

    if (headingLevel !== undefined) {
      const text = node.textContent?.trim() ?? '';
      if (text) {
        headingStack[headingLevel - 1] = text;
        headingStack.length = headingLevel;
        const section = sectionPath();
        blocks.push({ kind: 'heading', level: headingLevel, text, locator: section !== undefined ? { sectionPath: section } : {} });
      }
      return;
    }

    if (tag === 'P') {
      const text = node.textContent?.trim() ?? '';
      if (text) blocks.push(withLocator('paragraph', text));
      return;
    }
    if (tag === 'LI') {
      const text = node.textContent?.trim() ?? '';
      if (text) blocks.push(withLocator('listItem', text));
      return;
    }
    if (tag === 'TR') {
      const cells = [...node.querySelectorAll('td, th')].map((cell) => cell.textContent?.trim() ?? '');
      const text = cells.filter(Boolean).join(' | ');
      if (text) blocks.push(withLocator('tableRow', text));
      return;
    }
    if (tag === 'PRE' || tag === 'CODE') {
      const text = node.textContent?.trim() ?? '';
      if (text) blocks.push(withLocator('code', text));
      return;
    }
    if (tag === 'FIGCAPTION' || tag === 'CAPTION') {
      const text = node.textContent?.trim() ?? '';
      if (text) blocks.push(withLocator('caption', text));
      return;
    }

    for (const child of [...node.children]) visit(child);
  };

  visit(root);
  return blocks;
}

function extractHtmlBlocks(html: string): Block[] {
  // linkedom only populates document.body's children when the fragment is
  // wrapped in a real <html> element — a bare <body> wrapper silently
  // parses to zero children (verified empirically, not documented).
  const { document } = parseHTML(`<!doctype html><html><body>${html}</body></html>`);
  return walkToBlocks(document.body);
}

/** DOCX extractor (ADR 0006): mammoth converts to HTML, shared walker turns that into Block[]. */
export async function extractDocx(buffer: Buffer): Promise<Block[]> {
  const mammoth = await import('mammoth');
  const { value: html } = await mammoth.convertToHtml({ buffer });
  return extractHtmlBlocks(html);
}

/** Web page extractor (ADR 0006): Readability finds the main content, shared walker turns that into Block[]. Throws ExtractionError('web_no_main_content') when Readability can't identify an article. */
export function extractWebPage(html: string, url: string): Block[] {
  const { document } = parseHTML(html, { location: url });
  if (!isProbablyReaderable(document as any)) {
    throw new ExtractionError('web_no_main_content', `no main content detected at ${url}`);
  }
  const reader = new Readability(document as any);
  const article = reader.parse();
  if (!article || article.textContent.trim().length < MIN_ARTICLE_TEXT_LENGTH) {
    throw new ExtractionError('web_no_main_content', `no main content detected at ${url}`);
  }
  return extractHtmlBlocks(article.content);
}

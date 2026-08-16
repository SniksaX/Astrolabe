import type { Block, BlockKind, ChunkAnchor } from '@astrolabe/shared-types';

/**
 * 400-600 "tokens" (spec) converted to a character budget rather than a
 * real token count (ADR 0006): the target inference providers serve
 * open-weight models (Mistral, Qwen, Llama), each with its own tokenizer —
 * a GPT tokenizer count would be precise for a model that isn't in use.
 * The chunker doesn't need to be exact to the token, only to keep the real
 * context budget from being exceeded; a character budget with a documented
 * ratio and margin does that, stably, regardless of which provider is
 * active.
 *
 * ~4 chars/token is a conservative average across open-weight tokenizers
 * for English/French prose (French runs slightly higher due to accented
 * characters splitting more often). 400-600 tokens -> 1600-2400 chars raw;
 * the upper bound is tightened by ~15% margin since overshooting the
 * context budget is the real risk — undershooting is harmless.
 */
const CHARS_PER_TOKEN = 4;
const TARGET_MIN_CHARS = 400 * CHARS_PER_TOKEN; // 1600
const TARGET_MAX_CHARS = Math.round(600 * CHARS_PER_TOKEN * 0.85); // ~2040
const OVERLAP_CHARS = Math.round(TARGET_MAX_CHARS * 0.15); // ~300, ~15% recouvrement

const SENTENCE_BOUNDARY = /(?<=[.?!])\s+/;

export interface ChunkDraft {
  chunkIndex: number;
  content: string;
  contextPrefix: string | null;
  anchor: ChunkAnchor;
}

interface AggregatedLocator {
  pageFrom?: number;
  pageTo?: number;
  startSec?: number;
  endSec?: number;
  sectionPath?: string;
}

/**
 * Lines appearing on more than half of a PDF's pages are running
 * headers/footers, not content — dropped before chunking rather than
 * anywhere else, since only the chunker sees every block of a document at
 * once (extractors may run per-page). No-op for non-PDF documents: only
 * blocks carrying `locator.page` participate.
 */
function stripPageFurniture(blocks: readonly Block[]): Block[] {
  const pages = new Set(blocks.map((block) => block.locator.page).filter((page): page is number => page !== undefined));
  if (pages.size < 2) return [...blocks];

  const pagesByText = new Map<string, Set<number>>();
  for (const block of blocks) {
    if (block.locator.page === undefined) continue;
    const key = block.text.trim().toLowerCase();
    if (!key) continue;
    const set = pagesByText.get(key) ?? new Set<number>();
    set.add(block.locator.page);
    pagesByText.set(key, set);
  }

  const furniture = new Set(
    [...pagesByText.entries()].filter(([, pageSet]) => pageSet.size > pages.size / 2).map(([text]) => text),
  );
  if (furniture.size === 0) return [...blocks];
  return blocks.filter((block) => block.locator.page === undefined || !furniture.has(block.text.trim().toLowerCase()));
}

/** Never cuts mid-sentence — a block that alone exceeds the char budget is split at sentence boundaries instead of a hard character cut. */
function splitAtSentences(text: string, maxChars: number): string[] {
  const sentences = text
    .split(SENTENCE_BOUNDARY)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
  if (sentences.length === 0) return [text];

  const pieces: string[] = [];
  let current = '';
  for (const sentence of sentences) {
    if (current.length > 0 && current.length + sentence.length + 1 > maxChars) {
      pieces.push(current);
      current = sentence;
    } else {
      current = current.length === 0 ? sentence : `${current} ${sentence}`;
    }
  }
  if (current.length > 0) pieces.push(current);
  return pieces;
}

function aggregateLocator(blocks: readonly Block[]): AggregatedLocator {
  const pages = blocks.map((block) => block.locator.page).filter((page): page is number => page !== undefined);
  const starts = blocks.map((block) => block.locator.startSec).filter((sec): sec is number => sec !== undefined);
  const ends = blocks.map((block) => block.locator.endSec).filter((sec): sec is number => sec !== undefined);
  const sectionPath = blocks.find((block) => block.locator.sectionPath !== undefined)?.locator.sectionPath;

  const locator: AggregatedLocator = {};
  if (pages.length > 0) {
    locator.pageFrom = Math.min(...pages);
    locator.pageTo = Math.max(...pages);
  }
  if (starts.length > 0) locator.startSec = Math.min(...starts);
  if (ends.length > 0) locator.endSec = Math.max(...ends);
  if (sectionPath !== undefined) locator.sectionPath = sectionPath;
  return locator;
}

/**
 * Collapses the aggregated (possibly ranged) locator into the existing
 * three-way ChunkAnchor. Known gap, not resolved here: ChunkAnchor only
 * holds a single page, while docs/ModelisationAstrolabe.html's
 * document_chunks models page_from/page_to as a real range — an aggregated
 * page range collapses to its start page until that's reconciled (flagged
 * in docs/journal.md and ADR 0006 as a follow-up decision).
 */
function toChunkAnchor(locator: AggregatedLocator): ChunkAnchor {
  if (locator.sectionPath !== undefined) return { kind: 'section', section: locator.sectionPath };
  if (locator.startSec !== undefined && locator.endSec !== undefined) {
    return { kind: 'timestamp', startSec: locator.startSec, endSec: locator.endSec };
  }
  if (locator.pageFrom !== undefined) return { kind: 'page', page: locator.pageFrom };
  return { kind: 'section', section: null };
}

/**
 * The one format-agnostic chunker (ADR 0006): every extractor's Block[]
 * goes through this. New fragment at each level-1/2 heading; otherwise
 * accumulates toward the char budget above, splitting only at sentence
 * boundaries; short blocks are absorbed rather than force-flushed (the
 * min-chars gate below is exactly this); a table's header row is
 * re-prefixed if a char-budget split falls mid-table.
 */
export function chunkBlocks(blocks: readonly Block[], documentTitle?: string): ChunkDraft[] {
  const cleaned = stripPageFurniture(blocks);
  const drafts: ChunkDraft[] = [];

  const headingStack: string[] = [];
  let currentTableHeader: string | null = null;

  let bufferBlocks: Block[] = [];
  let bufferChars = 0;
  let bufferPrefix: string | null = null;
  let overlapSeed = '';

  const breadcrumb = (): string | null => {
    const parts = [documentTitle, ...headingStack].filter((part): part is string => Boolean(part));
    return parts.length > 0 ? parts.join(' > ') : null;
  };

  const flush = (): void => {
    if (bufferBlocks.length === 0) return;
    const text = [overlapSeed, ...bufferBlocks.map((block) => block.text)].filter(Boolean).join(' ');
    drafts.push({
      chunkIndex: drafts.length,
      content: text.trim(),
      contextPrefix: bufferPrefix,
      anchor: toChunkAnchor(aggregateLocator(bufferBlocks)),
    });
  };

  const startNewFragment = (seedOverlap: boolean): void => {
    const previousBlocks = bufferBlocks;
    flush();
    overlapSeed =
      seedOverlap && previousBlocks.length > 0
        ? previousBlocks
            .map((block) => block.text)
            .join(' ')
            .slice(-OVERLAP_CHARS)
        : '';
    bufferBlocks = [];
    bufferChars = overlapSeed.length;
    bufferPrefix = breadcrumb();
  };
  bufferPrefix = breadcrumb();

  const addPiece = (kind: BlockKind, text: string, locatorSource: Block): void => {
    if (bufferBlocks.length === 0 && kind === 'tableRow' && currentTableHeader !== null && text !== currentTableHeader) {
      const headerBlock: Block = { kind: 'tableRow', text: currentTableHeader, locator: locatorSource.locator };
      bufferBlocks.push(headerBlock);
      bufferChars += currentTableHeader.length;
    }
    bufferBlocks.push({ kind, text, locator: locatorSource.locator });
    bufferChars += text.length;
  };

  for (const block of cleaned) {
    currentTableHeader = block.kind === 'tableRow' ? (currentTableHeader ?? block.text) : null;

    if (block.kind === 'heading' && (block.level === 1 || block.level === 2)) {
      if (block.level === 1) {
        headingStack[0] = block.text;
        headingStack.length = 1;
      } else {
        headingStack[1] = block.text;
        headingStack.length = 2;
      }
      startNewFragment(false);
      continue;
    }

    const pieces = block.text.length > TARGET_MAX_CHARS ? splitAtSentences(block.text, TARGET_MAX_CHARS) : [block.text];
    for (const piece of pieces) {
      if (bufferChars > 0 && bufferChars >= TARGET_MIN_CHARS && bufferChars + piece.length + 1 > TARGET_MAX_CHARS) {
        startNewFragment(true);
      }
      addPiece(block.kind, piece, block);
    }
  }
  flush();

  return drafts;
}

export type BlockKind = 'heading' | 'paragraph' | 'listItem' | 'tableRow' | 'code' | 'caption';

/**
 * Exactly one of page / (startSec, endSec) / sectionPath is populated,
 * depending on which extractor produced the block (PDF / YouTube / HTML —
 * see ADR 0006). Not a discriminated union: the generic chunker aggregates
 * locators across many blocks (page min→max, second min→max) without
 * needing to narrow on extractor identity first.
 */
export interface BlockLocator {
  page?: number;
  startSec?: number;
  endSec?: number;
  sectionPath?: string;
}

/** Extraction output (ADR 0006): format-specific extractors produce Block[], one format-agnostic chunker consumes it. */
export interface Block {
  kind: BlockKind;
  /** Heading depth (1 = title). Only meaningful when kind === 'heading'. */
  level?: number;
  text: string;
  locator: BlockLocator;
}

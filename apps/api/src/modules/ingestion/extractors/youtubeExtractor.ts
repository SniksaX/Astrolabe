import type { Block } from '@astrolabe/shared-types';
import { ExtractionError } from './errors.js';

export interface TranscriptSegment {
  text: string;
  startSec: number;
  endSec: number;
}

/**
 * YouTube extractor (ADR 0006): one block per subtitle segment, no
 * sentence-grouping here — that's chunking, not extraction, and now lives
 * in chunker.ts along with every other format. Throws
 * ExtractionError('video_no_subtitles') when there's nothing usable left
 * after dropping blank segments (covers both "no captions at all" and
 * "captions present but empty").
 */
export function extractYoutubeTranscript(segments: readonly TranscriptSegment[]): Block[] {
  const blocks: Block[] = segments
    .filter((segment) => segment.text.trim().length > 0)
    .map((segment) => ({
      kind: 'paragraph',
      text: segment.text.trim(),
      locator: { startSec: segment.startSec, endSec: segment.endSec },
    }));

  if (blocks.length === 0) {
    throw new ExtractionError('video_no_subtitles', 'no usable subtitles found for this video');
  }
  return blocks;
}

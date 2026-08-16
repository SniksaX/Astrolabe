// Public interface of the ingestion module — every cross-module reference must go through here.
export { ingestionRouter } from './router.js';
export { documentIngestService, DocumentIngestService } from './service.js';
export type { IngestJobHandle, IngestQueue } from './queue.js';
export { chunkBlocks, type ChunkDraft } from './chunker.js';
export {
  extractPdf,
  extractDocx,
  extractWebPage,
  extractYoutubeTranscript,
  ExtractionError,
  type ExtractionFailureReason,
  type TranscriptSegment,
} from './extractors/index.js';

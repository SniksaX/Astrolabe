export type ExtractionFailureReason = 'pdf_no_text_layer' | 'video_no_subtitles' | 'web_no_main_content';

/**
 * The three explicit ingestion failure modes (ADR 0006). Caught by
 * DocumentIngestService.processJob, which marks the document 'failed' with
 * `reason` recorded in documents.failureReason — never a generic error
 * message the user can't act on.
 */
export class ExtractionError extends Error {
  constructor(
    public readonly reason: ExtractionFailureReason,
    message: string,
  ) {
    super(message);
  }
}

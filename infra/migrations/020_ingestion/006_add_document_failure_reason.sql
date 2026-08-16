-- Additive: 001_create_documents already ran. One of three explicit
-- ingestion failure modes is recorded here when status = 'failed' (ADR
-- 0006) — PDF without a text layer, video without usable subtitles, web
-- page without detected main content.
ALTER TABLE documents ADD COLUMN failure_reason text;

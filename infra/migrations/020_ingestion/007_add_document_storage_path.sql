-- Additive: where on-disk upload bytes live for processJob (PDF/DOCX).
-- Never store the raw file in Postgres — path only, under UPLOAD_DIR.
ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS storage_path text;

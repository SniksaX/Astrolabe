-- fts_vector is a STORED generated column, which requires an immutable
-- expression — the FTS language config can't be a runtime app setting here
-- the way EMBEDDING_API-style config is elsewhere. Hardcoded to 'english'
-- for now; multi-language support is a follow-up (trigger-based tsvector
-- instead of GENERATED, config validated the same way config-core validates
-- other SQL identifiers).
CREATE TABLE document_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
  -- Denormalized from documents so RLS and retrieval filters don't need a join.
  owner_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  chunk_index int NOT NULL,
  content text NOT NULL,
  context_prefix text,
  anchor_kind text NOT NULL CHECK (anchor_kind IN ('timestamp', 'page', 'section')),
  anchor_start_sec numeric,
  anchor_end_sec numeric,
  anchor_page int,
  anchor_section text,
  embedding vector (1024),
  fts_vector tsvector GENERATED ALWAYS AS (to_tsvector('english', content)) STORED,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (document_id, chunk_index)
);

CREATE INDEX document_chunks_owner_id_idx ON document_chunks (owner_id);
CREATE INDEX document_chunks_fts_idx ON document_chunks USING gin (fts_vector);

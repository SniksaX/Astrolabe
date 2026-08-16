-- Two structurally distinct tables — never merge them (see modules/ingestion/cache/embeddingCache.ts).

-- Public: content-hash keyed, no user_id — shared across every user who ingests the same public URL.
CREATE TABLE public_embedding_cache (
  content_hash text PRIMARY KEY,
  embedding vector (1024) NOT NULL,
  dim int NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Private: keyed by (user_id, content_hash), RLS-protected — never queried without a user_id.
CREATE TABLE private_embedding_cache (
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  content_hash text NOT NULL,
  embedding vector (1024) NOT NULL,
  dim int NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, content_hash)
);

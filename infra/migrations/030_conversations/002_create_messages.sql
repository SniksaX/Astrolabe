-- input_kind/model/token_count are added now rather than in a later migration:
-- known columns from docs/ModelisationAstrolabe.html, cost is zero to add up
-- front. input_kind defaults to 'text' — voice/ (module) is deferred to J4,
-- but the column already has somewhere to record it once that lands.
CREATE TABLE messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
  -- Denormalized from conversations so RLS can filter without a join (same
  -- rationale as document_chunks.owner_id).
  owner_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user', 'assistant')),
  content text NOT NULL,
  input_kind text NOT NULL DEFAULT 'text' CHECK (input_kind IN ('text', 'voice')),
  -- model/token_count: null for role = 'user' (nothing produced them); set
  -- for role = 'assistant'. token_count feeds the cost chapter (C29).
  model text,
  token_count integer,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX messages_owner_id_idx ON messages (owner_id);
CREATE INDEX messages_conversation_id_idx ON messages (conversation_id);

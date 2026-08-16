-- Persist chat UI metadata (steps, CoT, display citations including web)
-- and per-conversation generation settings (effort, toggles, knobs).

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS reasoning text,
  ADD COLUMN IF NOT EXISTS activity jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS citations_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS clarification jsonb;

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS settings jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN messages.reasoning IS 'Optional model CoT shown under Raisonnement';
COMMENT ON COLUMN messages.activity IS 'Pipeline / agent step labels (Étapes)';
COMMENT ON COLUMN messages.citations_json IS 'Display snapshot of citations (corpus + web)';
COMMENT ON COLUMN messages.clarification IS 'Clarification prompt {question, options} when applicable';
COMMENT ON COLUMN conversations.settings IS 'Last UI config: effort, thinking, web/rag, generation knobs';

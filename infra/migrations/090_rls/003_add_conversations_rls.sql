-- Additive: 090_rls/001 and 002 already ran. RLS for tables that didn't
-- exist yet when those files were applied (conversations/messages/
-- message_citations, 030_conversations) lives here instead — an applied
-- migration is never edited, a new one is added (see docs/journal.md).
-- Runs after 030_conversations regardless of DB state: numbered after it,
-- and on a fresh database 030_conversations/* sorts before 090_rls/* anyway.

ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations FORCE ROW LEVEL SECURITY;

ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages FORCE ROW LEVEL SECURITY;

-- No owner_id on message_citations (030_conversations/003) — RLS reaches
-- ownership through messages instead, in the policy below.
ALTER TABLE message_citations ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_citations FORCE ROW LEVEL SECURITY;

CREATE POLICY conversations_isolation ON conversations
  USING (owner_id = current_setting('app.user_id', true)::uuid)
  WITH CHECK (owner_id = current_setting('app.user_id', true)::uuid);

CREATE POLICY messages_isolation ON messages
  USING (owner_id = current_setting('app.user_id', true)::uuid)
  WITH CHECK (owner_id = current_setting('app.user_id', true)::uuid);

-- message_citations has no owner_id of its own (030_conversations/003) —
-- ownership is reached through messages, at the cost of a subquery instead
-- of a flat column comparison like every other policy here.
CREATE POLICY message_citations_isolation ON message_citations
  USING (
    EXISTS (
      SELECT 1 FROM messages m
      WHERE m.id = message_citations.message_id
        AND m.owner_id = current_setting('app.user_id', true)::uuid
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM messages m
      WHERE m.id = message_citations.message_id
        AND m.owner_id = current_setting('app.user_id', true)::uuid
    )
  );

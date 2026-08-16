-- current_setting(..., true) returns NULL instead of raising when app.user_id
-- isn't set for the session — comparing owner_id/user_id = NULL is false for
-- every row, so a request that forgot to set the session var sees nothing
-- rather than everything. Fail closed, not open.

CREATE POLICY documents_isolation ON documents
  USING (owner_id = current_setting('app.user_id', true)::uuid)
  WITH CHECK (owner_id = current_setting('app.user_id', true)::uuid);

CREATE POLICY document_chunks_isolation ON document_chunks
  USING (owner_id = current_setting('app.user_id', true)::uuid)
  WITH CHECK (owner_id = current_setting('app.user_id', true)::uuid);

CREATE POLICY private_embedding_cache_isolation ON private_embedding_cache
  USING (user_id = current_setting('app.user_id', true)::uuid)
  WITH CHECK (user_id = current_setting('app.user_id', true)::uuid);

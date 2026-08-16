-- refresh_tokens is deliberately excluded: it's read before a request has an
-- app.user_id session context (login/refresh happen pre-session), so it stays
-- protected by application-level parameterized WHERE clauses instead.

ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents FORCE ROW LEVEL SECURITY;

ALTER TABLE document_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_chunks FORCE ROW LEVEL SECURITY;

ALTER TABLE private_embedding_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE private_embedding_cache FORCE ROW LEVEL SECURITY;

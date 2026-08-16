-- Composite primary key, no surrogate id — a message can't cite the same
-- chunk twice. No owner_id here (unlike document_chunks/messages): this is a
-- pure link table, RLS below reaches ownership through messages instead of
-- denormalizing a third copy of the column (docs/ModelisationAstrolabe.html
-- doesn't carry one either — kept consistent with it).
--
-- Not snapshotting document_title/anchor/snippet: those already live on
-- document_chunks/documents, a join at read time is enough. Consequence:
-- deleting a document cascades to its chunks, which cascades to any
-- citation pointing at them — the historical message keeps its text but
-- loses that citation. The UI must show this explicitly, not silently.
CREATE TABLE message_citations (
  message_id uuid NOT NULL REFERENCES messages (id) ON DELETE CASCADE,
  chunk_id uuid NOT NULL REFERENCES document_chunks (id) ON DELETE CASCADE,
  rank smallint NOT NULL,
  score real NOT NULL,
  PRIMARY KEY (message_id, chunk_id)
);

CREATE INDEX message_citations_chunk_id_idx ON message_citations (chunk_id);

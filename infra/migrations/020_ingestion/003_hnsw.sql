CREATE INDEX document_chunks_embedding_hnsw_idx
  ON document_chunks USING hnsw (embedding vector_cosine_ops)
  WITH (m = 32, ef_construction = 200);

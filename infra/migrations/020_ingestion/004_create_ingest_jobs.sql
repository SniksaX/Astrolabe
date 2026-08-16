CREATE TABLE ingest_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'ready', 'failed')),
  error text,
  enqueued_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz
);

-- Step 4: worker claims rows via `SELECT ... FOR UPDATE SKIP LOCKED` scoped to this partial index.
CREATE INDEX ingest_jobs_pending_idx ON ingest_jobs (enqueued_at) WHERE status = 'pending';

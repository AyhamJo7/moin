-- 0074 — approved passage rows with embedding version (P09.09.04 SELL).
--
-- `knowledge_passages` is a TENANT table (RLS + FORCE): chunk rows linked to
-- an approved version, carrying the embedding model version for the
-- re-embed job. The HNSW index lands with the vector column once the
-- embedding provider (P10.01 gateway) is wired — this migration is the row
-- shape + RLS + composite keys; vectors ride separately.

CREATE TABLE knowledge_passages (
  organisation_id uuid NOT NULL REFERENCES organisations (id) ON DELETE CASCADE,
  id              uuid NOT NULL PRIMARY KEY,
  version_id      uuid NOT NULL,
  chunk_index     integer NOT NULL CHECK (chunk_index >= 0),
  content         text NOT NULL CHECK (length(btrim(content)) BETWEEN 1 AND 4000),
  embedding_model text NOT NULL CHECK (length(btrim(embedding_model)) BETWEEN 1 AND 80),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, id),
  UNIQUE (organisation_id, version_id, chunk_index)
);

COMMENT ON TABLE knowledge_passages IS 'P09.09.04 SELL: chunk rows per approved version with embedding model version; HNSW rides the vector column.';

ALTER TABLE knowledge_passages ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_passages FORCE ROW LEVEL SECURITY;
CREATE POLICY knowledge_passages_tenant ON knowledge_passages
  USING (organisation_id = app.current_org())
  WITH CHECK (organisation_id = app.current_org());

GRANT SELECT, INSERT, UPDATE ON knowledge_passages TO moin_app;

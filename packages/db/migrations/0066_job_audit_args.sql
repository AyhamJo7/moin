-- 0066 — audit argument key for job discard (P08.06.02).
--
-- The discard audit carries one opaque marker: the reason length (a bounded
-- count, never the reason text — INV-12). Empty-args writers need no row;
-- this writer carries one key, so it registers one row.

INSERT INTO audit_argument_allowlist(operation, argument_key, value_kind, reason) VALUES
  ('job.discard', 'reason_length', 'count', 'length of the operator discard reason; opaque count, no content')
ON CONFLICT (operation, argument_key) DO NOTHING;

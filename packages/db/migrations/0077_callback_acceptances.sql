-- 0077 — callback acceptances (P12.12.03, INV-11; M1 corrective hotfix).
--
-- One row per accepted callback request, written in the same transaction as the business changes
-- the acceptance produced (call status, outcome, the task that carries the request). It is the
-- durable replay marker: a later delivery for the same provider call finds this row and changes
-- nothing, whichever task carries the request and whatever the owner has done with it since. The
-- task's own idempotency key cannot serve, because an adopted finaliser fallback keeps its key.
--
-- TENANT table (RLS + FORCE). Append-only for the runtime role: SELECT and INSERT, never UPDATE
-- or DELETE. UNIQUE (organisation_id, provider_call_sid) is the constraint behind the replay check,
-- which the capture runs under the CallSid advisory lock before it writes anything.
-- `request_hash` is SHA-256 over the accepted request's dialled number and summary (not the
-- caller number, which the call row holds and the service compares directly): a second delivery
-- for the same call with a different request is a conflict, not a replay. The links SET NULL so
-- erasure of the conversation or task (P16) never fails on this row; the row itself then remains
-- as the replay tombstone (SID, hash, time), which P16 must account for.
-- Expand-only: a new table, nothing existing changes (QG-08, INV-17).

CREATE TABLE callback_acceptances (
  organisation_id   uuid        NOT NULL REFERENCES organisations (id) ON DELETE CASCADE,
  id                uuid        NOT NULL PRIMARY KEY,
  provider_call_sid text        NOT NULL
                      CHECK (length(btrim(provider_call_sid)) BETWEEN 1 AND 100),
  conversation_id   uuid,
  task_id           uuid,
  request_hash      text        NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  accepted_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, id),
  UNIQUE (organisation_id, provider_call_sid),
  FOREIGN KEY (organisation_id, conversation_id) REFERENCES conversations (organisation_id, id)
    ON DELETE SET NULL (conversation_id),
  FOREIGN KEY (organisation_id, task_id) REFERENCES tasks (organisation_id, id)
    ON DELETE SET NULL (task_id)
);

-- migration-check: allow create-index-blocking because the table is created empty in this same
-- migration, so there is no writer to block (CONCURRENTLY cannot run inside the migration transaction).
-- Serves the Today read's per-task lookup and the task_id SET NULL on erasure.
CREATE INDEX callback_acceptances_task_idx ON callback_acceptances (organisation_id, task_id)
  WHERE task_id IS NOT NULL;
-- migration-check: allow create-index-blocking because the table is created empty in this same
-- migration. Serves the conversation_id SET NULL when a conversation is erased.
CREATE INDEX callback_acceptances_conversation_idx
  ON callback_acceptances (organisation_id, conversation_id) WHERE conversation_id IS NOT NULL;

COMMENT ON TABLE callback_acceptances IS
  'Accepted callback requests (P12.12.03, INV-11): the durable, tenant-scoped replay marker, written in the transaction that applied the request. Append-only for moin_app.';
COMMENT ON COLUMN callback_acceptances.provider_call_sid IS
  'The provider call the request belongs to; one acceptance per call and tenant.';
COMMENT ON COLUMN callback_acceptances.task_id IS
  'The task that carries the request (new, or an adopted finaliser fallback). SET NULL on erasure.';
COMMENT ON COLUMN callback_acceptances.request_hash IS
  'SHA-256 (hex) over the dialled number and summary: same call, different request is a conflict.';

SELECT app.apply_tenant_rls('callback_acceptances');

REVOKE ALL ON TABLE callback_acceptances
  FROM PUBLIC, moin_app, moin_identity, moin_provisioner, moin_dispatcher, moin_support_ro,
       moin_reporting;
GRANT SELECT, INSERT ON callback_acceptances TO moin_app;

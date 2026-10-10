-- 0039 — conversations, calls, events, messages stub, outcomes (P07.05.01).
-- migration-check: allow create-index-blocking because every index here is on a table created earlier in this same migration, so it is new and empty.
--
-- ## Channel-agnostic interactions
--
-- A `conversation` is one inbound interaction, whatever the channel: a call today, a message
-- thread in P27. `calls` holds the telephony leg (idempotent by provider SID, P07.05.02);
-- `call_events` is the ordered, append-only record of what happened during it (routing,
-- checkpoints, failures — the dropped-call diagnostic, INV-19); `messages` is the P27 stub
-- (thread rows only, no bodies yet); `interaction_outcomes` is the finaliser's verdict (P07.05.03,
-- INV-06: every interaction ends with an outcome or an open task, enforced in P07.11).
--
-- All tenant rows: organisation_id, composite uniques/FKs, RLS + FORCE, moin_app DML. Contact
-- legs are composite RESTRICT: a contact with history cannot be deleted outright — erasure
-- (P16) clears contact_id first, then deletes, so history is never silently re-homed or erased.
-- Outcomes link to the conversation strictly (CASCADE).
--
-- Status monotonicity lives in the service (compare-and-hold), not in a trigger: out-of-order
-- provider callbacks are kept as events but must not move the call backwards (P07.05.02).

CREATE TABLE conversations (
  organisation_id uuid        NOT NULL REFERENCES organisations (id) ON DELETE CASCADE,
  id              uuid        NOT NULL PRIMARY KEY,
  channel         text        NOT NULL CHECK (channel IN ('call', 'message')),
  contact_id      uuid,
  status          text        NOT NULL DEFAULT 'open'
                    CHECK (status IN ('open', 'handled', 'needs_action', 'closed')),
  version         integer     NOT NULL DEFAULT 1,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, id),
  -- Composite RESTRICT: a contact with history cannot be deleted outright. Erasure (P16)
  -- clears contact_id first, then deletes.
  FOREIGN KEY (organisation_id, contact_id) REFERENCES contacts (organisation_id, id) ON DELETE RESTRICT
);

CREATE TABLE calls (
  organisation_id uuid        NOT NULL,
  id              uuid        NOT NULL PRIMARY KEY,
  conversation_id uuid        NOT NULL,
  -- Provider's call SID: the idempotency key. One provider call, one row, retries included.
  provider_call_sid text      NOT NULL CHECK (length(btrim(provider_call_sid)) BETWEEN 1 AND 100),
  contact_id      uuid,
  -- Monotonic ladder: initiated < ringing < in_progress < completed, with failed/busy/no_answer
  -- as terminal siblings. The service holds the ladder; the DB stores the rung.
  status          text        NOT NULL DEFAULT 'initiated'
                    CHECK (status IN (
                      'initiated', 'ringing', 'in_progress', 'completed',
                      'failed', 'busy', 'no_answer'
                    )),
  from_number     text,
  to_number       text,
  started_at      timestamptz NOT NULL DEFAULT now(),
  ended_at        timestamptz,
  version         integer     NOT NULL DEFAULT 1,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, id),
  UNIQUE (organisation_id, provider_call_sid),
  FOREIGN KEY (organisation_id, conversation_id) REFERENCES conversations (organisation_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organisation_id, contact_id) REFERENCES contacts (organisation_id, id) ON DELETE RESTRICT
);

CREATE INDEX calls_conversation_idx ON calls (organisation_id, conversation_id);
CREATE INDEX calls_contact_idx ON calls (organisation_id, contact_id) WHERE contact_id IS NOT NULL;

COMMENT ON COLUMN calls.provider_call_sid IS 'Provider call SID: idempotency key, unique per tenant. Retried webhooks upsert the same row.';
COMMENT ON COLUMN calls.status IS 'Monotonic ladder (service-held): initiated < ringing < in_progress < completed; failed/busy/no_answer terminal. Out-of-order callbacks kept as events, never move it back.';

CREATE TABLE call_events (
  organisation_id uuid        NOT NULL,
  id              uuid        NOT NULL PRIMARY KEY,
  call_id         uuid        NOT NULL,
  -- routing | checkpoint | failure | status_change: what happened, in provider terms.
  kind            text        NOT NULL
                    CHECK (kind IN ('routing', 'checkpoint', 'failure', 'status_change')),
  -- Opaque detail marker (mapped to ints at the writer, INV-12). Never free text from the wire.
  detail          integer     NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, id),
  FOREIGN KEY (organisation_id, call_id) REFERENCES calls (organisation_id, id) ON DELETE CASCADE
);

CREATE INDEX call_events_call_idx ON call_events (organisation_id, call_id, created_at);

COMMENT ON TABLE call_events IS 'Append-only ordered record of a call (P07.05.02, INV-19). Every callback lands here, even one that must not move the call status.';

-- P27 stub: threads only, no bodies. Bodies (with retention + erasure) arrive with the inbox.
CREATE TABLE messages (
  organisation_id uuid        NOT NULL REFERENCES organisations (id) ON DELETE CASCADE,
  id              uuid        NOT NULL PRIMARY KEY,
  conversation_id uuid        NOT NULL,
  thread_ref      text        NOT NULL CHECK (length(btrim(thread_ref)) BETWEEN 1 AND 254),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, id),
  UNIQUE (organisation_id, thread_ref),
  FOREIGN KEY (organisation_id, conversation_id) REFERENCES conversations (organisation_id, id) ON DELETE CASCADE
);

COMMENT ON TABLE messages IS 'P27 stub: thread identity only. Bodies, retention and erasure arrive with the inbox (P27).';

CREATE TABLE interaction_outcomes (
  organisation_id uuid        NOT NULL,
  id              uuid        NOT NULL PRIMARY KEY,
  conversation_id uuid        NOT NULL,
  -- Canonical result of the interaction (closed set); template_intent names the P10 template
  -- that classified it (NULL until templates exist).
  result_code     text        NOT NULL
                    CHECK (result_code IN (
                      'handled', 'callback_requested', 'booking_requested', 'complaint',
                      'spam', 'wrong_number', 'unresolved'
                    )),
  template_intent text,
  -- Facts validated against the versioned template schema named by facts_schema_version.
  -- Until the P07.09 registry exists no validator can check a non-empty payload, so the DB admits
  -- only the empty one; the service rejects any other version outright (RangeError).
  facts_schema_version text NOT NULL DEFAULT 'v0-none',
  facts           jsonb       NOT NULL DEFAULT '{}',
  handled_automatically boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, id),
  UNIQUE (organisation_id, conversation_id),
  FOREIGN KEY (organisation_id, conversation_id) REFERENCES conversations (organisation_id, id) ON DELETE CASCADE,
  CHECK (facts_schema_version = 'v0-none' AND facts = '{}')
);

COMMENT ON TABLE interaction_outcomes IS 'Finaliser verdicts (P07.05.03, INV-06). One per conversation; facts validate against the declared schema version (P07.09).';
COMMENT ON COLUMN interaction_outcomes.result_code IS 'Closed canonical set; owner-visible result of the interaction.';
COMMENT ON COLUMN interaction_outcomes.facts IS 'Schema-versioned facts JSONB. Until the P07.09 registry exists only {} with v0-none is accepted.';

SELECT app.apply_tenant_rls('conversations');
SELECT app.apply_tenant_rls('calls');
SELECT app.apply_tenant_rls('call_events');
SELECT app.apply_tenant_rls('messages');
SELECT app.apply_tenant_rls('interaction_outcomes');

REVOKE ALL ON TABLE conversations, calls, call_events, messages, interaction_outcomes
  FROM PUBLIC, moin_app, moin_identity, moin_provisioner, moin_dispatcher, moin_support_ro,
       moin_reporting;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON conversations, calls, messages, interaction_outcomes TO moin_app;

-- call_events is append-only: the runtime role may write and read, never rewrite or erase.
GRANT SELECT, INSERT ON call_events TO moin_app;

-- Reviewed audit argument keys (P06.10.03, P06.10.07, INV-12). Markers and counts only.
INSERT INTO audit_argument_allowlist(operation, argument_key, value_kind, reason) VALUES
  ('conversation.start', 'channel', 'count', 'channel as opaque marker (0=call,1=message); no payload'),
  ('call.status', 'status', 'count', 'new status rung as opaque marker (0..6 in ladder order); no wire text'),
  ('outcome.record', 'result', 'count', 'result_code as opaque marker (0..6 in CHECK order); no facts')
ON CONFLICT (operation, argument_key) DO NOTHING;

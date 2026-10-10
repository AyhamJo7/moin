-- 0045 — governance records: AI actions, tool invocations, approvals, workflow runs (P07.10.01, P07.10.02).
-- migration-check: allow create-index-blocking because every index here is on a table created earlier in this same migration, so it is new and empty.
--
-- ## Whose action was it
--
-- Every tool execution in this product has an actor: either an AI action (the assistant acting
-- under a workflow run) or a user (staff clicking in the owner app). `tool_invocations` carries
-- exactly one of the two (CHECK): an invocation with neither is unattributable, one with both
-- is ambiguous. New invocations land in `unknown` state — the outcome is not known until the
-- tool reports back — and move to succeeded/failed/rejected exactly once.
--
-- `human_approvals` gates the sensitive half: a proposed action waits for a staff decision
-- (approved/rejected/expired), and the approval row names who decided. `workflow_runs` groups
-- actions per interaction run with its own terminal states. `ai_actions` records the
-- assistant's own steps (prompt summaries are opaque markers, never prompt text — INV-12).
--
-- ## TTL without a scheduler
--
-- Each table carries `expires_at` (NULL = retain). No pg_cron: the sweeper (P08/P15) reads
-- `*_purge_candidates` views... no views — it queries `where expires_at is not null and
-- expires_at <= now()` directly. Retention policy (what expires when) is a P15 operations
-- decision; this migration only provides the column, the index, and the candidate query shape
-- the tests pin.
--
-- Tenant rows: organisation_id, composite uniques/FKs, RLS + FORCE, moin_app DML (no DELETE:
-- governance history is append-only like interactions; erasure runs privileged). Relationships
-- that exist: `correlation_id` on every table (joins to audit rows), `conversation_id` on runs
-- and actions, `workflow_run_id` on actions, `ai_action_id` on invocations and approvals.
-- Lead/task linkage arrives with the P07.11 finaliser needs; no lead_id/task_id columns here.

CREATE TABLE workflow_runs (
  organisation_id uuid        NOT NULL REFERENCES organisations (id) ON DELETE CASCADE,
  id              uuid        NOT NULL PRIMARY KEY,
  conversation_id uuid,
  status          text        NOT NULL DEFAULT 'running'
                    CHECK (status IN ('running', 'succeeded', 'failed', 'cancelled')),
  correlation_id  uuid,
  expires_at      timestamptz,
  version         integer     NOT NULL DEFAULT 1,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, id),
  FOREIGN KEY (organisation_id, conversation_id) REFERENCES conversations (organisation_id, id) ON DELETE SET NULL (conversation_id)
);

CREATE INDEX workflow_runs_expiry_idx ON workflow_runs (organisation_id, expires_at)
  WHERE expires_at IS NOT NULL;

COMMENT ON TABLE workflow_runs IS 'Assistant run groups per interaction (P07.10). Terminal states succeeded/failed/cancelled; correlation_id joins to audit rows.';
COMMENT ON COLUMN workflow_runs.expires_at IS 'TTL instant (NULL = retain). The sweeper reads expires_at <= now(); policy is a P15 decision.';

CREATE TABLE ai_actions (
  organisation_id uuid        NOT NULL REFERENCES organisations (id) ON DELETE CASCADE,
  id              uuid        NOT NULL PRIMARY KEY,
  workflow_run_id uuid,
  conversation_id uuid,
  -- What the assistant did, as a closed catalogue value — never prompt text (INV-12).
  kind            text        NOT NULL
                    CHECK (kind IN (
                      'reply', 'tool_call', 'escalate', 'handoff', 'summarise', 'classify'
                    )),
  status          text        NOT NULL DEFAULT 'done'
                    CHECK (status IN ('done', 'failed')),
  correlation_id  uuid,
  expires_at      timestamptz,
  version         integer     NOT NULL DEFAULT 1,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, id),
  FOREIGN KEY (organisation_id, workflow_run_id) REFERENCES workflow_runs (organisation_id, id) ON DELETE SET NULL (workflow_run_id),
  FOREIGN KEY (organisation_id, conversation_id) REFERENCES conversations (organisation_id, id) ON DELETE SET NULL (conversation_id)
);

CREATE INDEX ai_actions_run_idx ON ai_actions (organisation_id, workflow_run_id)
  WHERE workflow_run_id IS NOT NULL;
CREATE INDEX ai_actions_expiry_idx ON ai_actions (organisation_id, expires_at)
  WHERE expires_at IS NOT NULL;

COMMENT ON TABLE ai_actions IS 'Assistant steps (P07.10). Kind catalogue only — prompts and payloads never stored here.';
COMMENT ON COLUMN ai_actions.kind IS 'Closed catalogue: reply/tool_call/escalate/handoff/summarise/classify. No free text.';

CREATE TABLE tool_invocations (
  organisation_id uuid        NOT NULL REFERENCES organisations (id) ON DELETE CASCADE,
  id              uuid        NOT NULL PRIMARY KEY,
  -- Exactly one actor: the AI action that called, or the staff user who clicked. Never neither
  -- (unattributable), never both (ambiguous).
  ai_action_id    uuid,
  actor_user_id   uuid,
  tool_name       text        NOT NULL CHECK (length(btrim(tool_name)) BETWEEN 1 AND 120),
  -- Unknown at insert: the outcome is not known until the tool reports back.
  state           text        NOT NULL DEFAULT 'unknown'
                    CHECK (state IN ('unknown', 'succeeded', 'failed', 'rejected')),
  correlation_id  uuid,
  expires_at      timestamptz,
  version         integer     NOT NULL DEFAULT 1,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, id),
  -- RESTRICT, not SET NULL: purging an action still referenced by a live invocation would
  -- null the only actor and violate the exactly-one-actor CHECK. Sweep order is leaf-first:
  -- invocations, then actions, then runs; approvals reference actions loosely (SET NULL below)
  -- because an approval names its decider, not its action, as the attribution.
  FOREIGN KEY (organisation_id, ai_action_id) REFERENCES ai_actions (organisation_id, id) ON DELETE RESTRICT,
  CHECK (
    (ai_action_id IS NOT NULL AND actor_user_id IS NULL)
    OR (ai_action_id IS NULL AND actor_user_id IS NOT NULL)
  )
);

CREATE INDEX tool_invocations_action_idx ON tool_invocations (organisation_id, ai_action_id)
  WHERE ai_action_id IS NOT NULL;
CREATE INDEX tool_invocations_expiry_idx ON tool_invocations (organisation_id, expires_at)
  WHERE expires_at IS NOT NULL;

COMMENT ON TABLE tool_invocations IS 'Tool executions (P07.10). Exactly one actor (AI action xor staff user); unknown state until report-back.';
COMMENT ON COLUMN tool_invocations.state IS 'unknown at insert, then succeeded/failed/rejected exactly once (service-guarded transition).';

CREATE TABLE human_approvals (
  organisation_id uuid        NOT NULL REFERENCES organisations (id) ON DELETE CASCADE,
  id              uuid        NOT NULL PRIMARY KEY,
  ai_action_id    uuid,
  -- What was proposed, as a catalogue value — never the payload (INV-12).
  proposal_kind   text        NOT NULL
                    CHECK (proposal_kind IN (
                      'send_message', 'book', 'cancel', 'refund', 'share_data', 'other'
                    )),
  status          text        NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'approved', 'rejected', 'expired')),
  decided_by      uuid,
  decided_at      timestamptz,
  correlation_id  uuid,
  expires_at      timestamptz,
  version         integer     NOT NULL DEFAULT 1,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, id),
  FOREIGN KEY (organisation_id, ai_action_id) REFERENCES ai_actions (organisation_id, id) ON DELETE SET NULL (ai_action_id),
  CHECK (
    (status = 'pending' AND decided_by IS NULL AND decided_at IS NULL)
    OR (status <> 'pending' AND decided_by IS NOT NULL AND decided_at IS NOT NULL)
  )
);

CREATE INDEX human_approvals_expiry_idx ON human_approvals (organisation_id, expires_at)
  WHERE expires_at IS NOT NULL;
CREATE INDEX human_approvals_pending_idx ON human_approvals (organisation_id, status)
  WHERE status = 'pending';

COMMENT ON TABLE human_approvals IS 'Staff gates on sensitive actions (P07.10). Decisions name who decided; payloads never stored.';
COMMENT ON COLUMN human_approvals.proposal_kind IS 'Closed catalogue of what was proposed. The payload itself lives nowhere here.';

SELECT app.apply_tenant_rls('workflow_runs');
SELECT app.apply_tenant_rls('ai_actions');
SELECT app.apply_tenant_rls('tool_invocations');
SELECT app.apply_tenant_rls('human_approvals');

REVOKE ALL ON TABLE workflow_runs, ai_actions, tool_invocations, human_approvals
  FROM PUBLIC, moin_app, moin_identity, moin_provisioner, moin_dispatcher, moin_support_ro,
       moin_reporting;

GRANT SELECT, INSERT, UPDATE ON workflow_runs, ai_actions, tool_invocations, human_approvals TO moin_app;

-- Reviewed audit argument keys (P06.10.03, P06.10.07, INV-12). Markers only, never content.
INSERT INTO audit_argument_allowlist(operation, argument_key, value_kind, reason) VALUES
  ('run.start', 'has_conversation', 'count', '1 when linked to a conversation, 0 when standalone; no ids'),
  ('run.finish', 'to_status', 'count', 'terminal rung as opaque marker (1=succeeded,2=failed,3=cancelled); no payload'),
  ('action.record', 'kind', 'count', 'action kind as opaque marker (0..5 in CHECK order); no prompt text'),
  ('tool.invoke', 'by_ai', 'count', '1 when called by an AI action, 0 when by a staff user; no tool args'),
  ('tool.report', 'state', 'count', 'reported state as opaque marker (1=succeeded,2=failed,3=rejected); no output'),
  ('approval.request', 'proposal', 'count', 'proposal kind as opaque marker (0..5 in CHECK order); no payload'),
  ('approval.decide', 'decision', 'count', 'decision as opaque marker (1=approved,2=rejected,3=expired); no payload')
ON CONFLICT (operation, argument_key) DO NOTHING;

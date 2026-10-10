-- 0042 — leads (P07.07.01, P07.07.02).
-- migration-check: allow create-index-blocking because every index here is on a table created earlier in this same migration, so it is new and empty.
--
-- ## Leads are qualified interest, not people
--
-- A lead names an opportunity (`title`), optionally points at the contact it came from and the
-- conversation that produced it, and moves along the BR-008 machine:
-- new → needs_action → contacted → waiting → done, with lost reachable from any live rung.
-- `lost_reason` is mandatory exactly when lost (CHECK coupling): a lost lead without a reason
-- is a report nobody can act on.
--
-- ## A lead in needs_action always has an open task (P07.07.02)
--
-- The linkage is a nullable `task_id` on the lead plus a service-held invariant, not a trigger:
-- entering needs_action creates the task (idempotent by key `lead-<id>-needs-action`) when none
-- is open, and leaving needs_action toward contacted/waiting/done keeps it (the work continues).
-- `lead_tasks` is the history of every task ever linked to the lead (one lead, many tasks over
-- time); the concurrent-link test proves the invariant under races.
--
-- Tenant rows: organisation_id, composite uniques/FKs, RLS + FORCE, moin_app DML. Contact and
-- conversation legs are composite RESTRICT (same shape as P07.05: history is never silently
-- re-homed; erasure clears first, P16).

CREATE TABLE leads (
  organisation_id uuid        NOT NULL REFERENCES organisations (id) ON DELETE CASCADE,
  id              uuid        NOT NULL PRIMARY KEY,
  title           text        NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 120),
  contact_id      uuid,
  conversation_id uuid,
  status          text        NOT NULL DEFAULT 'new'
                    CHECK (status IN (
                      'new', 'needs_action', 'contacted', 'waiting', 'done', 'lost'
                    )),
  -- Mandatory exactly when lost: the reason the opportunity died.
  lost_reason     text        CHECK (
                      lost_reason IN (
                        'no_interest', 'no_budget', 'wrong_contact', 'duplicate', 'unreachable', 'other'
                      )
                    ),
  task_id         uuid,
  version         integer     NOT NULL DEFAULT 1,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, id),
  FOREIGN KEY (organisation_id, contact_id) REFERENCES contacts (organisation_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organisation_id, conversation_id) REFERENCES conversations (organisation_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organisation_id, task_id) REFERENCES tasks (organisation_id, id) ON DELETE SET NULL (task_id),
  CHECK (
    (status = 'lost' AND lost_reason IS NOT NULL)
    OR (status <> 'lost' AND lost_reason IS NULL)
  )
);

CREATE INDEX leads_contact_idx ON leads (organisation_id, contact_id) WHERE contact_id IS NOT NULL;
CREATE INDEX leads_status_idx ON leads (organisation_id, status);

COMMENT ON TABLE leads IS 'Qualified interest (P07.07, BR-008). needs_action always has an open task; lost always has a reason.';
COMMENT ON COLUMN leads.lost_reason IS 'Mandatory exactly when lost (CHECK-coupled). Closed set: no_interest/no_budget/wrong_contact/duplicate/unreachable/other.';
COMMENT ON COLUMN leads.task_id IS 'Current open task for the lead (NULL when none). History lives in lead_tasks.';

CREATE TABLE lead_tasks (
  organisation_id uuid        NOT NULL,
  id              uuid        NOT NULL PRIMARY KEY,
  lead_id         uuid        NOT NULL,
  task_id         uuid        NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, id),
  UNIQUE (organisation_id, lead_id, task_id),
  FOREIGN KEY (organisation_id, lead_id) REFERENCES leads (organisation_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organisation_id, task_id) REFERENCES tasks (organisation_id, id) ON DELETE CASCADE
);

COMMENT ON TABLE lead_tasks IS 'Every task ever linked to a lead (P07.07.02 history). Link rows die with either side; the lead row keeps no stale pointer.';

SELECT app.apply_tenant_rls('leads');
SELECT app.apply_tenant_rls('lead_tasks');

REVOKE ALL ON TABLE leads, lead_tasks
  FROM PUBLIC, moin_app, moin_identity, moin_provisioner, moin_dispatcher, moin_support_ro,
       moin_reporting;

GRANT SELECT, INSERT, UPDATE ON leads, lead_tasks TO moin_app;

-- Reviewed audit argument keys (P06.10.03, P06.10.07, INV-12). Markers only, no titles/reasons.
INSERT INTO audit_argument_allowlist(operation, argument_key, value_kind, reason) VALUES
  ('lead.create', 'from_status', 'count', 'always 0 (new); records the entry rung'),
  ('lead.status', 'to_status', 'count', 'new status rung as opaque marker (0..5 in CHECK order); no payload'),
  ('lead.task_link', 'linked', 'count', 'always 1 (a task was linked); the task id itself is the target_id')
ON CONFLICT (operation, argument_key) DO NOTHING;

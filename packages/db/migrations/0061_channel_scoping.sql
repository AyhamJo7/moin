-- 0061 — channel and sensitivity scoping (P09.10), approved retrieval view v2.
-- migration-check: allow add-check-validated because both CHECK constraints are added NOT VALID with separate VALIDATE CONSTRAINT statements (the check's 120-character lookahead cannot see past the reason lists to the NOT VALID keywords).
-- Extend rather than rename: call/message grants retain their literal meaning.
-- No approved row is rewritten or broadened. New unspecified scopes allow all
-- five channels; omitted retrieval context requires all five (fail closed).

ALTER TABLE knowledge_versions DROP CONSTRAINT knowledge_versions_allowed_channels_check;
ALTER TABLE knowledge_versions ALTER COLUMN allowed_channels
  SET DEFAULT '{call,message,voice,email,web}';
ALTER TABLE knowledge_versions ADD CONSTRAINT knowledge_versions_allowed_channels_check
  CHECK (allowed_channels <@ '{call,message,voice,email,web}' AND cardinality(allowed_channels) > 0
    AND array_position(allowed_channels, NULL) IS NULL) NOT VALID;
ALTER TABLE knowledge_versions VALIDATE CONSTRAINT knowledge_versions_allowed_channels_check;

ALTER TABLE faq_cards DROP CONSTRAINT faq_cards_allowed_channels_check;
ALTER TABLE faq_cards ALTER COLUMN allowed_channels SET DEFAULT '{call,message,voice,email,web}';
ALTER TABLE faq_cards ADD CONSTRAINT faq_cards_allowed_channels_check
  CHECK (allowed_channels <@ '{call,message,voice,email,web}' AND cardinality(allowed_channels) > 0
    AND array_position(allowed_channels, NULL) IS NULL) NOT VALID;
ALTER TABLE faq_cards VALIDATE CONSTRAINT faq_cards_allowed_channels_check;

CREATE OR REPLACE VIEW knowledge_approved_current
WITH (security_invoker = true)
AS
SELECT
  v.organisation_id,
  v.item_id,
  v.id AS version_id,
  v.version_no,
  v.title,
  v.body,
  v.sensitivity,
  v.category,
  v.valid_until,
  a.decided_at AS approved_at
FROM knowledge_versions v
JOIN knowledge_items i
  ON i.organisation_id = v.organisation_id AND i.id = v.item_id
LEFT JOIN knowledge_approvals a
  ON a.organisation_id = v.organisation_id AND a.version_id = v.id
WHERE v.state = 'approved'
  AND i.state = 'approved'
  AND NOT i.suspended
  AND i.conflict_state = 'clear'
  AND coalesce(v.valid_until < CURRENT_DATE, false) = false
  AND NOT (
    v.sensitivity = 'restricted'
    AND coalesce(a.decided_at + v.reverify_after <= now(), false) = true
  )
  AND (
    nullif(current_setting('app.knowledge_channel', true), '') IS NULL
      AND v.allowed_channels @> '{call,message,voice,email,web}'
    OR nullif(current_setting('app.knowledge_channel', true), '') = ANY (v.allowed_channels)
  );

COMMENT ON VIEW knowledge_approved_current IS 'Approved-only retrieval source v2 (P09.10.01, migration 0061): approved + valid + not suspended + not conflicted + overdue-restricted suppressed + channel allowed. SET LOCAL app.knowledge_channel to call|message|voice|email|web; absent/empty requires all five, unknown denies all. Legacy call/message are distinct grants, not aliases; existing approvals are not widened. Shared approved content powers every permitted channel (BLUEPRINT 360/622). security_invoker preserves base-table FORCE RLS.';

COMMENT ON COLUMN knowledge_versions.allowed_channels IS 'P09.10: nonempty subset of call,message,voice,email,web. Legacy names are distinct grants, never aliases. New default all five; approved history is not rewritten.';
COMMENT ON COLUMN faq_cards.allowed_channels IS 'P09.10: nonempty subset of call,message,voice,email,web. Omitted retrieval channel requires all five. Sensitive cards remain verbatim-only; overdue sensitive never serve.';

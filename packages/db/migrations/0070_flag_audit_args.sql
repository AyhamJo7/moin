-- 0070 — audit argument keys for flag flips (P08.10.03).
--
-- Flag audits carry opaque markers only: which action (set/clear as counts)
-- and the resulting state (on/off as counts) — never the flag name or reason
-- text (INV-12). Two operations × three keys.

INSERT INTO audit_argument_allowlist(operation, argument_key, value_kind, reason) VALUES
  ('flag.set', 'flag_set', 'count', 'one set action occurred; opaque marker, no flag name'),
  ('flag.set', 'flag_on', 'count', 'resulting state as 1/0; opaque marker, no flag name'),
  ('flag.clear', 'flag_cleared', 'count', 'one clear action occurred; opaque marker, no flag name')
ON CONFLICT (operation, argument_key) DO NOTHING;

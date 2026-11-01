# EV-P06-087: RLS catalog check: permissive-policy predicates, FK column pairs, every schema and view; mutation KILLED for each

| Field | Value |
|---|---|
| Evidence ID | EV-P06-087 |
| Item | P06.02.04 |
| Date (UTC) | 2026-11-01 04:06 UTC |
| Commit | `93418b06c49a61c8a6d1479fa2a2f16ad06d6c5d` |
| Environment | Node 24.21.0, PostgreSQL 17 (pgvector) as a private compose project, local worktree /tmp/moin-sec01 |
| Command / procedure | `.claude/bin/gates.py full`: `python3 .claude/bin/control_plane_check.py && python3 -m unittest discover -s .claude/tests -t .claude/tests` → pass (exit 0, 25.8 s); `uvx ruff@0.15.12 format --check --config .claude/ruff.toml .claude && uvx ruff@0.15.12 check --config .claude/ruff.toml .claude && uvx --from mypy==2.3.1 mypy --config-file .claude/mypy.ini` → pass (exit 0, 0.2 s); `node scripts/check-conventional-commit.ts --self-test && node scripts/check-no-ai-mentions.ts --self-test` → pass (exit 0, 0.1 s); `node scripts/check-adr-coverage.ts && node scripts/check-domain-coverage.ts && node scripts/check-dfd-coverage.ts && node scripts/check-threat-model-refs.ts && node scripts/check-data-classification.ts && node scripts/check-subprocessors.ts && node scripts/check-brand-strings.ts` → pass (exit 0, 1.4 s); `pnpm exec prettier --check .` → pass (exit 0, 6.9 s); `pnpm lint` → pass (exit 0, 3.5 s); `pnpm exec depcruise apps packages scripts --config .dependency-cruiser.cjs` → pass (exit 0, 1.1 s); `pnpm typecheck` → pass (exit 0, 1.1 s); `pnpm test` → pass (exit 0, 6.1 s); `pnpm test:integration` → pass (exit 0, 63.6 s); `node scripts/check-migrations.ts` → pass (exit 0, 0.1 s); `pnpm turbo run build` → pass (exit 0, 5.5 s); `node scripts/check-licences.ts` → pass (exit 0, 0.4 s); `gitleaks git --redact --no-banner --config .gitleaks.toml .` → pass (exit 0, 1.1 s) |
| Result | PASS |
| CI run / artifact | pending |
| Reviewer | pending |

Sensitive material is stored by reference only (PLAN.md evidence rules).

## What it proves

Findings F1 to F3 of the independent security acceptance review of group 1 (be4591d), one commit each:

| Finding | Commit | Regression test (`scripts/check-rls-catalog.integration.test.ts`) | Before | Mutation |
|---|---|---|---|---|
| F1 HIGH: allow-all policy accepted | `b072df8` | `USING (true) WITH CHECK (true)` beside the reviewed policy is reported, and the same test reads tenant B's row as `moin_app` | 3 failed (finding list empty) | `EV-P06-087-mutation-f1-policy-predicates.json`: KILLED |
| F2 HIGH: swapped composite FK accepted | `d8e3dbe` | `(organisation_id, location_id) REFERENCES locations (id, organisation_id)` reported; the test shows `moin_app` creating the foreign reference; a correctly bound key refuses it (23503) | swapped-key test failed | `EV-P06-087-mutation-f2-fk-pairs.json`: KILLED |
| F3 HIGH: other schemas, views not inventoried | `eb56697` | tenant table in an unregistered schema with a grant, partitioned table, owner-created view (reads both tenants' rows as `moin_app`) and materialised view reported; `security_invoker` clears the view | 4 failed | `EV-P06-087-mutation-f3-inventory.json`: KILLED |

Predicates are compared as text after normalising whitespace and outer parentheses, on purpose: a different spelling is a finding to review, not a pass. The registered exceptions are the two request-lookup policies of `memberships`; `REVIEWED_TENANT_VIEWS` is empty.

## Not shown

Independent re-review of the exact head is pending; nothing here is VERIFIED. Remote CI is pending. The check judges policy text, not meaning: a registered exception is trusted.

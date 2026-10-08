# EV-P06-055: Account recovery: disable/enable with in-commit revocation, revoke-sessions, reset hook, tabletop

| Field | Value |
|---|---|
| Evidence ID | EV-P06-055 |
| Item | P06.09.01, P06.09.02, P06.09.04 |
| Date (UTC) | 2026-10-08 00:17 UTC |
| Commit | `d09f040a4ace0f4c1681abc10b26573a6849195f` (working tree had uncommitted changes) |
| Environment | local |
| Command / procedure | `.claude/bin/gates.py full`: `python3 .claude/bin/control_plane_check.py && python3 -m unittest discover -s .claude/tests -t .claude/tests` → pass (exit 0, 30.3 s); `uvx ruff@0.15.12 format --check --config .claude/ruff.toml .claude && uvx ruff@0.15.12 check --config .claude/ruff.toml .claude && uvx --from mypy==2.3.1 mypy --config-file .claude/mypy.ini` → pass (exit 0, 0.3 s); `node scripts/check-conventional-commit.ts --self-test && node scripts/check-no-ai-mentions.ts --self-test` → pass (exit 0, 0.1 s); `node scripts/check-adr-coverage.ts && node scripts/check-domain-coverage.ts && node scripts/check-dfd-coverage.ts && node scripts/check-threat-model-refs.ts && node scripts/check-data-classification.ts && node scripts/check-subprocessors.ts && node scripts/check-brand-strings.ts` → pass (exit 0, 1.9 s); `pnpm exec prettier --check .` → pass (exit 0, 5.4 s); `pnpm lint` → pass (exit 0, 10.2 s); `pnpm exec depcruise apps packages scripts --config .dependency-cruiser.cjs` → pass (exit 0, 1.1 s); `pnpm typecheck` → pass (exit 0, 5.3 s); `pnpm test` → pass (exit 0, 7.2 s); `pnpm test:integration` → pass (exit 0, 20.1 s); `node scripts/check-migrations.ts` → pass (exit 0, 0.1 s); `pnpm turbo run build` → pass (exit 0, 7.3 s); `node scripts/check-licences.ts` → pass (exit 0, 0.5 s); `gitleaks git --redact --no-banner --config .gitleaks.toml .` → pass (exit 0, 1.0 s) |
| Result | PASS |
| CI run / artifact | pending |
| Reviewer | pending QG-09 triad at final SHA (security, architecture, invariant) |

| Mutation sweep | KILLED: recovery.integration.test.ts detects the fix (fails without, passes with; mutation-check working-tree mode, this session) |
| Scope note | P06.09.03 runbooks VERIFIED earlier (EV-P06-040) — this session recorded the P06.09.04 tabletop in both runbooks, not the procedures. Containment is PARTIAL by construction: sessions revoked, fresh sign-in not denied (no deny-new-access mechanism); no operator identity (P06.11), no provider calls (Cognito P05/EXT-09), no owner notification (P06.12.02). P06.09.01 provider flow unwired; our revoke hook proven. |
| Review fix | e2097f5 closes HIGH1 (caller-tenant locked membership gate on all three routes + owner check on enable + 3 cross-tenant tests), HIGH2 (advisory-before-row lock, 0016 order), HIGH3 (revoke_member_sessions DEFINER: gate+revoke+audit one commit; setter audit in-commit; no identity-pool path); full gates 14/14 |
| QG-09 status | NOT re-run at this SHA. Required before READY_FOR_REVIEW. |

Sensitive material is stored by reference only (PLAN.md evidence rules).

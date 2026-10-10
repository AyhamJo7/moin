# EV-P06-055: Account recovery: disable/enable with in-commit revocation, revoke-sessions, reset hook, tabletop

| Field | Value |
|---|---|
| Evidence ID | EV-P06-055 |
| Item | P06.09.01, P06.09.02, P06.09.04 |
| Date (UTC) | 2026-10-10 03:12 UTC |
| Commit | `65441608612a0408e30db88c75ec9c05f8961840` (clean HEAD; closure docs L2/L3 land on top in this branch) |
| Environment | local |
| Command / procedure | Re-record at clean HEAD 6544160 (docs+qg09-s7-closure worktree): `pnpm exec prettier --check apps/server/src/modules/identity-access/http/recovery.controller.ts docs/runbooks/compromised-account.md` → pass ("All matched files use Prettier code style!", exit 0); `pnpm typecheck` → pass (18 tasks successful, 0 cached, 6.8 s, exit 0). Original full-gates run of 2026-10-08 retained for history: `.claude/bin/gates.py full` chain (control-plane, ruff, commit/ADR/coverage checks, prettier, lint, depcruise, typecheck, unit, integration, migrations, build, licences, gitleaks) → all pass, recorded at dirty predecessor d09f040; this re-record replaces the dirty-tree basis with clean-HEAD verification of the closure touch-points. |
| Result | PASS |
| CI run / artifact | PR #78 head 6108548: 16/16 SUCCESS, merge CLEAN (verify 38020082585, container-scan 38020082608, security-scan 38020082558, pr-title 38020105155; stale FAILURE 38020082618 superseded by title amend) |
| Reviewer | codex (GPT-6-Luna) final review of PR78 head 6108548: invariant OK, security OK, architecture OK; overall BLOCK only on stale CI/reviewer fields in this record (now updated) |

| Mutation sweep | KILLED: recovery.integration.test.ts detects the fix (fails without, passes with; mutation-check working-tree mode, this session) |
| Scope note | P06.09.03 runbooks VERIFIED earlier (EV-P06-040) — this session recorded the P06.09.04 tabletop in both runbooks, not the procedures. Containment is PARTIAL by construction: sessions revoked, fresh sign-in not denied (no deny-new-access mechanism); no operator identity (P06.11), no provider calls (Cognito P05/EXT-09), no owner notification (P06.12.02). P06.09.01 provider flow unwired; our revoke hook proven. |
| Review fix | e2097f5 closes HIGH1 (caller-tenant locked membership gate on all three routes + owner check on enable + 3 cross-tenant tests), HIGH2 (advisory-before-row lock, 0016 order), HIGH3 (revoke_member_sessions DEFINER: gate+revoke+audit one commit; setter audit in-commit; no identity-pool path); full gates 14/14 |
| QG-09 status | NOT re-run at this SHA. Required before READY_FOR_REVIEW. |

Sensitive material is stored by reference only (PLAN.md evidence rules).

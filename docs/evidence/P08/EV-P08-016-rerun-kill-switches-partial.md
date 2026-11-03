# EV-P08-016: Only one of the six global kill switches has a test. Supersedes EV-P08-010.

| Field | Value |
|---|---|
| Evidence ID | EV-P08-016 |
| Item | P08.10.02 |
| Date (UTC) | 2026-11-01 11:19 UTC |
| Commit | `f0ccb9b85683bac390690bc50483b8c96f408e84` |
| Environment | local clone /tmp/moin-c-rerun, main be4591d, clean tree; Node 24.21.0, pnpm 10.34.5, WSL2; private compose project implrerun (Postgres 17 pgvector, valkey, sqs, mail, oidc) |
| Command / procedure | At HEAD be4591d (clean tree): pnpm exec vitest run --reporter=verbose --project integration packages/db/src/flags.integration.test.ts -> exit 0, 1 file(s), 3 tests passed; pnpm exec vitest run --reporter=verbose --project unit apps/server/src/modules/platform/worker.test.ts packages/kernel/src/retry.test.ts packages/db/src/killswitch.test.ts -> exit 0, 3 file(s), 12 tests passed; python3 .claude/bin/gates.py full -> RESULT PASS 14/14, exit 0, 0 changed files, HEAD be4591d (control-plane, control-plane-lint, conventions, docs-consistency, format, lint, boundaries, typecheck, unit, integration, migrations, build, licences, secret-scan) |
| Result | PARTIAL: flags.integration.test.ts (3 tests) and killswitch.test.ts pass: defaults apply, per-tenant overrides win, ai_answering off means deterministic capture only, flag changes are audited with markers. MISSING: a test that the six global kill switches named by the item (ai_answering, faq_answering, llm_wording, transfers, sms, booking_execution) exist and default on; migration 0069 defines them but only ai_answering is exercised by any test. |
| CI run / artifact | main be4591d check-runs all success: verify run https://github.com/AyhamJo7/moin/actions/runs/41269388046, security-scan run .../41269388037, container-scan run .../41269388053 |
| Reviewer | pending |

Sensitive material is stored by reference only (PLAN.md evidence rules).

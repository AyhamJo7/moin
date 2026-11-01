# EV-P09-016: Tests per channel (voice, email, web), fail-closed omitted context and sensitivity matrix pass; mutation_check reports KILLED for the channel scoping fix. Supersedes EV-P09-012.

| Field | Value |
|---|---|
| Evidence ID | EV-P09-016 |
| Item | P09.10.02 |
| Date (UTC) | 2026-11-01 10:50 UTC |
| Commit | `be4591df127cd19e0bceee4e5426c325b119aed3` (while this record was written, only docs/evidence/INDEX.md and earlier records of the same batch differed from this commit; no code or configuration differed) |
| Environment | local clone /tmp/moin-c-rerun, main be4591d, clean tree; Node 24.21.0, pnpm 10.34.5, WSL2; private compose project implrerun (Postgres 17 pgvector, valkey, sqs, mail, oidc) |
| Command / procedure | At HEAD be4591d (clean tree): pnpm exec vitest run --reporter=verbose --project integration packages/db/src/channels.integration.test.ts -> exit 0, 1 file(s), 7 tests passed; python3 .claude/bin/gates.py full -> RESULT PASS 14/14, exit 0, 0 changed files, HEAD be4591d (control-plane, control-plane-lint, conventions, docs-consistency, format, lint, boundaries, typecheck, unit, integration, migrations, build, licences, secret-scan); python3 .claude/bin/mutation_check.py --fix-ref 28e11f1 --fix-paths packages/db/src/faq.ts --test "pnpm exec vitest run --project integration packages/db/src/channels.integration.test.ts -t 'omitted context is fail closed and legacy grants are not aliases'" -> KILLED (without fix exit 1, with fix exit 0, tree clean afterwards) |
| Result | PASS: i-channels exit 0: 7 tests in 1 file(s) passed |
| CI run / artifact | main be4591d check-runs all success: verify run https://github.com/AyhamJo7/moin/actions/runs/41269388046, security-scan run .../41269388037, container-scan run .../41269388053 |
| Reviewer | pending |

Sensitive material is stored by reference only (PLAN.md evidence rules).

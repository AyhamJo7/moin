# Evidence registry

Every `EV-Pxx-nnn` record produced for PLAN.md lives in `docs/evidence/<phase>/` and is
registered here. Records are created with:

```bash
python3 .claude/bin/evidence.py new --phase P02 --item P02.05.06 --slug standalone-tests \
    --summary "…" --from-gates full
```

and audited with `python3 .claude/bin/evidence.py check`.

**Sensitive evidence is never committed.** Pentest reports, legal opinions, signed contracts and
anything containing personal data are stored outside the repository; the record holds only the
storage location, a SHA-256 hash, the date and the counterparty (PLAN.md, *Evidence rules*).
Screenshots containing personal data are forbidden — use the demo tenant.

## ID allocation

`evidence.py` allocates IDs sequentially per phase (`max + 1`), in the order records are
genuinely earned. PLAN.md's per-phase *Required evidence* line names the artefacts it expects
but cannot bind them to a number before the work happens, so the mapping from a PLAN label to
the allocated ID is recorded in the phase's `Required-evidence mapping` section below rather
than assumed.

### P02 — required-evidence mapping (PLAN.md L2172)

PLAN.md L2172 names four artefacts with parenthetical IDs (`EV-P02-001` … `EV-P02-004`). Those
were assigned at planning time, before the order in which the work could be earned was known.
`evidence.py` allocates sequentially as records are written, and the ruleset export depends on
EXT-24, so holding slot 004 open would have blocked every record after it. The registry is
authoritative for the actual IDs; this table is the mapping.

| PLAN label | Allocated ID | State |
|---|---|---|
| CI run URLs | — | not yet earned (P02.06) |
| Negative-control PR links | — | not yet earned (P02.06.07) |
| Timed setup log | — | not yet earned (P02.04.06) |
| Ruleset export | — | not yet earned — EXT-24, founder |

## Records

| ID | Item | Date | Commit | Summary | Record |
|---|---|---|---|---|---|
| EV-P02-001 | P02.02.10 | 2026-09-28 | `766f53e2804a` | Every lint and custom-rule ban is reported by a fixture that violates it | [EV-P02-001-lint-ban-fixtures.md](P02/EV-P02-001-lint-ban-fixtures.md) |
| EV-P02-002 | P02.02.09 | 2026-09-28 | `766f53e2804a` | ADR-0002 (toolchain and runtime baseline) and ADR-0034 (naming and brand decoupling) accepted | [EV-P02-002-adr-0002-0034-accepted.md](P02/EV-P02-002-adr-0002-0034-accepted.md) |
| EV-P02-003 | P02.01.02 | 2026-09-28 | `766f53e2804a` | CODEOWNERS, PR template and issue templates in place | [EV-P02-003-review-surfaces.md](P02/EV-P02-003-review-surfaces.md) |
| EV-P02-004 | P02.01.03 | 2026-09-28 | `766f53e2804a` | Conventional Commit titles and the no-attribution policy are enforced by self-testing checks | [EV-P02-004-commit-and-pr-conventions.md](P02/EV-P02-004-commit-and-pr-conventions.md) |
| EV-P02-005 | P02.01.04 | 2026-09-28 | `766f53e2804a` | PROGRESS.md ledger, evidence registry and record template initialised | [EV-P02-005-ledger-and-evidence-registry.md](P02/EV-P02-005-ledger-and-evidence-registry.md) |
| EV-P02-006 | P02.01.05 | 2026-09-28 | `766f53e2804a` | README and CONTRIBUTING written | [EV-P02-006-readme-and-contributing.md](P02/EV-P02-006-readme-and-contributing.md) |
| EV-P02-007 | P02.01.06 | 2026-09-28 | `766f53e2804a` | Annotated and signed release-tag policy documented | [EV-P02-007-release-tag-policy.md](P02/EV-P02-007-release-tag-policy.md) |
| EV-P02-008 | P02.02.02 | 2026-09-28 | `766f53e2804a` | Turborepo tasks lint, typecheck, test, test:integration and build run with caching and dependsOn | [EV-P02-008-turborepo-tasks.md](P02/EV-P02-008-turborepo-tasks.md) |
| EV-P02-009 | P02.02.03 | 2026-09-28 | `766f53e2804a` | TypeScript strict baseline with the four required options, ESM throughout | [EV-P02-009-typescript-strict-baseline.md](P02/EV-P02-009-typescript-strict-baseline.md) |
| EV-P02-010 | P02.02.06 | 2026-09-28 | `766f53e2804a` | Prettier and .editorconfig applied repository-wide | [EV-P02-010-formatting-baseline.md](P02/EV-P02-010-formatting-baseline.md) |
| EV-P02-011 | P02.02.07 | 2026-09-28 | `766f53e2804a` | dependency-cruiser rules encode PLAN.md Domain Boundaries | [EV-P02-011-module-boundary-rules.md](P02/EV-P02-011-module-boundary-rules.md) |

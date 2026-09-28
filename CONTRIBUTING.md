# Contributing to moin

`PLAN.md` is the authoritative execution plan. Work is scoped by a phase and a checklist section,
never by "whatever seems useful". Read `PLAN.md`'s *Conventions*, the *Status Ledger*, the
*Invariants* and the phase you are working on — never the whole file.

```bash
python3 .claude/bin/plan_section.py --ledger        # status of every phase
python3 .claude/bin/plan_section.py --conventions   # status model, gate tiers, evidence rules
python3 .claude/bin/plan_section.py --invariants    # INV-01 … INV-20
python3 .claude/bin/plan_section.py P02             # one phase
python3 .claude/bin/plan_section.py --id ADR-0003   # the row defining an ID
```

## Branches

Trunk-based. `main` is protected: no direct pushes, no force-pushes, no deletion, linear history.

```text
<type>/<phase>-<section>-<slug>      e.g. feat/p02-03-skeleton
```

One checklist section or smaller per branch. Branches are short-lived. Types are the Conventional
Commit types below — `ci`, `perf`, `build`, `style` and `revert` are valid commit types but are not
used as branch prefixes; use `chore` instead, so the set of branch prefixes stays small.

## Commits

[Conventional Commits](https://www.conventionalcommits.org/). The subject says *what*, the body says
*why* — the diff already shows what changed.

```text
feat(voice): hold the call open while the tool result is pending

A caller who was asked to wait heard silence and hung up (FS-12). The dialogue
manager now emits a filler turn every 4 s until the tool settles or the deadline
passes, which keeps the RTP stream alive and the caller informed.
```

Allowed types: `feat`, `fix`, `chore`, `docs`, `test`, `refactor`, `perf`, `build`, `ci`, `style`,
`revert`. Scopes are the module or package name (`voice`, `db`, `kernel`, `web`, …).

**No AI-tool mentions anywhere** (A-22): not in branch names, commit subjects or bodies, tag
messages, PR titles or PR bodies. No tool names, no session links, no `Co-Authored-By:` trailers,
no "generated with" footers. The product domain is unaffected — `feat(ai): add model gateway` and
"play the AI disclosure (INV-03)" are correct and expected. The rules live in
`.claude/policy/no-ai-mentions.json` and are enforced by `scripts/check-no-ai-mentions.ts` in CI.

## Pull requests

Opened as **drafts**. Marking ready, merging and applying rulesets are the founder's actions.

```bash
git push -u origin <branch>
gh pr create --draft
```

Every PR body fills the template: **what/why · risk · tests · evidence IDs · docs ·
migration/rollback · privacy impact**. A field that does not apply says `n/a` and why — never blank.

Squash merge only, so `main` keeps a linear history of one commit per reviewed change.

### Required checks

`verify`, `security-scan` and `container-scan` must pass. They implement QG-01. Critical checks are
never skipped for routine merges; an emergency bypass needs a SEV reference, is recorded in
`PROGRESS.md`, and is followed by the full gate within 24 hours.

### Reviews

Changes to authentication, sessions, RLS or roles, `SECURITY DEFINER` functions, the tool guard,
webhooks, integrations, billing or privacy handlers trigger **QG-09**: a security and an
architecture review before merge, plus an invariant review when a control path changed. HIGH and
CRITICAL findings are fixed with a regression test that is proven to fail without the fix — they do
not become follow-up tickets.

## Evidence

A checklist item is ticked only with its evidence ID:

```text
- [x] P02.05.06 Verify: example test of every type passes in-suite and standalone — EV-P02-012
```

```bash
python3 .claude/bin/evidence.py new --phase P02 --item P02.05.06 --slug standalone-tests \
    --summary "Unit, integration and e2e examples pass in-suite and standalone" --from-gates full
python3 .claude/bin/evidence.py check
```

Implementation and verification are **separate items**. An item may not be ticked because a mock or
feature flag exists, because a UI element exists that was never exercised end to end, because a
provider SDK is installed, because a test was skipped or quarantined, because documentation claims
it works, or because a sandbox run stood in for a live one. The full list is `PLAN.md` →
*Checklist rules — no fake completion*.

Sensitive evidence is never committed: the record holds the storage location, a SHA-256 hash, the
date and the counterparty.

## Gates

```bash
python3 .claude/bin/gates.py fast     # quick loop
python3 .claude/bin/gates.py full     # before any "done" / "green" wording
python3 .claude/bin/gates.py status
```

Before a bug fix counts, prove its regression test actually catches the bug:

```bash
python3 .claude/bin/mutation_check.py --test "pnpm vitest run path/to/the.test.ts"
```

It must report `KILLED`. Never revert a fix with `git checkout` or `git restore` to "check" it.

**Tightening a gate never needs approval. Loosening one always does.**

## Tests

- New code ships with tests. Unit for logic, integration for boundaries, e2e for critical paths.
- Anything touching RLS uses **real PostgreSQL** — embedded Postgres runs as superuser and silently
  bypasses row-level security.
- Every data-touching test must also pass **standalone against a freshly migrated and seeded
  database**. Passing only inside the suite does not count.
- Test data is synthetic, from `packages/testing` factories: German-realistic names, PLZ, and E.164
  numbers inside reserved test ranges.
- A flaky test is fixed or deleted within five working days. Quarantine needs an issue and never
  applies to isolation, idempotency or gate tests.

## Invariants

`PLAN.md`'s INV-01 … INV-20 are non-negotiable. A change that would weaken one stops and goes to the
founder. The ones most likely to be touched by ordinary work:

- **INV-12** — no personal data in logs, metrics, traces, analytics or push payloads.
- **INV-15** — secrets live only in AWS Secrets Manager, referenced by ARN. Never in code, never in
  a database row, never in a log line.
- **INV-18** — onboarding is configuration. A conditional on an `organisation_id` or a tenant name
  is banned by lint.
- **INV-10 / INV-11** — every business mutation writes an append-only audit event; every external or
  retried side effect is idempotent.

## Releases

Release tags are annotated and signed: see
[`docs/development/release-tags.md`](docs/development/release-tags.md).

## Local setup

[`docs/development/local-setup.md`](docs/development/local-setup.md) ·
[`testing.md`](docs/development/testing.md) · [`conventions.md`](docs/development/conventions.md)

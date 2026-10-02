# EV-P06-028: The population-snapshot design replacing UUID-cursor paging, and a mutation harness whose outcomes are evidence

| Field | Value |
|---|---|
| Evidence ID | EV-P06-028 |
| Item | P06.10.07 |
| Date (UTC) | 2026-09-30 23:16 UTC |
| Commit | `62964db4ca08c3ca261b53eabd79ff7c5b0ce2cc` |
| Environment | local |
| Command / procedure | `.claude/bin/gates.py full`: `python3 .claude/bin/control_plane_check.py && python3 -m unittest discover -s .claude/tests -t .claude/tests` → pass (exit 0, 20.9 s); `uvx ruff@0.15.12 format --check --config .claude/ruff.toml .claude && uvx ruff@0.15.12 check --config .claude/ruff.toml .claude && uvx --from mypy==2.3.1 mypy --config-file .claude/mypy.ini` → pass (exit 0, 0.2 s); `node scripts/check-conventional-commit.ts --self-test && node scripts/check-no-ai-mentions.ts --self-test` → pass (exit 0, 0.1 s); `node scripts/check-adr-coverage.ts && node scripts/check-domain-coverage.ts && node scripts/check-dfd-coverage.ts && node scripts/check-threat-model-refs.ts && node scripts/check-data-classification.ts && node scripts/check-subprocessors.ts && node scripts/check-brand-strings.ts` → pass (exit 0, 1.4 s); `pnpm exec prettier --check .` → pass (exit 0, 2.4 s); `pnpm lint` → pass (exit 0, 2.4 s); `pnpm exec depcruise apps packages scripts --config .dependency-cruiser.cjs` → pass (exit 0, 0.7 s); `pnpm typecheck` → pass (exit 0, 1.0 s); `pnpm test` → pass (exit 0, 4.7 s); `pnpm test:integration` → pass (exit 0, 5.4 s); `node scripts/check-migrations.ts` → pass (exit 0, 0.1 s); `pnpm turbo run build` → pass (exit 0, 0.3 s); `node scripts/check-licences.ts` → pass (exit 0, 0.4 s); `gitleaks git --redact --no-banner --config .gitleaks.toml .` → pass (exit 0, 0.4 s) |
| Result | PASS |
| CI run / artifact | pending |
| Reviewer | pending |

Sensitive material is stored by reference only (PLAN.md evidence rules).

A third independent QG-09 review returned **BLOCK_MERGE** with two HIGH defects. Both were
reproduced against real PostgreSQL before being fixed.

## BLOCKER A — a registration behind the UUID cursor was invisible

`packages/db/src/audit-verification.ts`, `scripts/check-audit-arguments.ts`. Reproduced exactly as
reported:

| Step | Observed |
| --- | --- |
| register holds `bbbb…`, sweep claims it, `aaaa…` registered concurrently | register now holds `aaaa…,bbbb…` |
| page after `bbbb…` | **0 rows** |
| `count_audit_chains` after `bbbb…` | **0** |
| `unregistered_audit_chains` | **0** — `aaaa…` *is* registered |
| verdict | `coverageComplete: true`, `isSound: true`, one of two tenants verified |

UUID order does not encode registration order, so no cursor over it can distinguish "nothing left"
from "something arrived behind me"; and a count cannot either, because a late tenant *ahead* of the
cursor is processed and pushes the total up while an original member is still unvisited. The
previous count-after-cursor fix was therefore insufficient, as the review said.

**Design.** `audit_chain_registry.registration_seq bigint`, assigned from a sequence, immutable once
assigned — the append-only guard already binds the owner, so nothing new was needed to keep it that
way. A sweep reads `max(registration_seq)` **once** and its population is exactly
`registration_seq <= high_water`; paging is `registration_seq > cursor AND <= high_water` in
sequence order. The claimed guarantee is now stated as **sound for the register population captured
at sweep start** in ADR-0017, the report, the runbook and the tests. A sweep's cursor starts at zero
rather than at the previous mark, so nothing falls between two consecutive sweeps. The captured mark
is reported on the completed alarm line, because "sound" is not interpretable without the population
it is sound for.

Rejected alternatives, each for a stated reason, are in ADR-0017: starting `COUNT(*)`, `MAX(uuid)`,
`created_at`, and one REPEATABLE READ snapshot held across the whole sweep.

**A1 — migration.** `0011_audit_chain_population.sql` is expand-only: the column is added nullable,
backfilled deterministically by `row_number() OVER (ORDER BY tenant_id)` and only then made
`NOT NULL` with a sequence default and a `UNIQUE` constraint. The backfill is idempotent (it touches
only null rows) and must disable the append-only guard to run, which is precisely why it happens
inside one migration transaction and cannot happen later. The sequence carries no runtime grant: a
role that can call `nextval` could move a sweep's bound. Tested from a genuinely pre-existing
populated register by staging migrations `0001–0010`, creating tenants, then applying `0011`.

**A2/A3 — verifier and scanner.** Both capture the mark once and page the same bounded population.
The scanner keeps the independent provisioning witness as a **second, separate** check: traversal
covers what the register knows, and the witness covers what the register is missing. Neither
subsumes the other, and a test asserts exactly that.

**A4/A5 — the required cases**, in `packages/db/src/audit-chain-population.integration.test.ts`
(10 tests) and `scripts/check-audit-arguments.integration.test.ts` (CASE 5, 3 tests). Every late
registration in these tests is chosen to sort **lexically behind** the cursor, which is the case the
old design could not see:

| Case | Test |
| --- | --- |
| 1 — registration behind the former cursor | excluded from the captured population, included by the next sweep |
| 2 — member present at snapshot start | verified before coverage is complete, whatever its UUID sorts like |
| 3 — registration between pages | excluded by the bound, not by ordering (registered from inside the running sweep) |
| 4 — deadline inside the population | shortfall reported, `coverageComplete: false`, process exit non-zero |
| 5 — scanner equivalents | 200-tenant full page plus a late lexically-behind UUID; mid-run registration; both checks independent |
| 6 — exact snapshot boundary | no registration outside both of two consecutive sweeps |

Plus: the sequence advances strictly and records order rather than UUID; it cannot be rewritten by
the application role **or** by the table owner; two registrations cannot share a position; and the
sweep does not widen its own population when tenants are registered on every page.

**QG-09.** `app.claim_audit_chains` becomes `(integer, bigint, bigint)`, `app.count_audit_chains`
becomes `(bigint, bigint)`, and `app.audit_chain_high_water()` is new. All three are registered in
`docs/architecture/security-definer-allowlist.md` with their exact signature, reviewed owners, fixed
`search_path`, `PUBLIC` revoked and `moin_app` as the only grantee; the catalog check pins each
signature, owner, path, grant set **and body digest**. The two new functions return a scalar and a
count — no identifiers — which is why the high-water mark is not exposed as a list. No role gained
any privilege beyond executing these.

## BLOCKER B — the mutation runner counted failures of any kind as kills

Reproduced: with `TEST_DATABASE_ADMIN_URL` pointed at a closed port, a variant reported **KILLED**;
with a manifest entry naming a nonexistent test, it reported **SURVIVED**. "54/54 killed" was a
count of non-zero exits.

**Design.** Classification moved to `scripts/mutation-outcome.ts`, a pure function over Vitest's
JSON report, with the taxonomy documented in `docs/verification/README.md`:
`KILLED_ASSERTION` · `KILLED_BY_TIMEOUT` · `SURVIVED` · `BASELINE_FAILED` · `NO_TEST_MATCH` ·
`INFRA_FAILURE` · `BUILD_OR_LOAD_FAILURE` · `INVALID_MUTANT`. Only `KILLED_ASSERTION` is evidence.
Every variant now runs its killing test against the pristine tree first and requires it to run and
pass, cached per test file and filter for the life of one sweep.

**Self-tests.** `scripts/mutation-outcome.test.ts`, 19 tests, against **report fixtures captured
from real Vitest runs** rather than hand-written shapes — a classifier tested against invented
output would only prove it agrees with a guess. They cover all eight required distinctions plus a
failed `.rejects`, a hang, and "no tests collected" versus "filter matched nothing".

### What regenerating the evidence found

The corrected harness immediately contradicted the old claim. First honest run: **47
KILLED_ASSERTION, 4 BASELINE_FAILED, 6 INFRA_FAILURE, 5 NO_TEST_MATCH, 2 SURVIVED** — seventeen of
the fifty-four previous "kills" were not evidence. Every one was a defect in the tests or in the
variants, not in the code under test:

- **three tests passed only in file order**, borrowing events an earlier test had written, so each
  was unusable as a baseline and "passes standalone" was a hope. Each now establishes its own
  precondition. (One of those preconditions then had to be forged rather than appended, because
  earlier tests in that file forge rows, which advances `max(seq)` without advancing the head — so
  a legitimate append collides. That interaction is now written down where it bites.)
- **five variants broke a migration instead of the behaviour**: removing a `CREATE TRIGGER` left its
  `ENABLE ALWAYS` behind, so the migration failed and no suite ran. They disable the guard instead.
- **two pointed at a claim function `0011` replaces**, so they mutated dead code and proved nothing.
- **one changed `const` to `let`** and did nothing at all.
- **two classifier bugs**, both from matching on what the runner seems to print: a failed `.rejects`
  reads `promise resolved … instead of rejecting`, which is an assertion; and a run that collected
  no tests is a setup failure, not a filter that matched nothing.

**Final distribution at this HEAD: `KILLED_ASSERTION: 62`, `INFRA_FAILURE: 2`.** The two are
`N8-backfill-removed` and `P8-sequence-backfill-removed`, and they carry a `note` in the manifest:
each is rejected by an assertion **inside the migration itself**, during the integration project's
global setup, so no suite runs and no test can claim the kill. The control is stronger than a test,
not absent — and the report says that rather than inflating the count to 64.

Ten new variants target the population-snapshot invariant: high-water bound ignored, recomputed per
page, UUID cursor restored, coverage declared complete without checking the snapshot, scanner
ignoring the bound, scanner skipping traversal, sequence not monotonic, backfill removed, sequence
writable by the runtime role, and a next sweep starting from the previous mark.

## Incidental finding, closed

The personal-data gate parsed only `CREATE TABLE`, so a column added by `ALTER TABLE … ADD COLUMN`
never reached the inventory — an erasure request would have missed it silently, which is the failure
that gate exists to prevent. Found by adding such a column and noticing the checked-column count had
not moved (73 before, 73 after). The gate now parses both; coverage went to 76 columns. The two
pre-existing ALTER-added columns were already classified.

## Preserved

Every property from the earlier rounds still holds and is still mutation-proven: append-only
UPDATE/DELETE/TRUNCATE guards, `ENABLE ALWAYS` against replica mode, head rollback refusal,
`event-past-head` detection, the one-statement head/orphan snapshot, the zero-tenant false-sound
guard, the register backfill, replaced-function-body detection, rejection of an arbitrary new
`SECURITY DEFINER`, `PUBLIC EXECUTE` revocation, tenant isolation, argument-kind validation, and the
scanner never printing a stored value or an unsafe key.

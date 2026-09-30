# EV-P06-027: The four HIGH defects from the independent post-fix QG-09 review, reproduced, fixed and mutation-proven

| Field | Value |
|---|---|
| Evidence ID | EV-P06-027 |
| Item | P06.10.07 |
| Date (UTC) | 2026-09-30 22:12 UTC |
| Commit | `c1bde7a9867eebcec8735c0801ea37c7b0cee8ac` |
| Environment | local |
| Command / procedure | `.claude/bin/gates.py full`: `python3 .claude/bin/control_plane_check.py && python3 -m unittest discover -s .claude/tests -t .claude/tests` → pass (exit 0, 20.9 s); `uvx ruff@0.15.12 format --check --config .claude/ruff.toml .claude && uvx ruff@0.15.12 check --config .claude/ruff.toml .claude && uvx --from mypy==2.3.1 mypy --config-file .claude/mypy.ini` → pass (exit 0, 0.3 s); `node scripts/check-conventional-commit.ts --self-test && node scripts/check-no-ai-mentions.ts --self-test` → pass (exit 0, 0.1 s); `node scripts/check-adr-coverage.ts && node scripts/check-domain-coverage.ts && node scripts/check-dfd-coverage.ts && node scripts/check-threat-model-refs.ts && node scripts/check-data-classification.ts && node scripts/check-subprocessors.ts && node scripts/check-brand-strings.ts` → pass (exit 0, 1.4 s); `pnpm exec prettier --check .` → pass (exit 0, 2.4 s); `pnpm lint` → pass (exit 0, 7.9 s); `pnpm exec depcruise apps packages scripts --config .dependency-cruiser.cjs` → pass (exit 0, 0.7 s); `pnpm typecheck` → pass (exit 0, 3.8 s); `pnpm test` → pass (exit 0, 4.7 s); `pnpm test:integration` → pass (exit 0, 5.4 s); `node scripts/check-migrations.ts` → pass (exit 0, 0.1 s); `pnpm turbo run build` → pass (exit 0, 4.7 s); `node scripts/check-licences.ts` → pass (exit 0, 0.4 s); `gitleaks git --redact --no-banner --config .gitleaks.toml .` → pass (exit 0, 0.5 s) |
| Result | PASS |
| CI run / artifact | pending |
| Reviewer | pending |

Sensitive material is stored by reference only (PLAN.md evidence rules).

An independent post-fix QG-09 review returned **BLOCK_MERGE** with four HIGH defects. All four were
**reproduced against real PostgreSQL before being fixed**, and each is now attacked by a named
defective variant in `docs/verification/audit-mutation-manifest.json`.

Every one was a **fail-open** path: the subsystem reported success while proving less than it
claimed. That is the same pattern as the previous review round, and it is worth naming, because
three of the four were introduced *by* fixes rather than surviving from the original design.

### BLOCKER 1 — a deadline-truncated sweep could report a clean day

`packages/db/src/audit-verification.ts`. `unreached` was derived from the tenants the sweep had
**claimed**, and `withSystemWork` processes every claimed item — so the subtraction yielded `0`
whether or not tenants remained. With `pageSize: 1` and a deadline expiring after the first page,
"one claimed, one sound" was indistinguishable from a complete estate.

**Fix.** The shortfall is counted from the register via `app.count_audit_chains(p_after uuid)`, a
count-only reviewed definer. The report gained `unreached` and an explicit `coverageComplete`;
`isSound` requires it, and the CLI exits non-zero on it in its own right — a shortfall that could
not be counted reports `unreached: 0` with `coverageComplete: false`, because not knowing is not the
same as being complete. The deadline is now checked *after* a page rather than before one, so a
sweep always makes progress instead of exiting having verified nothing.

**Regression tests** (`packages/db/src/audit-verification.integration.test.ts`): "does not call a
deadline-truncated sweep sound, even when every tenant it reached was" (injected clock, 4 tenants,
`pageSize: 1`, asserts `unreached: 3`, `coverageComplete: false`, `isSound: false`); "reports the
shortfall at the exact boundary between two pages"; "treats a shortfall it could not count as
incomplete, not as zero"; "calls a sweep that ran to the end of the register complete". Process
level (`cli-verify-audit.integration.test.ts`): "fails and names the shortfall when the deadline
truncates the sweep" and "fails when it cannot even establish whether coverage was complete".

### BLOCKER 2 — the argument scanner never noticed an unregistered tenant

`scripts/check-audit-arguments.ts`. The scan walked only claimed register entries and reconciled
against nothing. Measured: one registered tenant with a valid event, one provisioned tenant with no
register row holding a planted leak — the scan enumerated the registered tenants, inspected their
events and reported the leak-bearing tenant **not at all**, exiting 0.

**Fix.** It reconciles against `app.unregistered_audit_chains`, the same witness the daily sweep
uses, reports `unregistered-tenant-not-scanned` per gap, returns the count in `ScanResult`, and
cannot succeed while one exists. The coverage message is printed **before** any findings rather than
instead of them — reporting findings and returning early hid the coverage line exactly when there
was something to hide.

**Regression tests** (`scripts/check-audit-arguments.integration.test.ts`): "fails when a
provisioned tenant hides a leaking argument outside the register" (process level; asserts non-zero
exit, the coverage message, and that the hidden tenant's contents are **not** in the output); "fails
on an unregistered tenant even when its arguments are perfectly valid"; "succeeds once every
provisioned tenant is registered".

### BLOCKER 3 — a registered key was treated as a validated value

`scripts/check-audit-arguments.ts`. The registered kind was read and then only strings were tested,
for UUID shape. Measured: `related_id` (kind `uuid`) holding `true` produced **no finding at all**,
and `was_confirmed` (kind `boolean`) holding a UUID string passed because the string looked like a
UUID. Non-string values were skipped outright.

**Fix.** A `KIND_RULES` table drives validation from the registered kind and mirrors
`app.append_audit_event`'s own checks exactly — which is the point, since a divergence between the
control and the check on it is itself the finding. The three kinds the registry's `CHECK` permits
are covered and no others were invented: `uuid` (JSON string + UUID shape), `boolean` (JSON
boolean), `count` (JSON number, non-negative integer, ≤ 999 999 999, from the writer's
`^(0|[1-9][0-9]{0,8})$`). A kind with no validator yields `unvalidatable-argument-kind` and fails
closed. New rules: `argument-kind-mismatch`, `argument-value-out-of-range`.

**Regression tests**: eight table-driven cases, each in its own database — uuid/boolean,
uuid/number, boolean/uuid-string, count/boolean, count/string, count/negative, count/fractional,
count/above bound — plus "fails closed on a registered kind it has no validator for" and "accepts
every registered kind when the stored value actually conforms". Every case also asserts the value
is **not** printed.

### BLOCKER 4 — a verify/append race produced a false break alarm

`packages/db/src/audit.ts`. Verification read the head, and if none existed issued a **second**
statement to look for events. At READ COMMITTED each statement takes its own snapshot. Measured:
statement one saw 0 head rows, a tenant's legitimate first append committed, statement two saw 1
event → `missing-head` for a sound chain. An alarm that cries wolf is worse than none.

**Fix.** All three facts come from scalar subqueries in one statement, so one snapshot. That shape
also always returns exactly one row, removing the case that made a second question necessary.
Detection of the genuine defect is preserved and sharpened: an orphan trail still breaks, now
reporting the highest orphan sequence rather than a placeholder `1`.

**Regression tests**: "does not report missing-head when a first append commits mid-verification" —
a `TenantClient` wrapper commits a legitimate append *between* the verifier's queries, so with one
statement there is no injection point that produces the false alarm and with two there is; "still
detects a genuine orphan event with no head" (asserts `seq: '2'`); "still reports an empty chain as
sound".

### Mutation sweep — 54/54 KILLED

The set moved from a scratch script to a committed, inspectable artifact:

- **Manifest:** `docs/verification/audit-mutation-manifest.json` — 54 variants, each with `id`,
  `invariant`, `expected`, `file`, `find`/`replace`, `test`, `kills`.
- **Report:** `docs/verification/audit-mutation-report.md` — 54/54 KILLED.
- **Runner:** `scripts/mutation-sweep.ts` (`--validate`, `--only`, `--report`).
- **Guide:** `docs/verification/README.md`.

Twelve variants are new and target these four invariants: `B1-1` (shortfall inferred from claims),
`B1-2` (coverage ignored by `isSound`), `B1-3` (uncountable shortfall treated as none), `B1-4` (CLI
ignores incomplete coverage), `B2-1` (reconciliation skipped), `B2-2` (coverage gap not explained),
`B3-1` (non-string values skipped), `B3-2` (value validation removed), `B3-3` (count bounds not
enforced), `B3-4` (unknown kind fails open), `B4-1` (head/orphan split across two statements),
`B4-2` (`missing-head` suppressed).

Four of them initially SURVIVED, in every case because the variant removed a **redundant** guard and
the named test could not isolate the removed term. They were not dropped: `B1-2` and `B1-4` were
retargeted at the uncountable-shortfall cases, which is the only situation where `unchecked` is `0`
and completeness alone decides — and reaching that at process level required the deadline check to
move after the first page, which is a better behaviour anyway. `B2-2` was redefined to attack the
operator-facing coverage message, a genuinely distinct property. `B3-2` was retargeted at the
free-text case, which is the one `rule.check` uniquely guards.

Nothing here was fabricated: `node scripts/mutation-sweep.ts --validate` proves every anchor still
resolves against the committed tree, and the report is regenerated by the runner rather than written
by hand.

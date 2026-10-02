# EV-P06-029: Epoch allocation serialized by commit rather than by nextval, and assertion identity decided structurally rather than from message text

| Field | Value |
|---|---|
| Evidence ID | EV-P06-029 |
| Item | P06.10.07 |
| Date (UTC) | 2026-10-01 13:42 UTC |
| Commit | `9df51337ba6dba4ef043f748e47e18c5dbbe0ceb` |
| Environment | local |
| Command / procedure | `.claude/bin/gates.py full`: `python3 .claude/bin/control_plane_check.py && python3 -m unittest discover -s .claude/tests -t .claude/tests` → pass (exit 0, 27.0 s); `uvx ruff@0.15.12 format --check --config .claude/ruff.toml .claude && uvx ruff@0.15.12 check --config .claude/ruff.toml .claude && uvx --from mypy==2.3.1 mypy --config-file .claude/mypy.ini` → pass (exit 0, 0.3 s); `node scripts/check-conventional-commit.ts --self-test && node scripts/check-no-ai-mentions.ts --self-test` → pass (exit 0, 0.1 s); `node scripts/check-adr-coverage.ts && node scripts/check-domain-coverage.ts && node scripts/check-dfd-coverage.ts && node scripts/check-threat-model-refs.ts && node scripts/check-data-classification.ts && node scripts/check-subprocessors.ts && node scripts/check-brand-strings.ts` → pass (exit 0, 1.7 s); `pnpm exec prettier --check .` → pass (exit 0, 3.3 s); `pnpm lint` → pass (exit 0, 9.4 s); `pnpm exec depcruise apps packages scripts --config .dependency-cruiser.cjs` → pass (exit 0, 0.9 s); `pnpm typecheck` → pass (exit 0, 5.0 s); `pnpm test` → pass (exit 0, 5.8 s); `pnpm test:integration` → pass (exit 0, 11.0 s); `node scripts/check-migrations.ts` → pass (exit 0, 0.1 s); `pnpm turbo run build` → pass (exit 0, 4.4 s); `node scripts/check-licences.ts` → pass (exit 0, 0.5 s); `gitleaks git --redact --no-banner --config .gitleaks.toml .` → pass (exit 0, 0.6 s) |
| Result | PASS |
| CI run / artifact | pending |
| Reviewer | pending |

Sensitive material is stored by reference only (PLAN.md evidence rules).

A fourth independent QG-09 review returned **BLOCK_MERGE** with two HIGH defects. Both were
reproduced against real PostgreSQL before being fixed.

## BLOCKER A — a PostgreSQL sequence cannot be the population authority

`nextval()` is deliberately outside transaction control: it does not lock, does not roll back, and
its allocation order is **not** commit order. Reproduced exactly as the review described:

| | |
| --- | --- |
| Tx A inserts a tenant, takes epoch 1, stays open | `epochA = 1`, uncommitted |
| Tx B inserts a tenant, takes epoch 2, commits | `epochB = 2`, committed |
| a sweep reads `max(registration_seq)` | `high_water = 2` |
| rows visible in that population | **1** |
| Tx A commits, then the same population is counted again | **2** |

So the sweep reported complete coverage of a population it had half covered — the original
UUID-cursor defect one layer down.

**Design.** `audit_chain_population_state` is a singleton (`id boolean PRIMARY KEY CHECK (id)`)
holding `last_registration_epoch`. `app.register_audit_chain()` allocates by
`UPDATE … SET last_registration_epoch = last_registration_epoch + 1 WHERE id RETURNING
last_registration_epoch`, in the **same transaction** as the register insert. PostgreSQL holds that
row's write lock until the transaction resolves, so allocation is serialized: epoch order is commit
order, and while epoch N is in flight no epoch above N can be committed because nobody else can
allocate one. The state row's committed value is therefore a true boundary.

There is **no sequence and no column default** — a dormant `nextval()` would be a second allocator
waiting to be used by accident. Exactly one allocator exists. `grep -c nextval` on the migration
returns three, all in comments explaining why it is not used.

This is a counter serialized by a row lock. It is **not** an MVCC snapshot and is no longer
described as one, in the ADR, the runbook or the tests.

**A1/A6 — the mandatory interleavings** (`packages/db/src/audit-chain-epoch.integration.test.ts`,
8 tests, each with a bounded `lock_timeout` so a hang fails deterministically):

| Case | Result |
| --- | --- |
| A registers and holds; B attempts to register | B **blocks** and hits its `lock_timeout` |
| COMMIT CASE: A commits, then B | `epoch(A) < epoch(B)` |
| ROLLBACK CASE: A rolls back, then B | B takes the released epoch; nothing committed sits below it; the state row equals B's epoch |
| **The old exploit, attempted** | While A holds epoch 1 uncommitted: the high-water mark a sweep would capture is **0**; B cannot allocate at all; **no epoch above A's exists, committed or otherwise**; after A commits the mark becomes 1. The interleaving is structurally impossible. |
| A captured population never gains a member | A registration in flight, then committed, then another committed outright — the captured population stays at 2 while the register grows to 4 |
| The allocator fails closed | With the state row deleted, a registration **raises** rather than writing a null epoch, and leaves no organisation or register row behind |

**A4 — migration.** `0011` is unmerged, so it was changed in place rather than stacked. Expand-only:
nullable column → deterministic idempotent backfill (`row_number() OVER (ORDER BY tenant_id)`, null
rows only) → singleton seeded to `max(registration_seq)` or zero → `NOT NULL` → `UNIQUE` → index.
`REVOKE ALL` on the state table from `moin_app` and `moin_provisioner`, because a role that can
increment it can move a sweep's bound. Immutability is the register's existing append-only guard,
which binds the owner. Tested from a genuinely pre-existing populated register.

**A5 — lock order.** Fixed and written into the migration: `organisations` row → population
singleton → register row → (provisioning only) `provisioning_requests` → `audit_heads`. Nothing
takes them in another order, so there is no cycle. Six concurrent provisionings produce six distinct
contiguous epochs with no deadlock, and a separate test proves the sweep holds no lock — a
registration proceeds while a sweep's read transaction is still open.

## BLOCKER B — assertion identity must be structural

Reproduced: four ordinary thrown errors whose *text* contains matcher words, through the old
classifier — three were returned as `KILLED_ASSERTION`, including
`database connection refused while executing toThrow assertion`. An unreachable database counted as
proof that an invariant was enforced.

**Implementation.** `scripts/mutation-reporter.ts` is a custom Vitest reporter that reads the live
error objects and records what they **are**: `name`, and whether `expected`, `actual`, `showDiff`
and `ok` are present as own properties. Measured across eight matcher styles — `toBe`,
`toStrictEqual`, `toMatchObject`, `toContain`, `toBeGreaterThan`, `toThrow`, `not.toBe`,
`rejects.toThrow` — all four fields are always present; `operator` is absent on two, so it is
recorded but not required. A thrown `Error` carries none of them. `isAssertion` requires **both**
the name and all four fields: the name alone would accept an error whose `name` was reassigned.

`KILLED_ASSERTION` now requires all of: baseline passed · the named test found · the named test
executed · no module error · no suite-hook error · no global/unhandled error · not timed out · the
named test failed · **every** error on it typed as an assertion. A test carrying an assertion *and*
a thrown error (an `afterEach` that blew up — the measured shape) fails closed.

Message text is used for one thing only: telling a hung test from other non-assertion failures,
which refines a category that is already not evidence.

**B2 — adversarial tests.** `scripts/mutation-outcome.test.ts` (25) and
`scripts/mutation-reporter.test.ts` (8) — **33 tests**, covering every case the review listed:

| Required case | Outcome asserted |
| --- | --- |
| ordinary Error mentioning `toThrow` | NOT `KILLED_ASSERTION` → `INFRA_FAILURE` |
| ordinary Error quoting `expect(value).toBe(true)` | NOT `KILLED_ASSERTION` |
| ordinary Error containing "AssertionError" | NOT `KILLED_ASSERTION` |
| SQL error quoting `toStrictEqual` | NOT `KILLED_ASSERTION` |
| typed AssertionError from the intended test | `KILLED_ASSERTION` |
| typed AssertionError from an unrelated test, intended passes | `SURVIVED`, 1 unrelated failure |
| `beforeAll` failure | `INFRA_FAILURE` |
| global setup failure | `INFRA_FAILURE` |
| `afterEach` failure mixed with an assertion | fails closed, `INFRA_FAILURE` |
| timeout | `KILLED_BY_TIMEOUT`, explicitly not an assertion |
| no matched test | `NO_TEST_MATCH` |
| load/compile failure | `BUILD_OR_LOAD_FAILURE` / `INVALID_MUTANT` by phase |

Plus: an error whose `name` was reassigned to AssertionError, half-present metadata, a hook failure
winning over a genuine assertion, a skipped named test, and the reporter's own typing against the
measured key sets. The reporter test found a real bug — `in` throws on a thrown primitive — which is
now handled fail-closed.

## A third defect, found while regenerating

The sweep applied each variant with `original.replace(find, replace)` and a **string** replacement,
which is interpreted: `$$` means a literal `$`. Every replacement containing a SQL function body was
silently rewritten — `AS $$` became `AS $` — and the migration failed with
`syntax error at or near "$"`. The variant looked detected; nothing had been tested. It took the
long way to find, because the mutated migration applied cleanly by hand and failed only through the
harness. A function replacement disables the substitution. One manifest entry has a `$` in its
replacement, so no previously reported outcome was affected — but it was the variant attacking the
rejected sequence architecture, and it would have broken every future SQL-body variant.

## Mutation distribution at this HEAD

**`KILLED_ASSERTION: 69` · `INFRA_FAILURE: 2`**, over 71 variants.

Eight variants are new: `E1` (sequence allocation, the rejected architecture), `E3` (allocator does
not fail closed), `P9` retargeted (population state writable by the runtime role), `C1` (privacy
gate ignores ALTER-added columns), `C2` (classifier trusts message text), `C3` (classifier ignores
hook failures), `C4` (classifier accepts mixed errors), `C5` (reporter types by name alone).

One variant was **removed rather than left looking proven**: `E2-high-water-read-from-max-not-state`.
With allocation serialized, `max(registration_seq)` over committed rows and the state row cannot
diverge — no higher epoch can be committed while a lower one is in flight, which is the only
condition under which they differ. The high-water source and the allocator are one invariant, not
two, and `E1` attacks it. Leaving a variant that cannot fail would have inflated the count.

**Disposition of every non-assertion outcome:** both are `INFRA_FAILURE`, both carry a `note` in the
manifest, and both are the same shape — `N8-backfill-removed` and `P8-sequence-backfill-removed` are
rejected by an assertion **inside the migration itself**, during the integration project's global
setup, so no suite runs and no test can claim the kill. The control is stronger than a test rather
than absent. Not counted as evidence and not rounded up to 71.

## Incidental

The `ALTER TABLE … ADD COLUMN` privacy fix had no focused fixture; it now has one
(`scripts/__fixtures__/classification/0002_added_columns.sql`) covering the plain form,
`IF NOT EXISTS`, and a quoted identifier, with `C1` proving the parser change is load-bearing. The
tightened gate immediately caught `audit_chain_population_state.last_registration_epoch`; coverage
is 78 columns.

## Preserved

Every property from the earlier rounds still holds and is still mutation-proven: deadline incomplete
coverage, registered-population traversal, provisioned-but-unregistered detection, argument
type/kind validation, the one-statement head/orphan snapshot, append-only UPDATE/DELETE/TRUNCATE
guards, `ENABLE ALWAYS` against replica mode, head rollback refusal, `event-past-head` detection,
the zero-tenant false-sound guard, the register backfill, replaced-function-body detection,
rejection of an arbitrary new `SECURITY DEFINER`, `PUBLIC EXECUTE` revocation, tenant isolation, and
the scanner never printing a stored value or an unsafe key. The environment knobs still fall back to
their defaults on malformed input, and neither can affect the population snapshot.

# EV-P06-026: QG-09 review of the audit diff and the remediation of its High and Critical findings

| Field | Value |
|---|---|
| Evidence ID | EV-P06-026 |
| Item | P06.10.07 |
| Date (UTC) | 2026-09-30 14:39 UTC |
| Commit | `23d70ae293e4bfc75f100146fd58d9ea9953f3ad` |
| Environment | local |
| Command / procedure | `.claude/bin/gates.py full`: `python3 .claude/bin/control_plane_check.py && python3 -m unittest discover -s .claude/tests -t .claude/tests` → pass (exit 0, 20.6 s); `uvx ruff@0.15.12 format --check --config .claude/ruff.toml .claude && uvx ruff@0.15.12 check --config .claude/ruff.toml .claude && uvx --from mypy==2.3.1 mypy --config-file .claude/mypy.ini` → pass (exit 0, 0.3 s); `node scripts/check-conventional-commit.ts --self-test && node scripts/check-no-ai-mentions.ts --self-test` → pass (exit 0, 0.1 s); `node scripts/check-adr-coverage.ts && node scripts/check-domain-coverage.ts && node scripts/check-dfd-coverage.ts && node scripts/check-threat-model-refs.ts && node scripts/check-data-classification.ts && node scripts/check-subprocessors.ts && node scripts/check-brand-strings.ts` → pass (exit 0, 1.3 s); `pnpm exec prettier --check .` → pass (exit 0, 2.3 s); `pnpm lint` → pass (exit 0, 7.9 s); `pnpm exec depcruise apps packages scripts --config .dependency-cruiser.cjs` → pass (exit 0, 0.7 s); `pnpm typecheck` → pass (exit 0, 3.7 s); `pnpm test` → pass (exit 0, 4.6 s); `pnpm test:integration` → pass (exit 0, 4.9 s); `node scripts/check-migrations.ts` → pass (exit 0, 0.1 s); `pnpm turbo run build` → pass (exit 0, 3.7 s); `node scripts/check-licences.ts` → pass (exit 0, 0.4 s); `gitleaks git --redact --no-banner --config .gitleaks.toml .` → pass (exit 0, 0.4 s) |
| Result | PASS |
| CI run / artifact | pending |
| Reviewer | pending |

Sensitive material is stored by reference only (PLAN.md evidence rules).

QG-09 review of `origin/main..HEAD`: the `security-reviewer`, `architecture-reviewer` and
`invariant-reviewer` agents, run independently on the diff at `7f39e045073b`. All three returned
BLOCK MERGE. Their findings converged on two issues and each found one the others missed.

**Every High and Critical finding was reproduced against real PostgreSQL before being fixed**, and
the measurements are now assertions in the suite so the premises cannot rot silently.

| Finding | Reproduced | Fix | Proof |
| --- | --- | --- | --- |
| Argument scanner inoperable and **fails open** (all three reviews) | as `moin_app`: `permission denied`; as `moin_migrator`: **0 findings, exit 0, "every stored argument is a registered key"** while a planted leak sat in the table | per-tenant sweep as `moin_app` through the claim function; reports events inspected; fails when that is zero; never prints a key either | N12, N13, N14, S1–S6 |
| Head rollback silences the verifier (security review) | `last_seq = 0` → `{valid: true, checked: 0}` with 3 events present | head may only advance by one; hash may not change while the sequence stands; verifier reports `event-past-head` | N1, N2 |
| Forged event past the head (security review) | insert at `seq 999999` → `{valid: true, checked: 3}`, and `listAuditEvents` serves it | `BEFORE INSERT` guard requires correct `seq`, `prev_hash` and hash | N3 |
| `TRUNCATE` bypasses every append-only guard (invariant review) | row-level triggers do not fire on `TRUNCATE` | statement-level `BEFORE TRUNCATE` guards on events, heads and the register | N4, N5 |
| Guards were origin-only, so `session_replication_role = 'replica'` skips them (invariant review) | `tgenabled = 'O'` on every guard | all guards `ENABLE ALWAYS`; the catalog check now requires `'A'` and rejects `'O'` | N9 |
| No backfill: tenants existing before the migration are unregistered **permanently** (architecture + invariant + security) | the template is built on an empty database, which is exactly why it was invisible | backfill inside the migration, with FORCE lifted for that one transaction and an equality assertion | N8, via a staged-migration test on a bare database |
| The register vouches for itself; an empty register reads as `sound`, exit 0 (all three) | `tenants: 0` satisfied `isSound` | reconciliation against global `provisioning_requests`; `unregistered` in the report; `isSound` false; zero tenants is a failed run | N6, N7, N11, N16 |
| A replaced function body defeats every identity rule (security review) | `CREATE OR REPLACE … BEGIN RETURN NEW; END` keeps OID, owner, signature and triggers | guard and writer bodies pinned by digest | N10 |
| `pg` sets `Error.name` to `"error"` for every database failure, so the SEV3 alarm's reason was useless (architecture review) | measured: `name = "error"`, `code = "42501"` | alarm carries SQLSTATE | N17 |
| Unbounded sweep, no overlap guard (architecture review) | — | advisory lock, 30-minute deadline, unreached tenants counted `unchecked` | — |
| Counters could double-count a tenant whose commit failed after its walk (both) | — | per-tenant outcome map reconciled in `onFailure` | M1, M5 |

Also fixed: the racing *first* append left the loser without a head row (`ON CONFLICT DO NOTHING`
does not wait) — now `DO UPDATE`, which takes the lock; `process.exit` in a helper truncating its own
piped stderr; the driver message echoed on stderr contrary to the comment above it; `Invalid URL`
instead of a named missing variable; and `pnpm depcruise` disagreeing with the gate command.

**Negative controls: 42 defect variants injected, all 42 KILLED.** Each was applied to the working
tree, run against only the test that must catch it, required to produce a non-zero exit, then
restored byte-for-byte. Ten initially SURVIVED and every one was a weak *test* rather than weak code
— most instructively, the INV-12 field assertion ran only over a sound sweep and so never exercised
the failure path where a driver message would leak, and the vacuous-pass guard in the scanner's
`main()` was never reached because no test ran it as a process. Both are now covered.

Five findings are **open and recorded, not closed** — see the "Known residuals" table in ADR-0017:
the verifier still runs as the request-serving role until Terraform can provision a dedicated one
(EXT-09); a registry of permitted `(operation, target_kind)` pairs needs a writer-contract change
(P07/P16); `locations` still carries unaudited DML for `moin_app` (P07); routing the alarm lines
through the redacting logger would edit the INV-12 allowlist, which is the founder's call; and
`pg_temp` in definer search paths is a repository-wide convention.

HIGH/CRITICAL findings are therefore either fixed with a mutation-proven test, or open with a named
owner and a reason. QG-09 founder review of this diff is still required.

# EV-P06-036: Founder QG-09 acceptance of PR #31 at reviewed HEAD 468827a: ADR-0017 accepted with five recorded residual dispositions, P06.10.07 verified, P06.10.03 and P06.10.05 left open

| Field | Value |
|---|---|
| Evidence ID | EV-P06-036 |
| Item | P06.10.06 |
| Date (UTC) | 2026-10-02 01:15 UTC |
| Commit | `468827a2e9622c9ecd831d8ea661c28738174070` |
| Environment | local |
| Command / procedure | `.claude/bin/gates.py full`: `python3 .claude/bin/control_plane_check.py && python3 -m unittest discover -s .claude/tests -t .claude/tests` → pass (exit 0, 25.7 s); `uvx ruff@0.15.12 format --check --config .claude/ruff.toml .claude && uvx ruff@0.15.12 check --config .claude/ruff.toml .claude && uvx --from mypy==2.3.1 mypy --config-file .claude/mypy.ini` → pass (exit 0, 0.3 s); `node scripts/check-conventional-commit.ts --self-test && node scripts/check-no-ai-mentions.ts --self-test` → pass (exit 0, 0.1 s); `node scripts/check-adr-coverage.ts && node scripts/check-domain-coverage.ts && node scripts/check-dfd-coverage.ts && node scripts/check-threat-model-refs.ts && node scripts/check-data-classification.ts && node scripts/check-subprocessors.ts && node scripts/check-brand-strings.ts` → pass (exit 0, 1.6 s); `pnpm exec prettier --check .` → pass (exit 0, 3.6 s); `pnpm lint` → pass (exit 0, 3.8 s); `pnpm exec depcruise apps packages scripts --config .dependency-cruiser.cjs` → pass (exit 0, 0.9 s); `pnpm typecheck` → pass (exit 0, 1.2 s); `pnpm test` → pass (exit 0, 6.8 s); `pnpm test:integration` → pass (exit 0, 10.8 s); `node scripts/check-migrations.ts` → pass (exit 0, 0.1 s); `pnpm turbo run build` → pass (exit 0, 0.3 s); `node scripts/check-licences.ts` → pass (exit 0, 0.5 s); `gitleaks git --redact --no-banner --config .gitleaks.toml .` → pass (exit 0, 0.6 s) |
| Result | PASS |
| CI run / artifact | pending |
| Reviewer | founder (QG-09); independent verdict READY_FOR_FOUNDER_QG09 |

Sensitive material is stored by reference only (PLAN.md evidence rules).

A governance record. It changes no implementation, harness or schema file. The commit above is the
**reviewed implementation HEAD**; the governance commit that carries this record follows it and
touches documentation only.

## The verdict

- Independent QG-09 verdict: **`READY_FOR_FOUNDER_QG09`**
- Reviewed implementation HEAD: `468827a2e9622c9ecd831d8ea661c28738174070`
- Base: `5a28f0846f8aefaafadebf7520e05c26fa0f0b0e`
- Founder decision: QG-09 accepted, with the five residual dispositions below.

## Founder checks made before acceptance was recorded

Two dispositions were conditional on facts about the code at `468827a`. Both were checked against the
source, not assumed.

### Residual 2: who can supply `operation`, `target_kind` and `versions`

The condition: no untrusted or external caller can put arbitrary values for these fields into the
audit trail. Every path into `app.append_audit_event`:

| Path | Who reaches it | Values |
| --- | --- | --- |
| `appendAuditEvent()` (`packages/db/src/audit.ts`) | **No production caller.** `git grep appendAuditEvent` outside tests finds only its definition and the `@moin/db` re-export | caller-supplied, but there is no caller |
| `app.audit_provisioning_request()` trigger (`0009_provisioning_audit.sql`) | `provisioning_requests` inserts, through the reviewed provisioning function | fixed literals: `'tenant.provisioned'`, `'organisation'`, `versions = '{}'` |
| direct SQL `app.append_audit_event(...)` | `EXECUTE` is granted to `moin_app` only, after `REVOKE ALL … FROM PUBLIC`; reaching it needs the runtime role's database credentials | caller-supplied, by a trusted internal holder |

The HTTP surface of `apps/server` is `GET /healthz`, `GET /readyz`, `POST /voice/inbound` and
`POST /voice/session-end`. The voice module imports neither `@moin/db` nor any audit API, and the
health module uses only readiness. **No external request can reach the writer.**

The condition holds, and the disposition is recorded.

### Residual 4: what the alarm lines bypassing the redacting logger contain

The condition: the output that bypasses `@moin/observability` contains no personal data, secrets,
tokens, raw payloads, user-controlled strings or propagated exception text. It is every `emit()` in
`packages/db/src/cli.ts` `verifyAudit()`, through the closed `AlarmLine` type, plus that command's
`console.error` lines.

| Field | Source | Content |
| --- | --- | --- |
| `event`, `severity`, `outcome`, `runbook` | literals in `cli.ts` | fixed strings |
| `count`, `sound`, `broken`, `unchecked`, `unreached`, `unregistered`, `durationMs` | sweep report | integers |
| `seq`, `checked`, `populationHighWater` | `bigint` sequence numbers rendered as text | digits |
| `organisationId` | the register's server-generated organisation UUID | an opaque identifier, not user-controlled. It identifies a tenant organisation, not a person |
| `reason` on `audit.chain.broken` | `verifyAuditChain` | one of six fixed literals: `missing-head`, `event-past-head`, `missing-event`, `sequence-gap`, `previous-hash`, `payload-mismatch` |
| `reason` on `unchecked` / `run.failed` | `sqlState(error)` | a regex-checked five-character SQLSTATE, or else the error's class name (`Error.name`, never `'error'`), or `'unknown'`. **Never `message` or `stack`** |
| `console.error` in `verifyAudit` / `main` | literals | a fixed sentence about `DATABASE_URL`; `the command failed (<sqlState>); see the runbook` |

No personal data, secret, token, raw payload, user-controlled string or exception message.

The only value not drawn from a closed set is the `Error.name` fallback in `sqlState`. That is the
exception's **class identifier**, which code sets, and not text derived from input. It is recorded
here rather than glossed over. If a future error class ever carried data in `name`, the forward rule
below applies to it.

The condition holds, and the disposition is recorded.

## The five dispositions

| # | Residual | Founder decision | Constraint recorded |
| --- | --- | --- | --- |
| 1 | `moin_app` enumerates tenant ids; no dedicated verifier role | **Deferral accepted.** Not waived | `EXTERNAL_DEPENDENCY` / EXT-09; a hard pre-production dependency. P06.10.05 stays `WAITING_FOR_EXTERNAL` |
| 2 | `operation`, `target_kind`, `versions` are caller-supplied | **Accepted for the current trusted internal writers only.** Not an authorization or security boundary | Before any untrusted or external writer is permitted, these fields must be server-derived or constrained and validated at the trusted service boundary. A scoped residual, not a widening of trust |
| 3 | `locations` DML is unaudited | **Accepted as deferred coverage**, tied to P06.10.03 and later writer adoption | `locations` DML stays outside the adopted writer coverage. Complete or universal audit-writer coverage may not be claimed until P06.10.03 closes |
| 4 | `verify-audit` alarm lines bypass the redacting logger | **Accepted for this PR only**, on the verified non-sensitive output above | Any future dynamic tenant, user or error payload must go through the redacting logger. INV-12 is not waived |
| 5 | `pg_temp` last in definer `search_path` | **Acceptable for this PR only** | **Not a precedent** for future `SECURITY DEFINER` functions; each future privileged path needs its own `search_path` / QG-09 assessment |

## Resulting status

| Item | Status |
| --- | --- |
| ADR-0017 | **ACCEPTED** |
| P06.10.06 (accept ADR-0017) | done; this record |
| P06.10.07 | **VERIFIED** (founder-authorized; evidence EV-P06-025 … EV-P06-035) |
| P06.10.03 | **OPEN**, including `locations` coverage |
| P06.10.05 | **WAITING_FOR_EXTERNAL**, EXT-09 |
| P06.10 | **IN_PROGRESS**, not complete |
| P06 | **IN_PROGRESS** |

No external gate is marked complete, and PR #31 stays a draft.

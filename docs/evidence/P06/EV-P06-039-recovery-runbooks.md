# EV-P06-039: MFA-reset and compromised-account runbooks normalized from 74bc27f onto current main: reconciled with ADR-0005, P06.05.04 identity, P06.10 audit state and the threat model; every unbuilt control marked pending with its item; no procedure executed, no tabletop run

| Field | Value |
|---|---|
| Evidence ID | EV-P06-039 |
| Item | P06.09.03 |
| Date (UTC) | 2026-10-02 03:38 UTC |
| Commit | `b4ac2449cd27b36585edbfd2d245037c0fda1f8d` |
| Environment | local |
| Command / procedure | `.claude/bin/gates.py full`: `python3 .claude/bin/control_plane_check.py && python3 -m unittest discover -s .claude/tests -t .claude/tests` → pass (exit 0, 24.6 s); `uvx ruff@0.15.12 format --check --config .claude/ruff.toml .claude && uvx ruff@0.15.12 check --config .claude/ruff.toml .claude && uvx --from mypy==2.3.1 mypy --config-file .claude/mypy.ini` → pass (exit 0, 0.7 s); `node scripts/check-conventional-commit.ts --self-test && node scripts/check-no-ai-mentions.ts --self-test` → pass (exit 0, 0.1 s); `node scripts/check-adr-coverage.ts && node scripts/check-domain-coverage.ts && node scripts/check-dfd-coverage.ts && node scripts/check-threat-model-refs.ts && node scripts/check-data-classification.ts && node scripts/check-subprocessors.ts && node scripts/check-brand-strings.ts` → pass (exit 0, 1.6 s); `pnpm exec prettier --check .` → pass (exit 0, 3.5 s); `pnpm lint` → pass (exit 0, 3.9 s); `pnpm exec depcruise apps packages scripts --config .dependency-cruiser.cjs` → pass (exit 0, 1.0 s); `pnpm typecheck` → pass (exit 0, 1.1 s); `pnpm test` → pass (exit 0, 5.7 s); `pnpm test:integration` → pass (exit 0, 10.4 s); `node scripts/check-migrations.ts` → pass (exit 0, 0.1 s); `pnpm turbo run build` → pass (exit 0, 0.3 s); `node scripts/check-licences.ts` → pass (exit 0, 0.4 s); `gitleaks git --redact --no-banner --config .gitleaks.toml .` → pass (exit 0, 0.8 s) |
| Result | PASS |
| CI run / artifact | pending |
| Reviewer | pending |

Sensitive material is stored by reference only (PLAN.md evidence rules).

A documentation record. It changes no implementation, test, schema, workflow or dependency file.
It proves the runbooks exist and were reconciled with the architecture on `main` at `c85934a`. It
does **not** show that any procedure was executed, that MFA reset or session revocation works, or
that a tabletop passed.

## Source and base

- Base: `c85934acf9e329f8dc9d6fec9b3aecf3f78778da` (`main`, PR #33)
- Preserved source: `74bc27f66028eb1c205fabdd09b93df803f60c85` on `feat/p06-05-oidc` (parent
  `9f4afeb`, not in `main`), left untouched

## Disposition of the source commit

| File | Old purpose | P06.09.03? | Replayed | Adaptation | Reason |
| --- | --- | --- | --- | --- | --- |
| `docs/runbooks/mfa-reset.md` | draft MFA-reset runbook | yes | yes, rewritten | substantial | Stale assumptions against the threat model, ADR-0005 and the state of `main` (below) |
| `docs/runbooks/compromised-account.md` | draft compromise runbook | yes | yes, rewritten | substantial | Same, plus the 16 required topics |
| `PROGRESS.md` | `P06.09.03 IN_PROGRESS` row naming `feat/p06-05-oidc` | bookkeeping | no | replaced | The row named a stale branch and status; a new `READY_FOR_REVIEW` row is appended instead |

The source commit contains no implementation or runtime change.

## Preservation

| Category | Content |
| --- | --- |
| **Preserved** (substance) | Outbound callback only to the number on record, never a supplied one or inbound caller ID; target resolved from membership records, not from an email; never ask for passwords, TOTP secrets, recovery codes or full card numbers; never disable required MFA or issue bypass codes; server-side session revocation first, provider sign-out as a supplement because issued tokens stay valid until expiry (AWS link kept); audit with opaque IDs and failure means incomplete; notify only through an existing channel; preserve evidence and do not delete the user first; no tenant switch on a reported header, email or number; inventory before rotating, never other tenants' credentials; chain break is a separate SEV2; missing logs do not prove no exposure; no improvised notification deadline; last-owner check |
| **Adapted** | Status header to "defined, not executable" with a control-by-control table; the dependency list from "P06.05–P06.11" to exact items; notification to P15.10.02 and the ≤ 24 h controller target from PLAN; audit to the writer that exists with no production caller (P06.10.03 open); severity to the PLAN alerting table, marked provisional until P15.10.01 |
| **Omitted** | `AdminDeleteSoftwareToken` (an unverified provider operation; the operations are defined in P06.09.02 against the provisioned pool); the `identity.mfa_reset` event name (operations and argument keys are registered when built, not invented); "founder-approved recovery path" for the last owner (no document defines one; the runbook now stops and escalates); the staging confirmation steps as runbook actions (they are P06.09.04 / P06.05.05 / P06.06.07 verification) |
| **Added** | The threat model's finding that the registered number is answered by our own assistant and that billing data is on every invoice, so both are compromised by default and an additional, undecided factor is a pending control (P06.09.02) — the old draft treated the two as sufficient; an explicit list of what never counts as proof (IdP roles and groups, voice assertions, supplied numbers or emails, single factors); fail-closed and abort/rollback sections; scope of the runbook (password reset and operator accounts excluded); R-4 framing (callers' data, customer as controller); signs of compromise; membership review in the application, never at the IdP; tenant-isolation check with SEV1 escalation; recovery criteria; post-incident follow-up; operator-account handling |

## Safety review

Both runbooks were searched for: disabling MFA without proof, email-only verification, trusting a
supplied phone number, editing roles in the IdP, trusting provider groups for RBAC, logging
secrets, asking for a password, TOTP seed or recovery code, exposing tokens or client secrets,
skipping session revocation, and deleting evidence before review. Every match is a prohibition.

## Result

| Check | Result |
| --- | --- |
| Both files exist | `docs/runbooks/mfa-reset.md`, `docs/runbooks/compromised-account.md` |
| Gates at `b4ac244` | `gates.py full` 14/14 PASS, 0 changed files |
| Status | P06.09.03 `READY_FOR_REVIEW`; P06.09.01, .02 and .04 open; P06.09 incomplete |

## Remediation after independent review

The independent review of `ddbaedc658ac1183c1fd1f1293b0d7a0db5e8096` returned `BLOCK_MERGE` with one
HIGH finding in `docs/runbooks/compromised-account.md`: containment revoked existing sessions but
did not stop the compromised identity signing in again and getting a fresh session, and it said that
provider sign-out stops the provider issuing and refreshing tokens.

The containment section now separates three controls: revoke existing KlarDesk sessions (A), deny
new KlarDesk access (B), and provider-side sign-out or token revocation (C, supplementary). It makes
A and B mandatory, and requires two verifications: old session rejected, fresh sign-in yields no
usable access. The deny-new-access state persists until recovery is authorised, unchanged for the
only owner and applied to operator accounts. If B cannot be applied or verified, the account is
recorded as not contained and the incident stays open. The founder's containment policy is recorded
as the intended P06.09.02 behaviour. The enforcing mechanism is **not decided** and is marked
pending in P06.09.02; nothing was implemented, executed or verified. P06.09.03 stays
`READY_FOR_REVIEW`.

## Second remediation: MFA re-enrolment before access

Self-review at `bf4282529fdad6ec9d0a0140c1900bcba7b7226c` found that `docs/runbooks/mfa-reset.md`
still said "the next sign-in must enrol a new TOTP app or passkey", which left a window in which an
ordinary session could exist before a new factor. The execution section now fixes the order: revoke
sessions, deny ordinary access, remove the lost factor, enrol a new factor in a recovery-only
authentication, verify the enrolment, finalise and audit, and only then restore ordinary access. A
stop condition forbids the reset while the system cannot guarantee that order; today it cannot
(P06.09.02, P06.06.01, P06.06.03, P06.05.02, P06.05.05). A lost device alone is not an incident and
does not rotate the password. This is documentation only: no recovery-only state, session gating or
enrolment enforcement exists or was tested.

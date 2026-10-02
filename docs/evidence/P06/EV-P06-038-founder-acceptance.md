# EV-P06-038: Founder acceptance of PR #33 at reviewed HEAD 1801feb: P06.05.04 verified on the independent verdict READY_FOR_FOUNDER_P06_05_04; IdP roles removed, environment provider matrix and strict email_verified accepted; P06.05.01-.03 and .05 left open

| Field | Value |
|---|---|
| Evidence ID | EV-P06-038 |
| Item | P06.05.04 |
| Date (UTC) | 2026-10-02 02:46 UTC |
| Commit | `1801febcb460fb64c803b50a49d1239366c543af` |
| Environment | local |
| Command / procedure | `.claude/bin/gates.py full`: `python3 .claude/bin/control_plane_check.py && python3 -m unittest discover -s .claude/tests -t .claude/tests` → pass (exit 0, 22.9 s); `uvx ruff@0.15.12 format --check --config .claude/ruff.toml .claude && uvx ruff@0.15.12 check --config .claude/ruff.toml .claude && uvx --from mypy==2.3.1 mypy --config-file .claude/mypy.ini` → pass (exit 0, 0.2 s); `node scripts/check-conventional-commit.ts --self-test && node scripts/check-no-ai-mentions.ts --self-test` → pass (exit 0, 0.1 s); `node scripts/check-adr-coverage.ts && node scripts/check-domain-coverage.ts && node scripts/check-dfd-coverage.ts && node scripts/check-threat-model-refs.ts && node scripts/check-data-classification.ts && node scripts/check-subprocessors.ts && node scripts/check-brand-strings.ts` → pass (exit 0, 1.5 s); `pnpm exec prettier --check .` → pass (exit 0, 3.1 s); `pnpm lint` → pass (exit 0, 3.2 s); `pnpm exec depcruise apps packages scripts --config .dependency-cruiser.cjs` → pass (exit 0, 0.8 s); `pnpm typecheck` → pass (exit 0, 1.1 s); `pnpm test` → pass (exit 0, 5.6 s); `pnpm test:integration` → pass (exit 0, 10.0 s); `node scripts/check-migrations.ts` → pass (exit 0, 0.1 s); `pnpm turbo run build` → pass (exit 0, 0.3 s); `node scripts/check-licences.ts` → pass (exit 0, 0.4 s); `gitleaks git --redact --no-banner --config .gitleaks.toml .` → pass (exit 0, 0.5 s) |
| Result | PASS |
| CI run / artifact | pending |
| Reviewer | founder; independent verdict READY_FOR_FOUNDER_P06_05_04 |

Sensitive material is stored by reference only (PLAN.md evidence rules).

A governance record. It changes no implementation, test, realm, workflow or dependency file. The
commit above is the **reviewed implementation HEAD**; the governance commit that carries this record
follows it and touches documentation only.

## The verdict

- Independent verdict: **`READY_FOR_FOUNDER_P06_05_04`**
- Reviewed implementation HEAD: `1801febcb460fb64c803b50a49d1239366c543af`
- Base: `14fe4433af80990238df7b02465845c459e0e9c`
- Implementation evidence: EV-P06-037
- Founder decision: P06.05.04 accepted, with the decisions below.

## Founder decisions

| # | Decision | Founder ruling | Constraint recorded |
| --- | --- | --- | --- |
| 1 | IdP roles removed from the local realm | **Accepted** | Memberships, tenant access, roles and permissions stay database- and application-owned (ADR-0005). The provider authenticates only; the trusted identity stays `{ subject, email }`. `owner`, `admin`, `staff`, `operator`, roles, groups and tenant, organisation or location claims are not to be restored as trusted IdP authorization state |
| 2 | Environment provider matrix | **Accepted** | `development` and `test` → `keycloak`; `staging` and `production` → `cognito`. No fallback, no provider inference, no Cognito under `NODE_ENV=test` at this stage. Real-Cognito verification belongs to staging and P06.05.05 unless a later accepted architecture decision changes that |
| 3 | `email_verified` | **Accepted** | Only `email_verified === true` passes. `"true"`, `1` and other truthy forms are not coerced; the parser consumes ID-token claims and fails closed |
| 4 | Raw-token extra claims | **Non-blocking maintenance note** | The old-realm negative control also flags harmless standard claims (`name`, `preferred_username`, `given_name`, `family_name`). They never enter the canonical identity, which is built from `subject` and `email` only, so canonical-identity correctness is not raw-token minimal-shape equality. Future standard-claim drift in Keycloak is assessed separately from the canonical identity invariant (`docs/verification/README.md`). No implementation change and no new ticket |

## Resulting status

| Item | Status |
| --- | --- |
| P06.05.04 | **VERIFIED** (founder-authorized; evidence EV-P06-037, this record) |
| P06.05.01 | **OPEN** (Terraform customer pool; needs P05 / EXT-09) |
| P06.05.02 | **OPEN** (MFA: TOTP and passkeys) |
| P06.05.03 | **OPEN** (password policy and threat protection) |
| P06.05.05 | **OPEN** (the real staging verification of Cognito and MFA) |
| P06.05 | **IN_PROGRESS**, not complete |
| P06 | **IN_PROGRESS** |

Not credited here: MFA, Cognito staging behaviour, and everything P06.06.01 and later own (callback,
code exchange, PKCE verifier lifecycle, `state` and nonce validation, provider token persistence,
sessions, cookies). PR #33 stays a draft.

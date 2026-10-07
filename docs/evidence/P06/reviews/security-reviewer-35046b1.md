# security-reviewer — QG-09 review at 35046b1 (Step-up MFA ≤ 15 min for sensitive actions)

| Field | Value |
|---|---|
| Reviewer role | security-reviewer |
| Implementation SHA | `35046b1b87dda2c8af8ccf4fefbe8e29d86b48df` (full 40-char; branch `feat/p06-06-step-up-mfa`, base `48a551d846f9bf6ba5838abc6f0d321f6aefdd8a`) |
| Scope reviewed | Step-up MFA implementation (P06.06.04): RFC 9457 step_up_required challenge, 15-minute validity window on session token, `step_up_at` timestamp management in DB (`0015_step_up_mfa.sql`), provider re-authentication with fresh `auth_time` verification, subject-binding check, `moin_identity` role privilege isolation, and full 64-variant mutation suite. |
| Verdict | OK TO MERGE |

## Findings

- Fresh sign-in records `step_up_at = v_now` (initial sign-in satisfies MFA requirement).
- Rotation with reason `'step_up'` updates `step_up_at` to current timestamp; other rotations (`'privilege_change'`, `'reissue'`) strictly preserve existing `step_up_at`.
- Re-authentication flow via OIDC provider requires `auth_time` claim from ID token to be within 15 minutes of completion, preventing replay of cached SSO credentials.
- Step-up rotation verifies that provider subject exactly matches authenticated session user (`SU7`), preventing identity confusion/swap attacks.
- Sensitive endpoints guarded by `RequireStepUpGuard` return RFC 9457 compliant 403 response with problem detail type `urn:problem:step_up_required`.
- GET read cache enforces `stepUpExpiresAtMs` deadline ensuring cached verdicts never outlive the 15-minute stamp window (`SU9` killed).
- Unstamped sessions remain cacheable across standard reads (`Infinity` deadline).
- Database definer allowlist updated and verified for both `begin_sign_in` signatures. `moin_app` possesses zero execute grants on identity functions.

## Dispositions

- Nothing blocks merge.

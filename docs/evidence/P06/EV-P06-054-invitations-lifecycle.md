# EV-P06-054: Invitations and membership lifecycle: issuance, token-bound accept, disable/remove, ownership transfer

| Field | Value |
|---|---|
| Evidence ID | EV-P06-054 |
| Item | P06.08.01, P06.08.02, P06.08.03, P06.08.04 |
| Date (UTC) | 2026-10-07 22:40 UTC |
| Commit | `0748a86230b4ad1d5036d1752901c543d0a4246d` |
| Environment | local |
| Command / procedure | `.claude/bin/gates.py full`: `python3 .claude/bin/control_plane_check.py && python3 -m unittest discover -s .claude/tests -t .claude/tests` → pass (exit 0, 29.8 s); `uvx ruff@0.15.12 format --check --config .claude/ruff.toml .claude && uvx ruff@0.15.12 check --config .claude/ruff.toml .claude && uvx --from mypy==2.3.1 mypy --config-file .claude/mypy.ini` → pass (exit 0, 0.4 s); `node scripts/check-conventional-commit.ts --self-test && node scripts/check-no-ai-mentions.ts --self-test` → pass (exit 0, 0.2 s); `node scripts/check-adr-coverage.ts && node scripts/check-domain-coverage.ts && node scripts/check-dfd-coverage.ts && node scripts/check-threat-model-refs.ts && node scripts/check-data-classification.ts && node scripts/check-subprocessors.ts && node scripts/check-brand-strings.ts` → pass (exit 0, 2.0 s); `pnpm exec prettier --check .` → pass (exit 0, 5.5 s); `pnpm lint` → pass (exit 0, 10.2 s); `pnpm exec depcruise apps packages scripts --config .dependency-cruiser.cjs` → pass (exit 0, 1.1 s); `pnpm typecheck` → pass (exit 0, 5.4 s); `pnpm test` → pass (exit 0, 7.6 s); `pnpm test:integration` → pass (exit 0, 20.2 s); `node scripts/check-migrations.ts` → pass (exit 0, 0.1 s); `pnpm turbo run build` → pass (exit 0, 7.8 s); `node scripts/check-licences.ts` → pass (exit 0, 0.5 s); `gitleaks git --redact --no-banner --config .gitleaks.toml .` → pass (exit 0, 1.1 s) |
| Result | PASS |
| CI run / artifact | pending |
| Reviewer | pending QG-09 triad at final SHA (security, architecture, invariant) |

| Mutation sweep | KILLED: members.integration.test.ts detects the fix (fails without, passes with; mutation-check working-tree mode, this session) |
| Review fix | ed4ca21 closes HIGH1 (single-txn row-locked disable/remove, FOR UPDATE before role read, audit same commit), HIGH2 (clock_timestamp expiry at lock + divergence test), HIGH3 (atomic audit on all five mutations, accept included via DEFINER-adjacent caller commit; refused writes leave no trace), MEDIUM (owner existence 404 incl. invite-owner 404); full gates 14/14 |
| Scope note | No HTTP accept route: the invitee has no `users` row and sign-in refuses unknown subjects by design, so no session exists to authenticate the call; the organisation is unknown until the token is read (INV-02). `acceptInvitation` / `app.accept_invitation` are built and store-layer tested; the entry path is an open design decision (PROGRESS.md). Real email delivery rides P14 (EXT-09 SES): the German template is issuer-delivered until then. Task assignment return-to-unassigned is out of scope: no tasks table exists yet. |
| QG-09 status | NOT re-run at this SHA. Required before READY_FOR_REVIEW. |

Sensitive material is stored by reference only (PLAN.md evidence rules).

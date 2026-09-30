# EV-P06-024: Daily cross-tenant chain sweep with SEV2 alarm and exit-code split

| Field | Value |
|---|---|
| Evidence ID | EV-P06-024 |
| Item | P06.10.05 |
| Date (UTC) | 2026-09-30 14:02 UTC |
| Commit | `8e5bf76f5ac9ec00e2394036927aefb092d5b763` (working tree had uncommitted changes) |
| Environment | local |
| Command / procedure | `.claude/bin/gates.py full`: `python3 .claude/bin/control_plane_check.py && python3 -m unittest discover -s .claude/tests -t .claude/tests` → pass (exit 0, 20.6 s); `uvx ruff@0.15.12 format --check --config .claude/ruff.toml .claude && uvx ruff@0.15.12 check --config .claude/ruff.toml .claude && uvx --from mypy==2.3.1 mypy --config-file .claude/mypy.ini` → pass (exit 0, 0.6 s); `node scripts/check-conventional-commit.ts --self-test && node scripts/check-no-ai-mentions.ts --self-test` → pass (exit 0, 0.1 s); `node scripts/check-adr-coverage.ts && node scripts/check-domain-coverage.ts && node scripts/check-dfd-coverage.ts && node scripts/check-threat-model-refs.ts && node scripts/check-data-classification.ts && node scripts/check-subprocessors.ts && node scripts/check-brand-strings.ts` → pass (exit 0, 1.4 s); `pnpm exec prettier --check .` → pass (exit 0, 2.4 s); `pnpm lint` → pass (exit 0, 7.0 s); `pnpm exec depcruise apps packages scripts --config .dependency-cruiser.cjs` → pass (exit 0, 0.7 s); `pnpm typecheck` → pass (exit 0, 4.2 s); `pnpm test` → pass (exit 0, 4.7 s); `pnpm test:integration` → pass (exit 0, 4.4 s); `node scripts/check-migrations.ts` → pass (exit 0, 0.1 s); `pnpm turbo run build` → pass (exit 0, 4.5 s); `node scripts/check-licences.ts` → pass (exit 0, 0.4 s); `gitleaks git --redact --no-banner --config .gitleaks.toml .` → pass (exit 0, 0.4 s) |
| Result | PASS |
| CI run / artifact | pending |
| Reviewer | pending |

Sensitive material is stored by reference only (PLAN.md evidence rules).

**This item is not complete.** The sweep, the alarm signal and the runbook are implemented and
verified; the daily *trigger* and the CloudWatch alarms that match the emitted lines are
Terraform-managed (P05/P15), need the AWS account (EXT-09) and are **not provisioned**. P06.10.05
stays open on that and is recorded `WAITING_FOR_EXTERNAL`.

Standalone real-PostgreSQL runs: `packages/db/src/audit-verification.integration.test.ts` 13/13 and
`packages/db/src/cli-verify-audit.integration.test.ts` 4/4.

What is proven here:

- **Tenants cannot be enumerated unelevated**, measured rather than assumed: with no tenant context,
  FORCE RLS leaves `moin_migrator` — which owns `organisations` — counting zero rows, and a
  `SECURITY DEFINER` function owned by it returns nothing. This is why the tenant list is a global
  register, and the assertion is in the suite so the premise cannot rot silently.
- The register is filled by a trigger on `organisations`, is append-only against a privileged DELETE
  and UPDATE, and is not readable by `moin_app` at all. The runtime role receives a key-paged set of
  identifiers capped at 1000 however much it asks for (asserted with 1001 tenants in a dedicated
  database).
- The sweep walks every registered tenant across page boundaries, keeps `sound`, `broken` and
  `unchecked` disjoint and summing to the tenant count, and **rejects rather than returning an empty
  clean report** when the register cannot be read.
- Walking the register rather than `audit_heads` is load-bearing: a deleted head is reported as
  `missing-head` for that tenant instead of removing it from the worklist.
- The alarm carries `SEV2`, the tenant, the reason, the sequence and its runbook path, and fires as
  each break is found rather than only at the end. Exit codes are `0` sound, `3` broken, `1` could
  not complete.
- Every emitted line carries only reviewed non-personal fields, asserted across the sound, broken
  and unchecked line kinds — the failure path is where a driver message would leak, so a sound-only
  sample would have proved nothing.

Nineteen defect variants were injected and each was KILLED by the test that must catch it (see the
note in EV-P06-025 for the method); the ones for this item are the register source, the register
guard, the registration trigger, the page cap, the runtime grant, the paging loop, the page-size
bound, the sound/unchecked collapse, the swallowed claim error, the exit-code collapse, the severity
downgrade, the dropped runbook link and the leaked driver message.

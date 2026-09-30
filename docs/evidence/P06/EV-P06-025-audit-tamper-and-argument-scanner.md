# EV-P06-025: Tamper detection, privileged-mutation refusal and the stored-argument scanner

| Field | Value |
|---|---|
| Evidence ID | EV-P06-025 |
| Item | P06.10.07 |
| Date (UTC) | 2026-09-30 14:02 UTC |
| Commit | `8e5bf76f5ac9ec00e2394036927aefb092d5b763` (working tree had uncommitted changes) |
| Environment | local |
| Command / procedure | `.claude/bin/gates.py full`: `python3 .claude/bin/control_plane_check.py && python3 -m unittest discover -s .claude/tests -t .claude/tests` → pass (exit 0, 20.6 s); `uvx ruff@0.15.12 format --check --config .claude/ruff.toml .claude && uvx ruff@0.15.12 check --config .claude/ruff.toml .claude && uvx --from mypy==2.3.1 mypy --config-file .claude/mypy.ini` → pass (exit 0, 0.6 s); `node scripts/check-conventional-commit.ts --self-test && node scripts/check-no-ai-mentions.ts --self-test` → pass (exit 0, 0.1 s); `node scripts/check-adr-coverage.ts && node scripts/check-domain-coverage.ts && node scripts/check-dfd-coverage.ts && node scripts/check-threat-model-refs.ts && node scripts/check-data-classification.ts && node scripts/check-subprocessors.ts && node scripts/check-brand-strings.ts` → pass (exit 0, 1.4 s); `pnpm exec prettier --check .` → pass (exit 0, 2.4 s); `pnpm lint` → pass (exit 0, 7.0 s); `pnpm exec depcruise apps packages scripts --config .dependency-cruiser.cjs` → pass (exit 0, 0.7 s); `pnpm typecheck` → pass (exit 0, 4.2 s); `pnpm test` → pass (exit 0, 4.7 s); `pnpm test:integration` → pass (exit 0, 4.4 s); `node scripts/check-migrations.ts` → pass (exit 0, 0.1 s); `pnpm turbo run build` → pass (exit 0, 4.5 s); `node scripts/check-licences.ts` → pass (exit 0, 0.4 s); `gitleaks git --redact --no-banner --config .gitleaks.toml .` → pass (exit 0, 0.4 s) |
| Result | PASS |
| CI run / artifact | pending |
| Reviewer | pending |

Sensitive material is stored by reference only (PLAN.md evidence rules).

Standalone real-PostgreSQL runs: `audit.integration.test.ts` 11/11,
`audit-verification.integration.test.ts` 13/13, `cli-verify-audit.integration.test.ts` 4/4,
`check-audit-arguments.integration.test.ts` 6/6, `check-rls-catalog.integration.test.ts` 27/27.

The three properties P06.10.07 names:

- **Tampering is detected.** A privileged UPDATE of a committed event (append-only trigger disabled
  first, which is what the privileged actor in ADR-0017's trust boundary would have to do) is
  reported as `payload-mismatch` at the exact sequence; a deleted tail row as `missing-event`; a
  deleted head as `missing-head`.
- **`moin_app` cannot update or delete.** No write grant exists, and the trigger refuses both even
  for the table owner.
- **No personal data in `args_sanitized`.** `scripts/check-audit-arguments.ts` is the scanner. Its
  strong rule is structural rather than pattern-based: the only string-valued kind the registry
  permits is `uuid`, so any stored argument string that is not a UUID is an unreviewed value —
  which catches a business name ("Gurlitt Sanitär GmbH") that no pattern list would have predicted.
  Contact-shaped values are additionally classified as such. It also catches a key that never passed
  the writer, a value kind the registry was widened to accept (the `CHECK` constraint has to be
  dropped first, which is the point — that is a one-line migration that reads as harmless), and a
  validation entry carrying text. It never prints the value it found, and that non-disclosure is
  itself asserted.

**Method for the negative controls.** Each control was proven by injecting the corresponding defect
into the working tree, running only the test that must catch it, and requiring a non-zero exit, then
restoring the file byte-for-byte. Twenty-five variants across the migration, the verifier, the CLI,
the catalog check and the scanner were injected; **all 25 were KILLED**. Two initially SURVIVED and
both were genuine weaknesses in the tests, not in the code, and were fixed: the page-cap assertion
could not distinguish a missing cap with only three tenants, and the INV-12 field assertion ran only
over a sound sweep, so it never exercised the failure path where a driver message would leak.

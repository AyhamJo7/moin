# EV-P07-001: kernel-value-objects-plus-22-tests

| Field | Value |
|---|---|
| Evidence ID | EV-P07-001 |
| Item | P07.01.01 |
| Date (UTC) | 2026-10-10 05:17 UTC |
| Commit | `084436f8aa112f1e683d249919fcdcd89ba1ac92` (working tree had uncommitted changes) |
| Environment | local |
| Command / procedure | `.claude/bin/gates.py fast`: `python3 .claude/bin/control_plane_check.py && python3 -m unittest discover -s .claude/tests -t .claude/tests` → pass (exit 0, 24.1 s); `node scripts/check-conventional-commit.ts --self-test && node scripts/check-no-ai-mentions.ts --self-test` → pass (exit 0, 0.1 s); `node scripts/check-adr-coverage.ts && node scripts/check-domain-coverage.ts && node scripts/check-dfd-coverage.ts && node scripts/check-threat-model-refs.ts && node scripts/check-data-classification.ts && node scripts/check-subprocessors.ts && node scripts/check-brand-strings.ts` → pass (exit 0, 1.6 s); `pnpm exec prettier --check .` → pass (exit 0, 4.7 s); `pnpm lint` → pass (exit 0, 12.8 s); `pnpm typecheck` → pass (exit 0, 5.7 s); `pnpm test` → pass (exit 0, 6.0 s) |
| Result | PASS |
| CI run / artifact | PR #80 at `1b0150f`: 16/16 checks SUCCESS (verify incl. unit + integration + RLS catalog, build, e2e, security-scan, container-scan, pr-title); round-1 fix pending push (this head CI pending) |
| Reviewer | codex BLOCK round 1 on `1b0150f` (6 must-fix: precise reserved ranges + 0800/069-neighbour tests; PII-free errors; PLZ 01xxx comment + 01067 test; decimal-string cent rounding + 1.005 regression; generated phone properties + reserved-range property; fast-check to devDependencies; this CI/Reviewer staleness) — all fixed in this round |

Sensitive material is stored by reference only (PLAN.md evidence rules).

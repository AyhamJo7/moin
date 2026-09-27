# Closure report: <mission>

**State:** DRAFT (filled in per finding) · **HEAD:** `<sha>` · **Branch / PR:** `<branch>` / <url>

## Summary

- Findings: <n> total · <n> verified · <n> BLOCKED · <n> not reproduced
- Gates on final HEAD: <PASS/FAIL> (evidence: `<path>`)
- Stress: <k>/<n> passed (flake rate <x>) on `<targets>`
- Red-team (invariant-reviewer): <NO BYPASS FOUND | n bypasses, all fixed | open items>
- UNVERIFIED: <list, with reason — e.g. e2e (Docker unavailable), unit-jvm (no mvn)>

## Findings

### F-1 — <title> (<severity>)

- **Reproduced by:** `<test id>`, failing before the fix: `<failing line>`
- **Root cause:** <what was actually wrong, and why>
- **Fix:** <what changed, which execution paths were checked> (`<commit>`)
- **Mutation check:** KILLED (`<evidence path>`)

## Gates

| Tier | Result | HEAD | Evidence |
|---|---|---|---|
| full | | | |
| stress | | | |
| refs | | | |

## Remaining risks

- <risk, and what would retire it>

## Reconfirmation request

Please re-review `<sha>` against findings F-1…F-n. Evidence is listed per finding above.

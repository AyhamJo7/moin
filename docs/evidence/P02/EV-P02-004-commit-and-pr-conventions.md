# EV-P02-004: Conventional Commit titles and the no-attribution policy are enforced by self-testing checks

| Field | Value |
|---|---|
| Evidence ID | EV-P02-004 |
| Item | P02.01.03 |
| Date (UTC) | 2026-09-28 11:40 UTC |
| Commit | `766f53e2804a53cf0930e0047669c1cd8abb66e8` (working tree had uncommitted changes) |
| Environment | local (Node 24.21.0) |
| Command / procedure | node scripts/check-conventional-commit.ts --self-test -> "conventional-commit self-test passed: 13 cases" (exit 0). node scripts/check-no-ai-mentions.ts --self-test -> "no-ai-mentions self-test passed: 9 patterns, 11 blocked and 7 allowed examples" (exit 0); both read the founder-owned repository policy file that the local hook also enforces, so CI and the hook cannot drift. Both run clean over this branch (--commits). Bad input: node scripts/check-conventional-commit.ts --commits HEAD~99..HEAD -> exit 2 with a one-line message, not a stack trace. The local hook independently blocked a draft of this phase commit message because it named the policy file path, which is the rule firing on real input. |
| Result | PASS — every executable block example is caught and every allow example passes. CI wiring is .github/workflows/pr-title.yml; its first live run is recorded with the P02.06 evidence. |
| CI run / artifact | pending |
| Reviewer | pending |

Sensitive material is stored by reference only (PLAN.md evidence rules).

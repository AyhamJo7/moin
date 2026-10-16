# EV-P02-007: Annotated and signed release-tag policy documented

| Field | Value |
|---|---|
| Evidence ID | EV-P02-007 |
| Item | P02.01.06 |
| Date (UTC) | 2026-09-28 11:40 UTC |
| Commit | `766f53e2804a53cf0930e0047669c1cd8abb66e8` (working tree had uncommitted changes) |
| Environment | local |
| Command / procedure | docs/development/release-tags.md records: annotated + signed tags only (a lightweight tag carries no author, date or message and cannot be signed), vMAJOR.MINOR.PATCH with -rc.N pre-releases and no moving "latest" tag, the tag message naming the release manifest and the single image digest (INV-17), git tag --verify before a tag is used, tagging as a founder-only action, no moving or deleting a pushed tag, and QG-04 as the precondition. Linked from CONTRIBUTING.md. |
| Result | PASS — policy documented. No tag is created in P02; the first release tag is cut under QG-04. |
| CI run / artifact | exact-commit CI, back-filled 2026-10-16 (M0): pr-title failure https://github.com/AyhamJo7/moin/actions/runs/36379477690 |
| Reviewer | pending |

Sensitive material is stored by reference only (PLAN.md evidence rules).

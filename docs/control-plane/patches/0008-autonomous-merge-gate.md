# 0008: autonomous merge gate with a Codex CLI review, narrower A-22 path rule, CI dispatch

**What** (`0008-autonomous-merge-gate.patch`, one commit):

| File | Change |
|---|---|
| `.claude/bin/merge_gate.py` (new) | The only path by which a session merges. In order: the PR is open against `main`; `verify-head --pr N --ci` is VERIFIED for the head SHA; title/body pass A-22; no changed file is a founder path. Only then does it run **Codex CLI** itself (`codex exec --sandbox read-only`) on `gh pr diff`. The final line must be `VERDICT: APPROVE`; anything else refuses. It then re-checks that the head did not move and runs `gh pr ready` + `gh pr merge --squash --match-head-commit <sha>`. `--dry-run` runs the checks without the review or the merge. |
| `.claude/policy/merge-gate.json` (new) | Permanent `founder_paths` (`.claude/`, `.github/`, `lefthook.yml`, `scripts/check-*`, `scripts/policy-regex.ts`, `infrastructure/`, `BLUEPRINT.md`) and trial `founder_paths_trial` (migrations, identity-access, billing, usage-ledger, tool-guard, webhook) until `trial_until` 2026-11-29. |
| `.claude/tests/test_merge_gate.py` (new) | 15 tests: every refusal rule, the verdict parser, the shipped policy, and the CLI against fake `gh`/`verify-head`/`codex`. They cover: the diff reaches the reviewer and the merge is pinned to the head SHA; REQUEST_CHANGES or a missing verdict never merges; failed checks skip the review; a head that moves during the review refuses; an oversized diff errors; a dry run neither reviews nor merges. |
| `.claude/policy/no-ai-mentions.json` | `tool-claude` no longer matches repository paths (`.claude/…`, `CLAUDE.md`, `claude-evidence`); tool names and attribution stay blocked. New block/allow examples, checked by the Python tests and the CI translator (`scripts/policy-regex.ts`). |
| `.claude/hooks/policy_guard.py`, `.claude/settings.json`, `.claude/tests/test_unattended.py` | `gh workflow run` allowed (all workflows are CI; none deploys). Raw `gh pr merge`/`gh pr ready` stay denied: the merge gate calls them as a subprocess. |
| `.claude/README.md` | map row. |

`REQUIRED_DENY` in `control_plane_check.py` is unchanged (`gh pr merge *` stays denied), and
nothing in `kit-manifest.json` is touched. No second GitHub account and no ruleset change are
needed.

**Verified in a scratch clone at `6e0f156`:** `python3 -m unittest discover -s .claude/tests -t .claude/tests`
(96 tests OK), `ruff format --check`, `ruff check`, `mypy --config-file .claude/mypy.ini` (clean),
`control_plane_check.py` (exit 0). Four mutants were killed by the tests: an unpinned merge SHA,
an approval on an older SHA (first version), accepting any verdict, and skipping the head re-check.
**Not yet exercised:** a real `codex exec` call. The first real merge is that test.

## Apply (founder)

```bash
! git am docs/control-plane/patches/0008-autonomous-merge-gate.patch
python3 .claude/bin/control_plane_check.py
python3 -m unittest discover -s .claude/tests -t .claude/tests
```

Then, on a small PR: `python3 .claude/bin/merge_gate.py <n> --dry-run`, followed by the real run.

## Risk

Loosening, approved by the founder on 2026-11-01. What contains it:
- the review runs inside the script on the exact head SHA, so a session cannot claim an approval;
- the merge is pinned to that SHA, and GitHub still enforces the required status checks;
- the agent cannot merge changes to the checks, guards or infrastructure that gate its own
  merges (permanent founder paths).

Residual risks:
- the reviewer and the author run under the same GitHub account, so GitHub itself does not
  enforce a review;
- the diff could try to steer the reviewer. The prompt marks it as untrusted, and the founder
  paths keep the highest-risk files out of reach.

If Codex is rate-limited, the gate exits 2 and nothing merges. Retry later, or the founder merges.

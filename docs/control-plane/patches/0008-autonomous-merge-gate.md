# 0008: autonomous merge gate, narrower A-22 path rule, CI dispatch

**What** (`0008-autonomous-merge-gate.patch`, one commit):

| File | Change |
|---|---|
| `.claude/bin/merge_gate.py` (new) | The only path by which a session merges. Refuses unless: `verify-head --pr N --ci` is VERIFIED for the head SHA; the reviewer identity's latest decisive review is APPROVED **on that SHA**; title/body pass A-22; the PR is open against `main`; no changed file is a founder path. Then `gh pr ready` + `gh pr merge --squash --match-head-commit <sha>`. `--dry-run` checks only. |
| `.claude/policy/merge-gate.json` (new) | `reviewer` (empty = refuses everything), permanent `founder_paths` (`.claude/`, `.github/`, `lefthook.yml`, `scripts/check-*`, `scripts/policy-regex.ts`, `infrastructure/`, `BLUEPRINT.md`), trial `founder_paths_trial` (migrations, identity-access, billing, usage-ledger, tool-guard, webhook) until `trial_until` 2026-11-29. |
| `.claude/tests/test_merge_gate.py` (new) | 14 tests: every refusal rule, the shipped policy, and the CLI against fake `gh`/`verify-head` (merge pinned to the head SHA; refusals and dry runs never merge). |
| `.claude/policy/no-ai-mentions.json` | `tool-claude` no longer matches repository paths (`.claude/…`, `CLAUDE.md`, `claude-evidence`); tool names and attribution stay blocked. New block/allow examples, checked by the Python tests and the CI translator (`scripts/policy-regex.ts`). |
| `.claude/hooks/policy_guard.py`, `.claude/settings.json`, `.claude/tests/test_unattended.py` | `gh workflow run` allowed (all workflows are CI; none deploys). Raw `gh pr merge`/`gh pr ready` stay denied: the merge gate calls them as a subprocess. |
| `.claude/README.md` | map row. |

`REQUIRED_DENY` in `control_plane_check.py` is unchanged (`gh pr merge *` stays denied), and nothing
in `kit-manifest.json` is touched.

**Verified in a scratch clone at `6e0f156`:** `python3 -m unittest discover -s .claude/tests -t .claude/tests`
(95 tests OK), `ruff format --check`, `ruff check`, `mypy --config-file .claude/mypy.ini` (clean),
`control_plane_check.py` (exit 0). Two mutants were killed by the tests: dropping `--match-head-commit`,
and accepting an approval on an older SHA.

## Apply (founder)

1. **Reviewer identity.** Create a GitHub machine user (e.g. `moin-review-bot`), invite it to
   `AyhamJo7/moin` with **Write** (approvals only count from users with write access), and give it a
   fine-grained token scoped to this repository: Pull requests read/write, Contents read, Metadata read.
   Keep the token in your password manager. Export it only in the reviewer pane
   (`export GH_TOKEN=…`), so the reviewer approves with `gh pr review <n> --approve --body "…"` only
   when it has no open HIGH/CRITICAL finding, and requests changes otherwise.
2. **Apply the patch** in a maintenance session (protected files):
   ```bash
   ! git am docs/control-plane/patches/0008-autonomous-merge-gate.patch
   ```
   then set `"reviewer": "<bot login>"` in `.claude/policy/merge-gate.json` and run
   `python3 .claude/bin/control_plane_check.py` and the control-plane tests.
3. **Ruleset** (`main-protection`, id 24193962): require one approval, dismiss stale approvals,
   require approval of the last push, squash only. Status checks are unchanged.
   ```bash
   ! gh api repos/AyhamJo7/moin/rulesets/24193962 > /tmp/rs.json
   ! jq '{name,target,enforcement,conditions,bypass_actors,rules: (.rules | map(if .type == "pull_request" then .parameters += {required_approving_review_count: 1, dismiss_stale_reviews_on_push: true, require_last_push_approval: true, allowed_merge_methods: ["squash"]} else . end))}' /tmp/rs.json > /tmp/rs-new.json
   ! gh api -X PUT repos/AyhamJo7/moin/rulesets/24193962 --input /tmp/rs-new.json
   ```
   After this, every PR needs the reviewer's approval, including founder-merged ones (you are the PR
   author and can't approve your own PR). GitHub now enforces the review independently of the script.
4. **Trial end (2026-11-29).** Leave `trial_until` to let the trial paths auto-merge, or move the date
   to extend the trial.

## Risk

Loosening, approved by the founder on 2026-11-01. What contains it: GitHub enforces the approval and
the checks server-side; the approval must come from a separate identity on the exact SHA; the merge
is pinned to that SHA; and the agent cannot merge changes to the checks, guards or infrastructure
that gate its own merges (permanent founder paths).

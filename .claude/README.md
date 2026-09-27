# .claude/: session control plane

Everything a working session (local or cloud) needs to run PLAN.md phase by phase with the same
guardrails. Cloud sessions see only what is committed here; nothing depends on `~/.claude`.
Background, decisions and live evidence: `docs/control-plane/`.

## Layout

| Path | What | Source |
|---|---|---|
| `settings.json` | permissions (allow / ask / deny), attribution off, bypass mode disabled, hook wiring | moin |
| `hooks/git_guard.py` | blocks git that discards uncommitted work; force-push/delete of `main` | kit (verbatim) |
| `hooks/policy_guard.py` | secrets (INV-15), prod data (INV-16), founder-only infra (QG-05), push forms, hook bypass, AI-tool mentions (A-22), BLUEPRINT read-only, no whole-file PLAN reads | moin |
| `hooks/commit_guard.py` · `ts_edit_check.py` | typecheck of committed / edited TS and Python files (switch on with `tsconfig.json`) | kit (verbatim) |
| `hooks/claim_check.py` | Stop: "done/green/fixed" claims need passing `gates full` evidence for the current tree | kit (verbatim) |
| `hooks/stop_guard.py` · `stopfailure_checkpoint.py` · `session_context.py` · `_kit.py` | loop stall detection, usage-limit checkpoint, session re-orientation | kit (verbatim) |
| `hooks/session_bootstrap.py` | toolchain pin warnings; cloud-only `pnpm install --frozen-lockfile` | moin |
| `hooks/format_on_edit.py` | repo prettier / `terraform fmt` on edited code files (never Markdown) | moin |
| `bin/gates.py` · `mutation_check.py` · `progress_probe.py` | gate runner with evidence, mutation proof of regression tests, progress probe | kit (verbatim) |
| `bin/plan_section.py` | slices PLAN.md by phase anchor, checklist ID, heading or ID row | moin |
| `bin/evidence.py` | creates and audits `EV-Pxx-nnn` records and `docs/evidence/INDEX.md` | moin |
| `bin/control_plane_check.py` | drift/tamper check of this directory (first gate) | moin |
| `gates.json` | gate list; **stub until P02.02.02** (see below) | moin |
| `policy/no-ai-mentions.json` | A-22 patterns + executable examples; shared with P02.01.03's CI check | moin |
| `policy/secret-paths.json` | secret-bearing file names and credential directories | moin |
| `skills/phase`, `verify-evidence`, `gate-ready`, `handoff` | founder-invoked workflow skills | moin |
| `skills/closure` | finding-closure ritual | user skill, patched |
| `agents/security-reviewer`, `architecture-reviewer`, `invariant-reviewer` | read-only reviewers (QG-09, INV bypass hunting) | user agents + moin appendix |
| `rules/*.md` | path-scoped pointers (db, infrastructure, ai, telephony, integrations, web, evidence) | moin |
| `cloud/setup.sh` | cloud environment setup script (founder pastes it; pins Node 24.21.0, pnpm 10.34.5, Terraform 1.16.4, gitleaks 8.30.1) | moin |
| `kit-manifest.json` | sha256 of every copied file (kit and user sources) | moin |
| `tests/` | stdlib `unittest` suite for the moin code (runs identically local and cloud) | moin |
| `ruff.toml` · `mypy.ini` | lint/type config for the Python here | moin |

Hooks are registered with `${CLAUDE_PROJECT_DIR}` paths and without `--skip-headless`, so they also
guard headless and cloud sessions. All guards fail closed on unparseable input. Kit-only hooks keep
their state in `.claude/state/` (gitignored) via `CLAUDE_KIT_STATE`.

## Greenfield behaviour and what P02 switches on

| P02 item | Effect here |
|---|---|
| P02.01.04 creates `PROGRESS.md`, `docs/evidence/INDEX.md` | `evidence.py new/check` start working; `session_context` shows the ledger. `PROGRESS.md` needs the kit front matter (`mission`, `status`, `mode`, `updated`, `next`) above PLAN's chronological log. INDEX header: `\| ID \| Item \| Date \| Commit \| Summary \| Record \|` |
| P02.01.03 PR-title / AI-mention CI check | reuse `policy/no-ai-mentions.json` (patterns and examples) |
| P02.02.01 `.nvmrc`, `packageManager`, P02.02.08 `.terraform-version` | `session_bootstrap` warns on mismatches; `control_plane_check` compares them with `cloud/setup.sh` |
| P02.02.02 Turborepo tasks | replace the `workspace` gate with the QG-01 gates; `gates full` can pass |
| P02.02.x `tsconfig.json`, prettier | `ts_edit_check`, `commit_guard` and `format_on_edit` switch on |
| P02.04.03 `.env*` gitignored | Grep over the repo root no longer trips the secret check |

## `gates.json` stub

`control-plane` (self-check + tests) and `control-plane-lint` (ruff + mypy) pass today. `workspace`
runs `pnpm turbo run lint typecheck test build`, which fails until P02 creates the monorepo. So
`gates full` fails and the Stop hook blocks any "green/done" claim until real gates exist. P02.02.02
splits `workspace` into the QG-01 gates. Never delete or weaken a gate to make `full` pass.

## Maintaining the copied files

The kit (`~/.claude/kit`) and the user agents/skills are the upstream. To update a copy: copy the new
upstream file, re-apply the documented patch (`kit-manifest.json` → `patch`), refresh `base_sha256`
and `sha256`, bump `kit_commit`, run `python3 .claude/bin/control_plane_check.py` and the tests, and
explain the change in the PR. A hash mismatch without that is drift or tampering.

On the founder's machine, the user-level kit hooks run with `--defer-to-repo`: they stand down when
this `settings.json` registers the same hook, so exactly one copy runs locally, the same as in cloud.

## Checks

```bash
python3 .claude/bin/control_plane_check.py
python3 -m unittest discover -s .claude/tests -t .claude/tests
ruff format --check --config .claude/ruff.toml .claude && ruff check --config .claude/ruff.toml .claude
uv run --no-project --with mypy mypy --config-file .claude/mypy.ini
```

# moin: Development Control Plane Plan (Phase A)

| Field | Value |
|---|---|
| Date | 2026-09-27 |
| Status | **APPROVED 2026-09-27** with answers: D-01 PLAN.md in its own `docs/plan-baseline` PR (baseline, not adoption; P00.05 stays open); D-03 `docs/control-plane/`; D-04 narrow pattern that also catches `Claude-Session` trailers, claude.ai session links and `Co-Authored-By` lines in commits and PR text; D-05 bypass disabled; D-07 `--defer-to-repo` with a one-copy test; **D-13 changed: the founder runs the empty-HOME command; no credential file is touched, not even by symlink**; all others as recommended. Implementation: see `PROGRESS.md` and `CONTROL_PLANE_REPORT.md` in this folder. |
| Scope | Session configuration only: `CLAUDE.md`, `.claude/` (settings, hooks, skills, subagents, rules, cloud setup), plus the control-plane docs. **This is not P02.** No `package.json`, CI, Compose, Terraform or application code. |
| Authority | `PLAN.md` wins over `docs/research/claude-code-setup.md` (the "research") wherever they differ. §3 lists every difference. |
| Inputs read | `~/.claude/kit/SETUP_REPORT.md` (all, especially §8); the research (all 493 lines); PLAN.md: Document Status, How to Use, Conventions, Status Ledger, Principles/Invariants, Repository Structure, Testing Rules, Release Strategy, Cross-Phase Quality Gates, P00, P02, A-22, and the tier-scoped dependency table; BLUEPRINT.md headings; the current Claude Code docs (settings, settings-reference, hooks, permissions, permission-modes, memory, skills, sub-agents, cloud-environments, claude-code-on-the-web). Doc pages were fetched on 2026-09-27. |
| Kit baseline | `~/.claude/kit` @ `9f07a8e`, working tree clean |

> **Location (D-03, approved):** moved from `docs/claude/` to `docs/control-plane/`.

---

## 1. Environment facts (run 2026-09-27)

| Check | Result | Meaning |
|---|---|---|
| `git status` | `main`, up to date with `origin/main`; untracked: `PLAN.md`, `docs/` (only `docs/research/claude-code-setup.md`), plus an ignored `.ruff_cache/` | **`BLUEPRINT.md` is already tracked** (commit `fb7185e init`). PLAN.md and the research are not. |
| `git log` | one commit, `fb7185e init` | Greenfield |
| remote | `https://github.com/AyhamJo7/moin.git` (private); `gh` is logged in as AyhamJo7 | — |
| `node -v` | **v22.20.0** (via **nvm**, `~/.nvm/versions/node/v22.20.0`) | PLAN pins Node 24 LTS. Current v24 is **24.21.0** (Krypton). |
| `pnpm -v` | 10.12.1 | Satisfies pnpm 10. The latest 10.x is **10.34.5**. The pnpm `latest` tag is now 12.x, so **pin 10.x explicitly**. |
| `docker compose version` | v5.5.1 | OK |
| `terraform -version` | **not installed** | Gap. The current release is **1.16.4**. |
| `jq --version` | jq-1.7 | OK |
| `gitleaks version` | 8.30.1 (latest) | OK |
| `claude --version` | **2.1.283** | Every version-gated feature used below is available (§6) |
| `python3` | 3.12.3; `uv` and `ruff` in `~/.local/bin` | The kit hooks need Python ≥ 3.10 and the stdlib only. The cloud image has Python 3 + pytest/mypy/ruff/uv. |

---

## 2. Component table

**Source column:** **kit** = copied byte-for-byte from `~/.claude/kit` (hash recorded in `.claude/kit-manifest.json`). **kit\*** = copied, then a small documented patch. **user** = copied from `~/.claude/agents|skills` with a moin appendix added. **research** = idea from the research, re-specified here. **new** = written for moin.

**Verify column:** these are the live Phase C tests. **T-xx** IDs refer to §10.

| # | Component | Source | Path | Enforces | Verified live by |
|---|---|---|---|---|---|
| 1 | Project instructions | research (rewritten) | `CLAUDE.md` | Orientation for How-to-Use, Conventions, Evidence rules, INV index, A-22, Release branching. No enforcement (CLAUDE.md is advisory per the docs). | T-20: a fresh headless session answers "which files do you read for P03?" with the extractor commands, and never Reads PLAN.md whole |
| 2 | Shared settings | research + new | `.claude/settings.json` | Permission layer (§5); `attribution` object; `disableBypassPermissionsMode`; hook wiring | T-01…T-06 (deny/ask behavior), T-19 (loads under an empty HOME) |
| 3 | git guard | **kit** | `.claude/hooks/git_guard.py` | Blocks git that would discard uncommitted work, and force-push/delete of `main`. Supports Release Strategy (protected trunk) and Testing Rules ("never revert a fix") | T-03 (`echo x > f; git clean -fd` blocked), T-04 (`git reset --hard` with a dirty tree blocked), T-13 (`git checkout -b` passes) |
| 4 | Policy guard | **new** | `.claude/hooks/policy_guard.py` + `.claude/policy/*.json` | **INV-15** (secret files, `git add` of secrets); **INV-16** (remote `psql`/`pg_dump`, prod AWS profiles); **A-22 / P02.01.03** (AI-tool mentions in commit/tag/PR text, including GitHub MCP tools); **QG-05** (no `terraform apply/destroy/import/state/force-unlock/taint`, no `-auto-approve`); Release Strategy (no push to `main`; non-canonical push forms like `git -C . push`, `git -c … push` and `/usr/bin/git push` are blocked so the `ask` rule can't be sidestepped); no `--no-verify` / `HUSKY=0` / `LEFTHOOK=0`; no `stripe`/`twilio` CLIs; Read of PLAN.md/BLUEPRINT.md without `limit` ≤ 400 is blocked (context protection) | T-01 (dummy `.env` via Read, `cat`, `python -c`), T-02 (`git -C . push`), T-05 (`git add -A && git commit` with an untracked `.env` blocked; with an AI mention blocked), T-06 (AI in `-m`, heredoc, `-F`, `gh pr create --body`), T-07 (`terraform apply`, `terraform destroy -auto-approve`), T-08 (remote psql), T-13/T-14 (safe forms pass) |
| 5 | Claim check | **kit** | `.claude/hooks/claim_check.py` | Evidence rules + Principle 12: completion claims need passing `gates full` evidence for the current tree | T-09 ("All gates are green" with no results → Stop blocked, then restated as UNVERIFIED/BLOCKED), T-10 (after `gates full` FAIL → still blocked) |
| 6 | Gates runner + config | **kit** + new config | `.claude/bin/gates.py`, `.claude/gates.json` | Local QG-01 equivalent; evidence stored in `.git/claude-evidence/`. The config is a **fail-closed stub** (§7). | T-11 (`gates fast` PASS on the control plane; `gates full` FAIL on the `workspace` gate pre-P02, with the P02 hint) |
| 7 | Mutation check | **kit** | `.claude/bin/mutation_check.py` | Testing Rules: "every bug fix adds a regression test". The test must be KILLED without the fix. | T-21: a planted fix + test on a throwaway branch → KILLED |
| 8 | Progress probe | **kit** | `.claude/bin/progress_probe.py` | Used by claim_check's progress branch and by long cloud runs | Covered by kit pytest. Live: UNVERIFIED unless a background task exists during Phase C. |
| 9 | Commit guard | **kit** | `.claude/hooks/commit_guard.py` (+ `_kit.py`) | QG-01 typecheck of the files being committed; ledger reminder. **Switches on** when a `tsconfig.json` appears. | T-12: greenfield commit → silent; fixture repo with a TS error → blocked |
| 10 | TS edit check | **kit** | `.claude/hooks/ts_edit_check.py` | Per-edit incremental `tsc`, errors in the edited file only. Switches on with `tsconfig.json`. | T-12 (fixture); greenfield silent |
| 11 | Stop guard | **kit** | `.claude/hooks/stop_guard.py` | Stall detection for `/loop` and autonomous runs (CLAUDE.md "same failure twice → BLOCKER") | Payload test only. **Live UNVERIFIED** (the kit report says the same). |
| 12 | StopFailure checkpoint | **kit** | `.claude/hooks/stopfailure_checkpoint.py` | Continuity after a usage-limit cutoff | Payload test only. **Live UNVERIFIED** (a real rate limit can't be induced). |
| 13 | Session context | **kit** | `.claude/hooks/session_context.py` | Re-injects the ledger, checkpoint and gate status at start/resume/compact | T-15: greenfield → prints nothing except the orphan warning when orphans exist; fixture with a PROGRESS.md → ledger shown |
| 14 | Session bootstrap | **new** | `.claude/hooks/session_bootstrap.py` | ADR-0002 / P02.02.01 pins: one warning line if `node`/`pnpm`/`terraform` differ from `.nvmrc` / `packageManager` / `.terraform-version`. In cloud only, once `pnpm-lock.yaml` exists, runs `pnpm install --frozen-lockfile`. **Silent on greenfield** (no pin files). | T-15 (silent), T-16 (fixture with `.nvmrc`=24.21.0 under Node 22 → one warning line) |
| 15 | Format on edit | research (re-spec) | `.claude/hooks/format_on_edit.py` | QG-01 format: `prettier --write` when `node_modules/.bin/prettier` exists; `terraform fmt` for `.tf` when terraform exists. Otherwise a silent no-op. | T-15 (silent); switch-on is **UNVERIFIED** until P02 installs prettier |
| 16 | Plan section extractor | **new** | `.claude/bin/plan_section.py` | How-to-Use rule: agents read only Conventions, the Status Ledger, Invariants, the target phase and the referenced IDs. Slices PLAN.md by `<a id="pNN--…">` anchors and `##` headings; `--id EXT-24` prints the defining row. | T-17: `P02`, `P02.04`, `--ledger`, `--invariants`, `--id QG-09` return the exact sections (golden-file unit tests too) |
| 17 | Evidence tool | **new** | `.claude/bin/evidence.py` | Evidence rules: `new` writes `docs/evidence/<phase>/EV-Pxx-nnn-<slug>.md` (date, SHA, environment, command, result, CI link, reviewer) from gate evidence and appends to `docs/evidence/INDEX.md`; `check` validates ID uniqueness, that SHAs are reachable, and that ticked items carry existing EV IDs. Pre-P02.01.04 it prints "registry not initialised (P02.01.04)" and exits 0. | T-18 (fixture registry with one stale SHA → STALE) |
| 18 | Control-plane self-check | **new** | `.claude/bin/control_plane_check.py` | Drift and tamper checks: kit-manifest hashes; hook paths exist and are executable; `CLAUDE.md` < 200 lines with no `@PLAN.md`/`@BLUEPRINT.md` import; the INV IDs in CLAUDE.md equal PLAN's INV table; every skill has `disable-model-invocation: true`; reviewers are read-only; cloud-script pins equal `.nvmrc`/`packageManager`/`.terraform-version` **once those exist** | T-11 (this is the `control-plane` gate) |
| 19 | Hook/tool tests | **new** | `.claude/tests/` (stdlib `unittest`, so it runs identically local and cloud) | New code ships with tests. The real hook scripts run on realistic event JSON (the kit's payload method). | T-11 |
| 20 | `/phase` | research (re-spec) | `.claude/skills/phase/` | Session scoping by phase and tier; checks tier-scoped dependencies against the Status Ledger; writes the phase plan (item → EV ID → verification command; EXT/DG list; implementation vs verification items). **Stops for approval.** | T-22: dry run `/phase P02` on a throwaway branch → `docs/phases/P02-plan.md` produced; `/phase P06` → refused with the unmet dependency named (P02, P03) |
| 21 | `/verify-evidence` | research (re-spec) | `.claude/skills/verify-evidence/` | Evidence rules; "no fake completion" list | T-22: fixture → report with VERIFIED/STALE/MISSING rows |
| 22 | `/gate-ready` | research (re-spec) | `.claude/skills/gate-ready/` | QG-01 (gates full), QG-09 (reviewers), QG-10 (docs), tier completeness. Writes a gate-review EV record. Proposes (never applies) `READY_FOR_REVIEW` in the Status Ledger. | T-22: fixture → gate report plus both reviewer outputs |
| 23 | `/handoff` | research (re-spec) | `.claude/skills/handoff/` | Continuity: ledger entry, checkpoint, commit, resume prompt | T-22: dry run → ledger row and resume prompt |
| 24 | `/closure` | **kit\*** (from `~/.claude/skills/closure`) | `.claude/skills/closure/` | Finding-closure ritual (mutation-check, stress, red team). **Patch:** step 0 resolves `.claude/bin` only; appends to an existing `PROGRESS.md` instead of creating a kit-format one. | T-22 (its step-0 preflight lists the repo tools as present) |
| 25 | invariant-reviewer | **kit** (user agent) + appendix | `.claude/agents/invariant-reviewer.md` | INV-01…INV-20 bypass hunting (entry point × invariant matrix) | T-23: throwaway branch plants a route that trusts `x-org-id` (INV-02) → BYPASS FOUND |
| 26 | security-reviewer | user + appendix | `.claude/agents/security-reviewer.md` | **QG-09** first reviewer; INV-01/02/12/15/16 | T-23: the planted string-built SQL and hardcoded secret-like token → findings |
| 27 | architecture-reviewer | user + appendix | `.claude/agents/architecture-reviewer.md` | **QG-09** second reviewer; Domain Boundaries, Repository Structure, INV-17/18 | T-23: planted domain→infrastructure import and a tenant-name conditional (INV-18) → findings |
| 28 | Path-scoped rules | research (re-pathed) | `.claude/rules/{db,infrastructure,ai,telephony,integrations,web,evidence}.md` | Pointers, not copies: each names the PLAN anchors and INV/QG IDs for its area (e.g. `packages/db/**` → INV-01, QG-08, "real PG for RLS") | T-24: Read of a fixture `packages/db/x.sql` → `InstructionsLoaded` shows `db.md`. **Partly UNVERIFIED:** the docs say rules trigger on *reads*, so a Write of a new file may not load them. |
| 29 | Cloud setup script | research (rewritten) | `.claude/cloud/setup.sh` (for you to paste) | ADR-0002 pins in cloud; jq/gitleaks present | T-25: `bash -n` + shellcheck (if present) + dry run in a local Ubuntu 24.04 container (`docker run ubuntu:24.04`). **A real cloud run is UNVERIFIED** until you create the environment (F-04). |
| 30 | State ignore | new | `.claude/.gitignore` (`state/`, `settings.local.json`) | Keeps the kit-hook state (`CLAUDE_KIT_STATE`) out of Git without touching the root `.gitignore` (which is P02.04.03's) | T-11 |
| 31 | Control-plane docs | new | `docs/control-plane/{PROGRESS.md, CONTROL_PLANE_REPORT.md, evidence/, research/}` | This work's ledger and its evidence (not PLAN's `docs/evidence`, which P02 creates) | — |

**Not ported, and why:**

- **MCP servers** (Terraform registry, library docs): deferred to P05, when Terraform starts. They'd need a `.mcp.json` that is safe for cloud sessions, and no phase before P05 needs one.
- **The `claude-code-action` PR review workflow**: this is a CI workflow, so it belongs to P02.06 or later, and it's your decision (D-12).
- **Git `commit-msg` hook, commitlint, pre-commit gitleaks**: these need `package.json`/lefthook, so they belong to P02.01.03 and P02.06.02. The Claude-level guard covers agent commits until then, and CI covers everyone afterwards.

---

## 3. Research vs PLAN.md: conflict list and resolutions

Research line numbers are given as `R:nn`.

| # | Research says | PLAN.md says | Resolution |
|---|---|---|---|
| C-01 | "P00–P01 are complete per PROGRESS.md" (R:412); ledger "with P00–P01 marked done" (R:458) | P00 is `READY_FOR_REVIEW`, awaiting founder adoption (P00.05). P01 is `NOT_STARTED` founder discovery (EXT-16), running in parallel with P02–P05. | CLAUDE.md and `/phase` read status only from the Status Ledger (`plan_section.py --ledger`). P01 is marked founder-owned: agents may draft `docs/pilot/*` templates only when asked, and never tick P01 items. The P02 prompt states the true status. |
| C-02 | "BLUEPRINT.md = architecture/invariants" (R:45) | INV-01…INV-20 live in PLAN.md. BLUEPRINT is product intent and read-only. | CLAUDE.md lists the INV IDs with 3–6-word titles, and the full text comes from `plan_section.py --invariants`. A self-check keeps the ID list equal to PLAN's table. BLUEPRINT is read only through the BR-nnn line references in PLAN's traceability matrix. |
| C-03 | The research's "Invariants" list: Stripe via REST/no SDK, the regions, "never touch real accounts" (R:56-62) | Stripe-via-REST is workspace prior art (PLAN §Workspace prior art), **not** an INV. Regions are architecture/ADRs. | CLAUDE.md uses PLAN's INV list only. Region and provider rules go into the path-scoped rules as pointers to ADR-0010/0012/0021. |
| C-04 | `phase/pNN-<slug>` branch per phase (R:72) | Trunk-based `main`, short-lived branches, **squash-merged** PRs with Conventional Commit titles | Branches are `<type>/pNN-<nn>-<slug>` (e.g. `feat/p02-03-skeleton`), one per checklist section or smaller, squash-merged by you. The `/phase` plan lists the PR sequence. |
| C-05 | `infra/docker/compose.dev.yml`, `infra/**` (R:68, R:106, R:473) | `infrastructure/terraform/{bootstrap,modules,envs}`. Compose location isn't fixed (P02.04.01). | Rules use `infrastructure/**`. The permission rule is path-agnostic: `Bash(docker compose *)`. P02 chooses the Compose path. |
| C-06 | `.node-version` (R:65, R:371) | `.nvmrc` + `engines` + `packageManager: pnpm@10.x` (P02.02.01) | `.nvmrc`. Locally **nvm is already installed** and reads `.nvmrc` natively, so use nvm rather than adding fnm (PLAN says "fnm/corepack", and nvm meets the same no-sudo intent; P02 notes the choice). |
| C-07 | Rename `.env.example` → `env.example`, because `**/.env.*` would block it (R:180) | `.env.example` with fake values; `.env*` gitignored except the example (P02.04.03) | Keep `.env.example`. The deny list uses a gitignore **negation carve-out in the same file**, `Read(.env.*)` followed by `Read(!.env.example)`. The current permissions docs confirm this is valid for deny rules from one source. policy_guard applies the same exception by exact basename. Tested in T-01 (`.env` blocked, `.env.local` blocked, `.env.example` readable). |
| C-08 | Ledger = PROGRESS.md with "evidence ID + command + exit code" rows; "Blocked on founder" section (R:52-53) | Status Ledger is updated **first**, then the phase header. Items are ticked only with `EV-Pxx-nnn`. EV records live in `docs/evidence/<phase>/EV-Pxx-nnn-<slug>.md` with fixed fields, registered in `docs/evidence/INDEX.md`. Implementation and verification are separate items. Sensitive evidence is stored by reference only. `PROGRESS.md` is the chronological work log, created in P02.01.04. | `evidence.py` produces PLAN-format EV records. `/phase` plans map every item to an EV ID and verification. The order is Status Ledger → phase header → PROGRESS.md row. Kit gate evidence (`.git/claude-evidence`, machine-local and lost when a cloud VM is reclaimed) is the **input** to an EV record, never a substitute for it. |
| C-09 | "Blocked on founder" / `BLOCKED-EXT` / "GATE READY" / "PASSED" (R:53, R:436, R:442) | Status model: `BLOCKED` (internal, with owner) vs `WAITING_FOR_EXTERNAL` (with counterparty, request date, expected date, fallback), then `READY_FOR_REVIEW` / `VERIFIED` / `COMPLETE` | PLAN vocabulary for status. The kit words VERIFIED / UNVERIFIED / BLOCKED are kept only for **claims in chat** (as in the global rules). Agents can raise a tier to at most `READY_FOR_REVIEW`; `VERIFIED`/`COMPLETE` at phase-tier level need your instruction (D-09). |
| C-10 | "One phase at a time; never start N+1 until N's gate PASSED" (R:50) | Dependencies are **tier-scoped** (`P08@PILOT`); P01–P05 run in parallel (P03 needs P02.03; P05 needs P02 + EXT-09) | See §9 (parallel-session protocol). `/phase` refuses a phase whose tier-scoped hard dependencies aren't VERIFIED in the Status Ledger. |
| C-11 | Phase plans at `docs/phases/PNN-plan.md`; gate report `docs/phases/PNN-gate.md` (R:52, R:213) | The Documentation Map has no `docs/phases/`. The gate outcome is evidence. | Plans at `docs/phases/Pxx-plan.md` (D-06: a repo-structure addition you record in the PLAN change log). Gate reports become **EV records** (`EV-Pxx-nnn-gate-review.md`), not a separate file. |
| C-12 | Attribution object `{commit:"", pr:""}` (R:92) | A-22: no AI mentions | Add **`"sessionUrl": false`**. The docs say cloud sessions otherwise append a `Claude-Session` trailer and a claude.ai link to commits and PR bodies, which would violate A-22. The boolean `attribution: false` is documented but needs ≥ 2.1.281 ("earlier versions reject it and skip the whole settings file"). Local is 2.1.283, but the cloud CLI version is unknown, so use the **object form**. |
| C-13 | No-AI regex `(?i)claude\|anthropic\|\bAI\b\|co-authored-by` (R:190) | P02.01.03 rejects **"AI-tool mentions"**. KlarDesk is an AI product: `feat(ai): …`, "AI disclosure (INV-03)" and `packages/ai` are legitimate. | Block AI-**tool/attribution** mentions: `claude`, `anthropic`, `claude.ai`, `Claude-Session`, `Co-Authored-By` naming a model, `🤖`, "generated with/by", `chatgpt`, `copilot`, `codex`, `cursor`, `gemini`, model-family names (`opus`/`sonnet`/`haiku`/`fable` + version), "AI-generated/-assisted/-written". Allow the domain term "AI" and the provider name "OpenAI". One pattern file, `.claude/policy/no-ai-mentions.json`, which P02.01.03's CI check should reuse. **Your call: D-04.** |
| C-14 | Deny `Bash(rm -rf *)`, `Bash(git reset --hard *)`, `Bash(git push origin main *)` (R:152-161) | — (policy) | The docs show these rules are easy to sidestep (`/bin/rm`, `git push origin HEAD:main`, `git -C . push`) and over-block legitimate work (`rm -rf dist`, a reset on a clean tree). Use kit git_guard (blocks only when work is lost) + policy_guard (any push form that targets `main`). `rm -rf` goes to **ask**. Built-in critical-path protection still applies. |
| C-15 | SessionStart hook: `docker compose up` + `pnpm install` in cloud (R:196) | P02.04.02 defines `pnpm dev:up`; the cloud cache doesn't keep processes | session_bootstrap only installs dependencies (cloud, lockfile present). Services start on demand via P02's `pnpm dev:up`. Greenfield: no-op. |
| C-16 | `format.sh` runs `pnpm exec prettier/eslint --fix` per edit (R:193) | QG-01 runs lint in the gates; ESLint config arrives in P02.02.04 | Per-edit **prettier only** (fast, deterministic). ESLint `--fix` per edit rewrites code mid-refactor; lint stays in gates/commit. No-op until prettier is installed. |
| C-17 | Git `commit-msg` hook + commitlint + pre-commit gitleaks, "before kickoff" (R:201, R:464) | P02.01.03 (PR-title check + AI check in CI), P02.06.02 (gitleaks in CI) | Deferred to P02 (needs `package.json`). The control plane covers agent commits now; P02 covers humans and CI. |
| C-18 | Reviewers check "BLUEPRINT.md module boundaries … ADR consistency" (R:232) | Boundaries are in PLAN §Domain Boundaries + dependency-cruiser (P02.02.07); ADRs in `docs/adr/` | The reviewer appendices point at PLAN anchors and INV/QG IDs, not BLUEPRINT. |
| C-19 | Rules paths `infra/**`, `packages/db/**`, `apps/web/**` only (R:29, R:473) | The Repository Structure has more sensitive areas: `packages/{ai,telephony,integrations}`, `templates/`, `evals/` | Seven rules files (row 28 in §2), all pointing at PLAN anchors. |
| C-20 | Reviewers `model: opus` (R:225) | — | They inherit the session model (your default is Opus 5.5). Pinning gives no gain and could go stale. D-11. |
| C-21 | Kickoff runs in `--permission-mode plan`, P02-only, writes `docs/phases/P02-plan.md`, "record the evidence ID in PROGRESS.md", branch `phase/p02-…`, "update PROGRESS.md with GATE READY" (R:409-447) | See C-04, C-08, C-09, C-11 | Rewritten in the final report (Phase C deliverable), against what was actually built. |
| C-22 | "BLUEPRINT.md sections P02 references" (R:415) | Agents read only Conventions, the Status Ledger, Invariants, the target phase, and the referenced ADR/gate/FS IDs | CLAUDE.md follows PLAN's list. BLUEPRINT is read only by line range from a BR row. |
| C-23 | Research is silent on multi-repo cloud sessions | The docs say a session with **several repositories** starts above the clones and does **not** read `.claude/settings.json` hooks or permissions | The CLAUDE.md cloud rule and founder action F-04: always start moin cloud sessions with **only** the moin repository attached. |
| C-24 | Research is silent on bypass mode | The docs say "allow rules have no effect in bypassPermissions" and that it disables prompts, so **`ask` rules vanish**, while deny rules and hooks still apply. `.claude/` writes are protected paths **except** in bypass. | `permissions.disableBypassPermissionsMode: "disable"` in the repo (D-05). Everything that must hold even in bypass is a **deny rule or a hook**, never only an `ask`. |
| C-25 | "Hooks depend on jq" (R:200) | — | The hooks are stdlib Python (the kit's choice): no jq dependency, and the same code runs local and cloud. jq is still installed for humans and scripts. |
| C-26 | `Read(~/.aws/**)` deny | Global CLAUDE.md: `~/.aws` and `~/.azure` are **symlinks into Windows** | Also deny `Read(//mnt/c/Users/*/.aws/**)` and `//mnt/c/Users/*/.azure/**`. policy_guard resolves symlinks before matching. |
| C-27 | Terraform install via tfenv (R:377) or zip | P02.02.08: tfenv **or** a pinned binary | A pinned binary: a zip from `releases.hashicorp.com` + SHA256SUMS check, used both locally and in the cloud (the same mechanism in both places). `registry.terraform.io` must be added to the cloud allowlist (**confirmed absent** from the Trusted list). |
| C-28 | Evidence of the kit's work | PLAN evidence lives in `docs/evidence/` from P02 | This setup's evidence lives in `docs/control-plane/evidence/`. P02.01.04 may register it as `EV-P00-00x` if you want (the P00.06.02 wording allows it). |

---

## 4. CLAUDE.md outline (target ≈ 150 lines, hard limit < 200; no `@` imports of PLAN.md or BLUEPRINT.md)

1. **What this is** (4 lines): KlarDesk, codename `moin`, greenfield. PLAN.md is authoritative; BLUEPRINT.md is read-only product intent. Never edit BLUEPRINT.md (deny rule).
2. **Reading protocol** (12 lines). PLAN.md is 6,250 lines (~500 KB); never Read it whole (the hook blocks a Read without `limit` ≤ 400). The on-demand commands:
   - `python3 .claude/bin/plan_section.py --ledger`, which prints the Status Ledger.
   - `--conventions`, `--invariants`.
   - `P02`, which slices from `<a id="p02--…">` to the next phase anchor.
   - `P02.04`, which returns one checklist section.
   - `--id ADR-0003|EXT-24|QG-09|FS-12|A-22|BR-048`, which prints the defining row. A BR row gives the BLUEPRINT line range, which is then read with `Read offset/limit`.
   - Fallback when the script is unavailable: `grep -n '<a id="p02--' PLAN.md`, then a Read with offset/limit.
3. **Session start** (8 lines): name one phase via `/phase Pxx [tier]` → check the ledger + PROGRESS.md (from P02.01.04) → check tier dependencies → read only that phase + its referenced IDs.
4. **Status and evidence** (18 lines): the PLAN status model, verbatim names. The Status Ledger first, then the phase header, then a PROGRESS.md row. Tick only with an `EV-` ID. Implementation and verification are separate items. The "no fake completion" list is referenced by anchor. EV records via `evidence.py`; sensitive evidence by reference only. Agents set tiers to at most `READY_FOR_REVIEW`.
5. **Claims** (8 lines): VERIFIED needs command + exit code + SHA; otherwise UNVERIFIED/BLOCKED. `gates full` evidence before any "done". Fixes need `mutation_check` KILLED. After green: "ready for review", never "complete". The Stop hook enforces this.
6. **Invariants index** (22 lines): INV-01…INV-20, ID + short title only (drift-checked).
7. **Stop conditions** (10 lines): an EXT/DG item → record `WAITING_FOR_EXTERNAL` with the four fields and continue with independent items. A PLAN/BLUEPRINT conflict or ambiguity → ask. Anything that weakens an INV or loosens a gate → stop (loosening needs founder approval). The same failure twice → BLOCKER entry and end the loop. Never simulate or stub an external gate as done.
8. **Git and PRs** (12 lines): `<type>/pNN-<nn>-<slug>` branches, Conventional Commits, squash-merge by the founder. Never push or merge `main`. Push and `gh pr create` ask for approval. No AI-tool mentions (A-22), enforced by hook. PR body fields from P02.01.02 (what/why, risk, tests, EV IDs, docs, migration/rollback, privacy impact).
9. **Commands** (14 lines): a "greenfield until P02.02" note; the `gates` / `mutation_check` / `progress_probe` / `evidence` invocations. P02 appends the pnpm/turbo/docker commands here as part of P02.07.01.
10. **Reviews** (6 lines): QG-09 trigger list → `/gate-ready` runs security-reviewer + architecture-reviewer, plus invariant-reviewer when control paths change (auth, RLS/roles, tool guard, idempotency, billing ledger, state machines).
11. **Parallel phases and sessions** (10 lines): §9 in short form.
12. **Local vs cloud** (10 lines): single-repo cloud sessions only; push before `--cloud`; no credentials in cloud; what stays founder-only (the Founder-actions pointer).
13. **Control plane** (6 lines): file map pointer (`.claude/README.md`); changes to `.claude/` go through a PR you review; `control_plane_check.py` must pass.

---

## 5. Permission design (`.claude/settings.json`)

Precedence facts, verified in the current docs:

- Rules are evaluated deny → ask → allow. The first match wins, and an allow can't carve out a deny.
- Deny/ask apply if **any** subcommand of a compound command matches.
- Bash rules don't match alternate forms (`git -C . push`, `/usr/bin/curl`, `sh -c`).
- Read/Edit denies cover `cat/head/tail/sed/tee` and redirection targets, but not arbitrary interpreters.
- Project `allow` rules and most `env` values wait for **workspace trust**; `deny` and `ask` apply immediately.
- Lists merge across user and project scope. Your user `allow` of `Bash(git *)` and `Bash(gh *)` therefore still applies locally, but the project `ask`/`deny` entries win over it.

### 5.1 Top level

```json
{
  "$schema": "https://json.schemastore.org/claude-code-settings.json",
  "attribution": { "commit": "", "pr": "", "sessionUrl": false },
  "permissions": {
    "defaultMode": "default",
    "disableBypassPermissionsMode": "disable",
    "allow": [ … 5.2 … ], "ask": [ … 5.3 … ], "deny": [ … 5.4 … ]
  },
  "hooks": { … 5.5 … }
}
```

### 5.2 Allow (repo-scoped, read-mostly, or local-only effects)

- **Read tools:** `Read`, `Grep`, `Glob` (path denies still win).
- **Control-plane tools:**
  - `Bash(python3 .claude/bin/plan_section.py *)`
  - `Bash(python3 .claude/bin/gates.py *)`
  - `Bash(python3 .claude/bin/mutation_check.py *)`
  - `Bash(python3 .claude/bin/progress_probe.py *)`
  - `Bash(python3 .claude/bin/evidence.py *)`
  - `Bash(python3 .claude/bin/control_plane_check.py *)`
  - `Bash(python3 -m unittest *)`
- **git:**
  - `Bash(git status *)`, `Bash(git diff *)`, `Bash(git log *)`, `Bash(git show *)`
  - `Bash(git add *)`, `Bash(git commit *)`
  - `Bash(git switch *)`, `Bash(git checkout -b *)`, `Bash(git branch *)`
  - `Bash(git stash push *)`, `Bash(git fetch *)`, `Bash(git rev-parse *)`
- **gh (read-only):** `Bash(gh pr view *)`, `Bash(gh pr diff *)`, `Bash(gh pr checks *)`, `Bash(gh run list *)`, `Bash(gh run view *)`, `Bash(gh run watch *)`
- **Switch on with P02** (harmless before then):
  - `Bash(pnpm install --frozen-lockfile)`
  - `Bash(pnpm turbo *)`, `Bash(pnpm run *)`, `Bash(pnpm exec vitest *)`, `Bash(pnpm exec playwright test *)`
  - `Bash(pnpm dev:*)`, `Bash(pnpm db:*)`, `Bash(pnpm doctor)`
  - `Bash(docker compose *)`
  - `Bash(terraform fmt *)`, `Bash(terraform validate *)`, `Bash(terraform init -backend=false *)`
  - `Bash(tflint *)`, `Bash(gitleaks *)`, `Bash(jq *)`

### 5.3 Ask (outward-facing, or grows the attack surface)

- **git:** `Bash(git push *)`, `Bash(git config *)`, `Bash(git rebase *)`, `Bash(git merge *)`, `Bash(git tag *)`
- **gh:** `Bash(gh pr create *)`, `Bash(gh pr edit *)`, `Bash(gh pr comment *)`, `Bash(gh issue *)`, `Bash(gh api *)`, `Bash(gh workflow *)`
- **Dependencies:** `Bash(pnpm add *)`, `Bash(pnpm remove *)`, `Bash(pnpm update *)`, `Bash(pnpm dlx *)`, `Bash(npx *)`. QG-11 applies: licence and install-script review.
- **Network:** `Bash(curl *)`, `Bash(wget *)`
- **Containers and infra:** `Bash(docker run *)`, `Bash(docker exec *)`, `Bash(terraform plan *)`, `Bash(terraform init *)`
- **AWS:** `Bash(aws *)`. You approve each call; profiles are handed over explicitly and never exported.
- **Files:** `Bash(rm -rf *)`, `Edit(/PLAN.md)` (D-10: Status Ledger/tick edits get your eye), `Write(/.github/**)`

### 5.4 Deny (must hold in every mode, including bypass)

- **Secret-bearing files** (Read and Edit/Write):
  - `Read(.env)`, `Read(.env.*)`, `Read(!.env.example)`, and the same trio for `Edit` and `Write`
  - `Read(**/*.tfvars)`, `Read(**/*.tfstate)`, `Read(**/*.tfstate.*)`, `Read(**/*.pem)`, `Read(**/*.key)`, `Read(**/*.p12)`, `Read(**/id_rsa*)`, `Read(**/id_ed25519*)`
- **Credential stores:**
  - `Read(~/.aws/**)`, `Read(~/.azure/**)`, `Read(//mnt/c/Users/*/.aws/**)`, `Read(//mnt/c/Users/*/.azure/**)`
  - `Read(~/.ssh/**)`, `Read(~/.config/gh/**)`, `Read(~/.docker/config.json)`, `Read(~/.claude/.credentials.json)`, `Read(~/.npmrc)`
- **Read-only spec:** `Edit(/BLUEPRINT.md)`, `Write(/BLUEPRINT.md)`
- **Terraform:** `Bash(terraform apply *)`, `Bash(terraform destroy *)`, `Bash(terraform import *)`, `Bash(terraform state *)`, `Bash(terraform force-unlock *)`, `Bash(terraform taint *)`, `Bash(terraform workspace delete *)`
- **AWS:** `Bash(aws configure *)`, `Bash(aws sso *)`, `Bash(aws secretsmanager get-secret-value *)`, `Bash(aws iam create-access-key *)`, `Bash(aws * delete-*)`, `Bash(aws * terminate-*)`
- **git:** `Bash(git push --force *)`, `Bash(git push -f *)`, `Bash(git commit --no-verify *)`, `Bash(git commit -n *)`
- **gh:** `Bash(gh pr merge *)`, `Bash(gh secret *)`, `Bash(gh repo delete *)`, `Bash(gh repo edit *)`, `Bash(gh ruleset *)`, `Bash(gh auth *)`
- **Provider CLIs:** `Bash(stripe *)`, `Bash(twilio *)`

These deny rules are the **first** layer. policy_guard re-checks every one of them against the forms the docs say rules miss (`git -C`, `-c`, absolute binary paths, `sh -c '…'`, `$(…)`, heredocs), and fails closed on an unparseable command.

### 5.5 Hook wiring

All hooks use exec form, `${CLAUDE_PROJECT_DIR}` paths, **no `--skip-headless`**, and fail closed.

| Event | Matcher / `if` | Hooks (timeout) |
|---|---|---|
| SessionStart | — | `session_context.py` (10 s), `session_bootstrap.py` (300 s; the cloud install path only) |
| PreToolUse | `Bash`, `if: Bash(git *)` | `git_guard.py` (20 s), `commit_guard.py` (60 s) |
| PreToolUse | `Bash` | `policy_guard.py` (10 s) |
| PreToolUse | `Read\|Edit\|Write\|MultiEdit\|NotebookEdit\|Grep\|Glob` | `policy_guard.py` (5 s) |
| PreToolUse | `mcp__.*` | `policy_guard.py` (5 s): no-AI check on `title/body/message/commit_message` fields (GitHub MCP / built-in cloud GitHub tools) |
| PostToolUse | `Edit\|Write\|MultiEdit` | `ts_edit_check.py` (10 s), `format_on_edit.py` (20 s) |
| Stop | — | `claim_check.py` (60 s), `stop_guard.py` (30 s) |
| StopFailure | — | `stopfailure_checkpoint.py` (10 s) |

The kit-only hooks (`_kit.py` users) get `CLAUDE_KIT_STATE=${CLAUDE_PROJECT_DIR}/.claude/state` through exec form (`"command": "env"`, `"args": ["CLAUDE_KIT_STATE=${CLAUDE_PROJECT_DIR}/.claude/state", "${CLAUDE_PROJECT_DIR}/.claude/hooks/x.py", "--log", …]`). No kit code change is needed, and it doesn't depend on `env` settings, which wait for trust.

**Local duplication:** your user settings already run the kit copies of git_guard, claim_check, commit_guard and the others. The docs dedupe only *identical* handlers, and the paths differ, so locally both copies would run: double blocks and double SessionStart output. See D-07.

---

## 6. Version-dependent claims, checked on 2.1.283 against the current docs

| Claim | Docs say | Used as |
|---|---|---|
| `attribution: false` boolean | Needs ≥ 2.1.281; older versions skip the **whole** settings file | Not used (object form + `sessionUrl:false`) |
| `disable-model-invocation: true` | Supported; also blocks preloading into subagents and scheduled-task firing (≥ 2.1.196) | On all five workflow skills |
| Hook exit 2 | Blocks on PreToolUse and Stop; other non-zero codes don't block; timeouts **don't block** | Guards stay under 1 s and exit 2 on parse errors |
| Hook `if` field | Permission-rule syntax, tool events only; strips leading `VAR=`, checks `$()` and backtick subcommands | Only as a pre-filter for git hooks; policy_guard runs unfiltered on all Bash |
| Exec form `args`, `${CLAUDE_PROJECT_DIR}` | Supported; the placeholder is substituted in args; `CLAUDE_CODE_REMOTE=true` in cloud | All wiring |
| Hook `permissionDecision: "ask"` | Supported, and "ask" forces a prompt even in auto mode | Not relied on (exit 2 blocks instead) |
| Deny negation `Read(!.env.example)` | Valid in deny lists, same source only | C-07 |
| `.claude/rules` `paths:` | Loads when Claude **reads** matching files | Rules are pointers; creation-time gap noted (row 28) |
| New `.claude/agents/` dir | Not watched if it didn't exist at session start, so a restart is needed | Phase C runs reviewers via `claude -p --agent …` or after a restart |
| Cloud loads | Repo `CLAUDE.md`, `.claude/settings.json` hooks+permissions (**single-repo sessions only**), rules, skills, agents, `.mcp.json`. **Not loaded:** `~/.claude/*`, plugins | C-23; everything lives in the repo |
| Cloud setup script | Runs as root; cached if under ~5 min; re-run on script/allowlist change or ~7-day expiry; never on resume. GitHub release assets from unattached repos → 403. | §8 avoids GitHub release downloads |
| Cloud permission modes | Picked in the UI; `bypassPermissions`/`dontAsk` from settings are ignored | `ask` rules prompt you in the web UI |

---

## 7. Greenfield behavior and `gates.json` stub

**Every hook's contract:**

- It exits 0 silently in under 200 ms when its trigger condition is absent: no `tsconfig.json`, no `.nvmrc`, no `pnpm-lock.yaml`, no prettier, no claim in the message.
- It activates without edits when P02 creates the file it keys on.
- It exits 2 on unparseable input or an internal error. The kit rate-limits this for Stop hooks.

**`gates.json` v0.** JSON has no comments, so the `_doc` key and `.claude/README.md` explain it. I'll confirm in Phase B that `gates.py` ignores unknown keys; if it doesn't, the doc lives only in the README.

```json
{
  "_doc": "Stub until P02.02.02. P02 replaces the 'workspace' gate with the QG-01 set: format, lint, typecheck, unit, integration (real PG17+pgvector), build, gitleaks. Never delete a gate to make 'full' pass.",
  "needs": [],
  "gates": [
    {"name": "control-plane", "run": "python3 .claude/bin/control_plane_check.py && python3 -m unittest discover -s .claude/tests -t .", "timeout": 300},
    {"name": "control-plane-lint", "run": "uvx ruff@0.15.12 check .claude && uvx ruff@0.15.12 format --check .claude && uvx --from mypy mypy --strict .claude/bin .claude/hooks", "requires": ["uvx"], "timeout": 300},
    {"name": "workspace", "run": "pnpm turbo run lint typecheck test build", "requires": ["pnpm"], "timeout": 1800}
  ],
  "fast": ["control-plane"]
}
```

- Before P02, `workspace` **fails** because there is no `package.json`. So `gates full` fails, and claim_check blocks every "done/green" claim: the stub fails closed.
- It turns green on its own once P02's turbo tasks exist, and P02.02.02 then splits it into the QG-01 gates.
- `control-plane` passes on its own, so the control plane has real evidence (`gates fast` / `gates run control-plane`).
- The mypy version is pinned in Phase B.

---

## 8. Cloud setup script (`.claude/cloud/setup.sh`; you paste it into the environment)

```bash
#!/usr/bin/env bash
# moin cloud environment setup. Paste into claude.ai/code → environment "moin" → Setup script.
# Runs as root on Ubuntu 24.04 x86_64 before the session starts; keep < ~5 min so it is cached.
# Pins must equal .nvmrc / package.json packageManager / .terraform-version once P02 creates them
# (control_plane_check.py enforces this).
set -euo pipefail
readonly NODE_VERSION=24.21.0
readonly PNPM_VERSION=10.34.5
readonly TERRAFORM_VERSION=1.16.4
readonly GITLEAKS_VERSION=8.30.1
readonly WORK=/tmp/moin-setup
log() { printf '[moin-setup] %s\n' "$*"; }
mkdir -p "$WORK"

install_node() {
  local name="node-v${NODE_VERSION}-linux-x64" base="https://nodejs.org/dist/v${NODE_VERSION}"
  curl -fsSL -o "$WORK/${name}.tar.xz" "${base}/${name}.tar.xz"
  curl -fsSL -o "$WORK/SHASUMS256.txt" "${base}/SHASUMS256.txt"
  (cd "$WORK" && grep " ${name}.tar.xz\$" SHASUMS256.txt | sha256sum -c -)
  tar -xJf "$WORK/${name}.tar.xz" -C /opt
  ln -sfn "/opt/${name}" /opt/node24
  for b in node npm npx corepack; do ln -sfn "/opt/node24/bin/$b" "/usr/local/bin/$b"; done
  printf 'export PATH=/opt/node24/bin:$PATH\n' > /etc/profile.d/00-moin-node.sh
  /opt/node24/bin/npm install -g "pnpm@${PNPM_VERSION}"
  ln -sfn /opt/node24/bin/pnpm /usr/local/bin/pnpm
}

install_terraform() {
  local zip="terraform_${TERRAFORM_VERSION}_linux_amd64.zip"
  local base="https://releases.hashicorp.com/terraform/${TERRAFORM_VERSION}"
  curl -fsSL -o "$WORK/$zip" "${base}/${zip}"
  curl -fsSL -o "$WORK/tf.sums" "${base}/terraform_${TERRAFORM_VERSION}_SHA256SUMS"
  (cd "$WORK" && grep " ${zip}\$" tf.sums | sha256sum -c -)
  python3 -m zipfile -e "$WORK/$zip" "$WORK/tf"
  install -m 0755 "$WORK/tf/terraform" /usr/local/bin/terraform
}

install_gitleaks() {
  # GitHub release assets of unattached repos return 403 in cloud; the Go module proxy is allowlisted.
  GOTOOLCHAIN=auto GOBIN=/usr/local/bin \
    go install "github.com/zricethezav/gitleaks/v8@v${GITLEAKS_VERSION}"
}

command -v jq >/dev/null || { apt-get update -qq && apt-get install -y -qq jq; }
install_node & p1=$!
install_terraform & p2=$!
install_gitleaks & p3=$!
fail=0
for p in $p1 $p2 $p3; do wait "$p" || fail=1; done
log "node $(node -v) | pnpm $(pnpm -v) | $(terraform -version | head -1) | gitleaks $(gitleaks version) | $(jq --version)"
exit "$fail"
```

- **Network:** `nodejs.org`, `releases.hashicorp.com`, `proxy.golang.org` and `registry.npmjs.org` are in the Trusted list (confirmed). `registry.terraform.io` is **not**. Add it under Custom (with the default list included) before anything runs `terraform init` (P05).
- **Unverified until the first real cloud run (F-04):**
  - that `/usr/local/bin` beats the image's Node 22 on the session PATH; session_bootstrap warns if it doesn't;
  - that the Go toolchain download fits inside the 5-minute budget;
  - that the repo is or isn't available during setup. The script deliberately doesn't depend on it.
- **Extension P02 adds:** tflint and Trivy (P02.02.08), and `docker compose pull` once the Compose file exists.

---

## 9. Parallel phases (P01–P05) and session protocol

- **P01 is yours.** Agent sessions don't execute P01 items. They may draft templates under `docs/pilot/` only when you ask, and never tick P01 items.
- **Only P02 is startable on day 1 for engineering work:**
  - P03 needs **P02.03**;
  - P05 needs **P02 + EXT-09**;
  - P04's engineering spikes need P02's skeleton, although its EXT request drafting can run anytime.
- **The rule is one session per phase, and at most two concurrent engineering sessions.** Each session declares its phase via `/phase Pxx`. Two sessions never work the same phase, and never the same checklist section.
- **One branch per checklist section, short-lived.** Sessions in different phases never share a branch.
- **Shared-file discipline.** The files every session touches are the Status Ledger rows (PLAN.md), PROGRESS.md and INDEX.md.
  - A session edits only **its own phase's** ledger row.
  - PROGRESS.md and INDEX.md are append-only (one row per event), so parallel branches merge with at most trivial conflicts.
  - EV numbering is per phase, so there's no cross-phase collision.
  - If a merge conflict touches another phase's row, the session stops and asks.
- **`/phase` enforcement:** it refuses a phase whose tier-scoped hard dependencies aren't `VERIFIED` in the Status Ledger, and names the missing ones.
- **Cloud vs local:**
  - Cloud gets well-specified items from an **approved** `docs/phases/Pxx-plan.md` that has been pushed to GitHub. Every cloud session attaches only the moin repo.
  - Local gets phase planning, gate reviews, anything that needs your credentials, and the first run of any control-plane change.
  - Handoff between the two goes through `/handoff` plus a pushed branch; use `claude --teleport` to bring a cloud session local.

---

## 10. Phase C test plan (live, no claims without evidence)

**Environments:**

- **L** = an interactive or headless local session in moin, after a restart so the new agents and skills load.
- **H** = `claude -p` headless with **an empty HOME** plus `CLAUDE_CODE_REMOTE=true` to simulate cloud. User settings, CLAUDE.md, agents and skills are then absent, so only repo config applies. Auth approach: see D-13.
- **F** = a scratch fixture repo in the scratchpad (for switch-on behavior without doing P02's work).

Evidence goes to `docs/control-plane/evidence/` as stream-json transcripts or text.

| T | Trigger | Env | Expected |
|---|---|---|---|
| T-01 | Dummy `.env` (fake value, deleted afterwards): Read tool, `cat .env`, `python3 -c "print(open('.env').read())"`, Grep with `path=.env`; then `.env.example` Read | L, H | The first four are blocked (deny and/or hook, with the source named); `.env.example` is readable |
| T-02 | `git -C . push`, `git -c x=y push`, `/usr/bin/git push`, `sh -c 'git push'`, `git push origin HEAD:main` | L, H | All blocked by policy_guard |
| T-03 | `echo x > f; git clean -fd` | L, H | Blocked (kit fail-closed ordering) |
| T-04 | `git reset --hard` on a dirty tree | L | Blocked |
| T-05 | Untracked dummy `.env` + `git add -A && git commit -m "chore: x"` | L, H | Blocked (secret would be staged) |
| T-06 | Commit messages: "fix: tweak, generated with Claude", Co-Authored-By trailer via heredoc, `-F msg.txt` with "Anthropic", `gh pr create --body "🤖 …"`; control: `feat(ai): add model gateway` | L, H | The first four blocked; the control passes the hook (D-04) |
| T-07 | `terraform apply`, `terraform destroy -auto-approve`, `terraform -chdir=x apply` | L, H | Blocked, even though terraform isn't installed |
| T-08 | `psql -h db.example.com`, `AWS_PROFILE=moin-prod-admin aws s3 ls` | L | Blocked |
| T-09 | Final message "All gates are green." with no evidence | L, H | Stop hook exit 2, then the model restates as UNVERIFIED/BLOCKED |
| T-10 | Same claim after `gates full` (FAIL on `workspace`) | L | Blocked |
| T-11 | `gates fast`; `gates full`; `gates status` | L | fast PASS; full FAIL at `workspace` with the P02 hint; status is consistent |
| T-12 | Commit on the greenfield repo; fixture with `tsconfig.json` + a type error | L, F | Silent, then blocked |
| T-13 | Safe commands: `git status`, `git checkout -b tmp/x`, `git diff`, `python3 .claude/bin/plan_section.py P02`, `git commit -m "docs: tidy"` | L, H | All pass with no hook output |
| T-14 | Read of PLAN.md with no `limit` vs `offset=2058 limit=120` | L | First blocked with the extractor hint; second allowed |
| T-15 | Session start on greenfield | L, H | No hook output (except the orphan list, if orphans exist) |
| T-16 | Fixture `.nvmrc` = 24.21.0 under Node 22 | F | One warning line |
| T-17 | Extractor slices | L | Exact sections |
| T-18 | `evidence.py check` on a fixture with a stale SHA | F | STALE flagged |
| T-19 | Settings load under the empty HOME: `/permissions` equivalent via `--debug` hooks list | H | Repo hooks and rules active; user ones absent |
| T-20 | "Which PLAN sections do you read for P03?" | H | Extractor commands; no whole-file Read |
| T-21 | mutation_check on a throwaway fix | F | KILLED |
| T-22 | Skill dry runs: `/phase P02` (throwaway branch, deleted), `/phase P06` (refusal), `/verify-evidence` (F), `/gate-ready` (F), `/handoff` (throwaway branch), `/closure` preflight | L/H/F | Each expected artifact exists; shown via `ls` + head |
| T-23 | Throwaway branch `tmp/review-canary` with planted INV-02 (trust `x-org-id`), string-built SQL, fake hardcoded key, domain→infrastructure import, tenant-name conditional (INV-18); run all three reviewers; then `git branch -D` | L (`claude -p --agent`) | Each reviewer names its planted issue(s). The branch deletion is shown. |
| T-24 | Read fixture `packages/db/x.sql` | L | `db.md` rule loaded |
| T-25 | `bash -n`, shellcheck (if available), and a run inside `docker run --rm ubuntu:24.04` with Go/Python installed first | L | Versions printed. The real cloud run is **UNVERIFIED**. |

Anything I can't trigger for real is marked **UNVERIFIED** in the report. Known up front: StopFailure on a real rate limit, stop_guard on a real `/loop`, a real cloud session, format-on-edit switch-on, and session_bootstrap's cloud install path.

---

## 11. Local toolchain gaps (no sudo; **proposed only, nothing installed**)

| Gap | Proposal | Verify |
|---|---|---|
| Node 22.20.0 vs Node 24 LTS | `nvm install 24.21.0` (nvm is already present at `~/.nvm`; it reads `.nvmrc` natively). Keep 22 as a fallback for other repos; don't change the nvm default globally, and use `nvm use` in moin. | `node -v` = v24.21.0 in moin |
| pnpm pin | After Node 24: `corepack enable pnpm` (the shims land in the nvm Node dir, which is user-owned). `packageManager: pnpm@10.34.5` (P02.02.01) then selects the exact version. Before `package.json` exists: `corepack prepare pnpm@10.34.5 --activate`. | `pnpm -v` = 10.34.5 |
| Terraform missing | Download the `terraform_1.16.4_linux_amd64.zip` + SHA256SUMS from releases.hashicorp.com, run `sha256sum -c`, unzip to `~/.local/opt/terraform-1.16.4/` and symlink `~/.local/bin/terraform` (the same mechanism as cloud; PLAN allows a pinned binary). | `terraform -version` |
| jq, gitleaks | **No gap:** jq 1.7 and gitleaks 8.30.1 are present | — |
| tflint, Trivy | P02.02.08 (not control plane) | — |

Timing is decision D-14.

---

## 12. Founder actions (yours; I won't attempt any of these)

| ID | Action | Why / when |
|---|---|---|
| F-01 | Answer the decisions in §13 and approve this plan | Before Phase B |
| F-02 | Commit PLAN.md per P00.05.04 (see D-01) | Cloud sessions need PLAN.md in the clone; the extractor and every phase depend on it |
| F-03 | **GitHub Pro + `main` ruleset (EXT-24, P02.01.01).** Steps:<br>1. github.com → Settings → Billing and plans → upgrade to Pro.<br>2. Repo → Settings → Rules → Rulesets → New branch ruleset, "main-protection", Enforcement *Active*, target: *Default branch*.<br>3. Enable: *Restrict deletions*, *Require linear history*, *Require a pull request before merging* (0 approvals, since you're solo; dismiss stale approvals), *Block force pushes*. Optionally enable *Require signed commits*.<br>4. Bypass list: Repository admin, "for pull requests only".<br>5. After P02.06's first CI run, add the required status checks `verify`, `security-scan`, `container-scan` (checks are only selectable once they have run). | Required before MT-LIVE per P02 failure modes. Until then P02 records an accepted risk. |
| F-04 | **Cloud environment "moin".** Steps:<br>1. claude.ai/code → environment selector → Add cloud environment, name `moin`.<br>2. Network: *Custom*, check "Also include default list", add `registry.terraform.io`.<br>3. Environment variables: none (at most non-secret `CI=1`). API credentials: none.<br>4. Setup script: paste `.claude/cloud/setup.sh` from the merged `main`.<br>5. Start a session with **only** AyhamJo7/moin attached, and ask it to run: `node -v; pnpm -v; terraform -version; gitleaks version; jq --version; python3 .claude/bin/control_plane_check.py`.<br>6. Send me the output, or paste it into the report. | Makes the cloud UNVERIFIED items VERIFIED |
| F-05 | **GitHub access for cloud.** Install the Claude GitHub App on **AyhamJo7/moin only** (claude.ai/code prompts for it, or run `/install-github-app` locally). Alternatively run `/web-setup` if you don't want the App. | Cloud sessions clone and push; auto-fix needs the App |
| F-06 | **Commit signing (optional, D-08):**<br>`git config --global gpg.format ssh`<br>`git config --global user.signingkey ~/.ssh/id_ed25519.pub`<br>`git config --global commit.gpgsign true`<br>then upload the key at GitHub → Settings → SSH and GPG keys → *New SSH key* → type **Signing key**. | Your local commits get signed. Cloud-session commits can't carry your signature (unverified); squash-merge via the GitHub UI is signed by GitHub. |
| F-07 | Toolchain installs from §11, if you keep them (D-14) | Before P02 |
| F-08 | Approve the kit change (D-07) | Before Phase C local tests |
| F-09 | Review and **squash-merge** the draft PR | After Phase C |
| F-10 | Keep no AWS/Stripe/Twilio/OpenAI credentials in the shell you launch sessions from; never export `AWS_PROFILE` | Continuous; the guards assume it |
| F-11 | P00.05.01–03 adoption (DG-00, DG-09, change log) | Your P00 exit gate; independent of this work |

---

## 13. Decisions for you (each with my recommendation)

| ID | Decision | Options | **Recommendation** |
|---|---|---|---|
| D-01 | Commit PLAN.md, BLUEPRINT.md and the research now? | BLUEPRINT is **already committed** (`fb7185e`). PLAN.md: (a) separate `docs/plan-baseline` branch + PR per P00.05.04, merged first; (b) inside the control-plane PR; (c) later. Research: (i) keep local only; (ii) commit at `docs/control-plane/research/claude-code-setup.md` with a "superseded where it conflicts with PLAN.md; see CONTROL_PLANE_PLAN §3" banner; (iii) `docs/research/`. | **PLAN.md (a):** its own PR, merged before or with this one, because cloud sessions can't work without it. P00.05.04 needs your instruction: say "commit PLAN.md". **Research (ii):** it keeps the provenance for §3's line references, and the banner stops agents from following its wrong details. |
| D-02 | How this lands | (a) branch + draft PR you merge; (b) a direct commit to `main` | **(a)** Branch `chore/dev-control-plane`, small Conventional Commits (e.g. `chore(tooling): port repository git guard`; no scope or text naming AI tools), draft PR opened early, and you squash-merge. |
| D-03 | Docs folder name | `docs/claude/` vs `docs/control-plane/` | **`docs/control-plane/`**. The strict no-AI guard would block any commit or PR text that cites a `docs/claude/…` path. |
| D-04 | No-AI rule scope | (a) strict research regex incl. `\bAI\b`; (b) AI-tool/attribution list (C-13) | **(b)**, with one shared pattern file that P02.01.03 reuses in CI |
| D-05 | Bypass mode in moin | (a) `disableBypassPermissionsMode: "disable"` in the repo; (b) allow | **(a)**. Bypass silences every `ask`, and in bypass `.claude/` edits stop prompting. Use `auto` or `acceptEdits` for flow. **Side effect:** in *this* session, once settings.json lands mid-Phase B, bypass drops and you'll see prompts for `.claude/` writes ("allow for this session" covers them). |
| D-06 | Where phase plans live | `docs/phases/` vs `docs/control-plane/phases/` | **`docs/phases/Pxx-plan.md`**, with a one-line PLAN change-log note from you (repo-structure addition). Gate reports are EV records. |
| D-07 | Local duplicate hooks (user kit + repo copies) | (a) accept doubles; (b) add `--defer-to-repo` to the **user-level** kit wiring: a user hook exits 0 when `$CLAUDE_PROJECT_DIR/.claude/hooks/<same>.py` exists (~15 lines + tests in `~/.claude/kit`, a separate kit commit) | **(b)**. The repo copy becomes the single authority in both places, so local = cloud. |
| D-08 | Commit signing | Now / later / never | **Later (after P02):** it isn't needed for trunk safety; the ruleset is. |
| D-09 | Who sets VERIFIED/COMPLETE | Agent / founder | Agents tick items with EV IDs and raise tiers to at most **READY_FOR_REVIEW**; **you** set VERIFIED/COMPLETE |
| D-10 | PLAN.md edits | ask / allow | **ask**. Ledger edits are few, and loosening needs your approval anyway. |
| D-11 | Reviewer model | inherit / pin opus | **inherit** |
| D-12 | `claude-code-action` PR-review workflow | now (P02) / later / never | **Decide at P02.06.** It's CI and needs the App + a token secret (your action). |
| D-13 | Auth for the empty-HOME headless test | (a) temp HOME with a **symlink** to `~/.claude/.credentials.json` (I never read it; Claude Code does); (b) you run `claude setup-token` and the headless command yourself via `!` (the token stays in your shell); (c) `--setting-sources project,local` with the real HOME (weaker: not an empty HOME) | **(a)**, only with your OK. Fallback (b). |
| D-14 | Toolchain installs (§11) | I do them in Phase B / you do them | **I do them in Phase B** (user-local, no sudo, checksums verified), because they don't change any repo file. Phase C doesn't need them; P02 does. |
| D-15 | Push policy | ask everywhere / allow `claude/*` cloud branches | **ask everywhere for now.** Revisit after P05, per the research's own suggestion, once the guard has a track record. |
| D-16 | Port kit-only hooks too | portable set only / **all** | **All**, with `CLAUDE_KIT_STATE` repo-local. Otherwise local and cloud diverge (commit typecheck, checkpoints, stall detection). |

---

## 14. How P02 touches this (proposed, not done here)

| PLAN item | Interaction with the control plane |
|---|---|
| P02.01.04 `PROGRESS.md`, `docs/evidence/INDEX.md`, EV template | **Make it the first P02 commit.** Format: kit front matter (`mission/status/mode/next`, which session_context and commit_guard read) plus PLAN's chronological log table. `evidence.py` then activates. This setup's ledger stays in `docs/control-plane/PROGRESS.md`. |
| P02.01.03 PR-title + AI-mention CI check | Reuse `.claude/policy/no-ai-mentions.json` |
| P02.02.01 `.nvmrc`, `engines`, `packageManager` | session_bootstrap and the pin drift check switch on automatically |
| P02.02.02 Turborepo tasks | Replace the `workspace` stub gate with the QG-01 gates in `.claude/gates.json` |
| P02.04.03 `.env.example`, `.env*` gitignored | The deny carve-out is already in place; the root `.gitignore` is P02's |
| P02.06.02 gitleaks in CI | The cloud script already installs gitleaks |
| P02.07.01 `conventions.md` | CLAUDE.md §9 gets the real commands, and `conventions.md` links CLAUDE.md |
| P02.07.03 "fresh agent session follows the docs from a clean clone" | This is the H-environment test, re-run by P02 |

---

## 15. Phase B outline (after approval)

Each step is a separate commit on `chore/dev-control-plane`.

1. Move this file to `docs/control-plane/`. Add `docs/control-plane/PROGRESS.md` (the ledger, from step one), the research copy, and open the draft PR.
2. Port the kit files verbatim + `kit-manifest.json`.
3. `policy_guard.py` + policy JSON + tests.
4. `plan_section.py`, `evidence.py`, `control_plane_check.py` + tests.
5. session_bootstrap, format_on_edit + tests.
6. Agents (ported + appendices) and skills (4 new + patched `/closure`).
7. Rules, cloud script, `.claude/README.md`, `CLAUDE.md`.
8. `settings.json` last, so the guards go live only once everything they call exists.
9. Kit `--defer-to-repo` (if D-07 (b)), in `~/.claude/kit`, with its own tests.

After Phase B: Phase C (§10), then `CONTROL_PLANE_REPORT.md` with the rewritten P02 kickoff prompt.

**STOP: awaiting your approval and answers to D-01…D-16.**

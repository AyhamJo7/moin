> **SUPERSEDED WHERE IT CONFLICTS WITH `PLAN.md`.** This is background research written before the plan was
> read closely. Several details are wrong for this repository (branching, paths, ledger format, status
> vocabulary, invariants, `.env.example`, the no-AI pattern, attribution). The resolutions are listed in
> [`docs/control-plane/CONTROL_PLANE_PLAN.md` §3](../CONTROL_PLANE_PLAN.md#3-research-vs-planmd-conflict-list-and-resolutions);
> what was actually built is in [`CONTROL_PLANE_REPORT.md`](../CONTROL_PLANE_REPORT.md). Do not follow this file
> as instructions. Line references `R:nn` in the plan refer to the original text below the banner (offset +8).

---
# Pre-Kickoff Setup Guide: Running Claude Code Phase-by-Phase Through PLAN.md for `AyhamJo7/moin`

Before you send the kickoff prompt, do five things: (1) commit a short root `CLAUDE.md` plus `.claude/settings.json`, hooks, skills and subagents to the repo, because they are the only configuration that both local and cloud sessions share; (2) put deterministic guardrails in hooks and permission rules rather than in prose, because Anthropic's docs say CLAUDE.md is context, not enforcement; (3) protect `main` with a GitHub ruleset, which needs GitHub Pro on a personal-account private repo; (4) keep AWS, Twilio, Stripe, OpenAI, Google and Microsoft credentials away from Claude entirely for the early phases; (5) scope the kickoff to one phase (P02) that ends with a written evidence ledger and a hard stop at its gate.

## TL;DR

- **Commit the control plane first.** A root `CLAUDE.md` under 200 lines, `.claude/settings.json` (deny secrets and destructive infra commands, ask before `git push`, attribution off), a `PreToolUse` guard hook, `/phase` and `/verify-evidence` skills, and `security-reviewer`/`architecture-reviewer` subagents. Cloud sessions read these from the clone but never see your `~/.claude/` files.
- **Default split: Claude owns code, tests, local Docker, `terraform fmt/validate`, feature branches and PRs.** You approve pushes, PR creation and any `terraform plan` against real accounts. Account creation, credentials, contracts/DPAs, provider consoles, `terraform apply` and merges to `main` stay with you. Install only docs-type MCP servers (Terraform registry, library docs) at first; skip Stripe/Twilio/AWS-write MCP servers.
- **Kickoff = one phase, plan mode first, evidence or it didn't happen.** Start with P02, have Claude write its plan to the repo, execute, record each evidence ID in `PROGRESS.md`, then stop at the gate. Run `/clear` (locally) or open a new session (cloud) between phases.

## Key Findings

1. **Permission rules are not a security boundary for Bash, so layer them.** Rules are evaluated deny, then ask, then allow, and the first match wins. But the docs say a Bash rule "matches the command text Claude writes": `Bash(git push *)` does not stop `git -C . push origin main`. For command-text enforcement you need a `PreToolUse` hook. For OS-level enforcement you need sandboxing.
2. **CLAUDE.md is advisory.** Anthropic's memory docs: Claude "treats them as context, not enforced configuration. To block an action regardless of what Claude decides, use a PreToolUse hook." They also say to "target under 200 lines per CLAUDE.md file," because longer files consume more context and may reduce adherence. Imported `@path` files still load at launch, so imports organize content without saving context.
3. **Cloud sessions only get what is committed.** The repo's `CLAUDE.md`, `.claude/settings.json` hooks and permissions, `.mcp.json`, `.claude/rules/`, skills, agents and commands all carry over. Your user `~/.claude/CLAUDE.md`, user skills/agents and user-scoped MCP servers do not. Plugins declared in the repo's settings are also not installed in cloud sessions.
4. **The cloud VM is capable but the wrong Node version, with no Terraform.** Each session is Ubuntu 24.04 x86_64 with Node 20/21/22 (22 on PATH), pnpm, Docker with `docker compose`, PostgreSQL 16 and Redis 7. Resource ceilings are "approximate": 4 vCPUs, 16 GB RAM, 30 GB disk. Terraform and AWS CLI are not in the pre-installed list. Setup scripts run as root; per Anthropic's cloud-environments docs, "if setup takes longer than roughly five minutes, the environment isn't cached," the cache is rebuilt "when the cache reaches its expiry after roughly seven days," and resuming a session "never re-runs the setup script."
5. **Checkpoints don't cover Bash.** `/rewind` restores only edits made through Claude's file tools. Files changed by `rm`, `mv`, `cp` and similar commands are not tracked. For a multi-week build, small commits on a phase branch are your real undo button.
6. **Private-repo branch protection costs money.** GitHub Docs' "About rulesets" states: "Rulesets are available in public repositories with GitHub Free and GitHub Free for organizations, and in public and private repositories with GitHub Pro, GitHub Team, and GitHub Enterprise Cloud." For a personal-account repo like `AyhamJo7/moin`, that means GitHub Pro.

## Details

### 1. Claude Code setup essentials

#### Memory layout

| File | Scope | What goes in it for moin |
|---|---|---|
| `CLAUDE.md` (repo root, committed) | Local + cloud | How to read PLAN.md/BLUEPRINT.md, ledger/evidence rules, invariants, commands, conventions. Under 200 lines. |
| `.claude/rules/*.md` (committed) | Local + cloud | Path-scoped rules via `paths:` frontmatter, e.g. `infra/**` → Terraform rules; `packages/db/**` → RLS/Drizzle rules; `apps/web/**` → Next.js rules. These load only when Claude reads matching files. |
| `~/.claude/CLAUDE.md` | Local only | Personal preferences (tone, "ask before installing global tools"). Nothing the project depends on, because cloud never sees it. |
| `CLAUDE.local.md` (gitignored) | Local only | Your machine specifics (AWS profile names, local ports). |
| Auto memory | Per repo | Claude's own notes. Only the first 200 lines or 25 KB load each session. Review it occasionally and move anything durable into CLAUDE.md. |

Useful mechanics:
- Import syntax is `@path`. Relative paths resolve from the importing file, recursion is capped at four hops, and a path inside backticks is not imported.
- Block-level HTML comments are stripped before injection, so you can leave maintainer notes for free.
- Do not `@import` PLAN.md. A 34-phase plan would be loaded in full every session. Tell Claude to read only the current phase section on demand.

#### CLAUDE.md skeleton (commit at repo root)

```markdown
# moin — project instructions for Claude Code

## Source of truth
- PLAN.md = phases P00–P33, each with checklist items, evidence IDs, and a gate. BLUEPRINT.md = architecture/invariants.
- Read ONLY the current phase section of PLAN.md (grep for the phase heading), plus BLUEPRINT.md sections it references. Never load the whole plan into context.
- PROGRESS.md = the status ledger. It is the handoff between sessions. Read it first in every session; update it before you stop.

## Execution rules
- One phase at a time. Never start phase N+1 until the phase N gate is recorded as PASSED in PROGRESS.md by the founder.
- Start each phase in plan mode: write docs/phases/PNN-plan.md, wait for approval, then execute.
- A checklist item is done only when its evidence ID has a concrete artifact recorded in PROGRESS.md: command + exit code, test file + passing output summary, file path + commit SHA, or screenshot path. No evidence = not done.
- EXT/founder gates (account creation, contracts, credentials, provider consoles, prod applies): STOP, write the exact request in PROGRESS.md under "Blocked on founder", and end the turn. Never simulate, stub-as-done, or work around an EXT gate.
- If PLAN.md is ambiguous or conflicts with BLUEPRINT.md, stop and ask. Do not reinterpret the plan.

## Invariants (non-negotiable)
- No secrets in the repo, ever. Config comes from env vars; commit only `env.example` with placeholder values.
- No production data outside prod. Tests use synthetic fixtures only.
- Tenant isolation: every tenant table has RLS ENABLED + FORCED; every query runs under a tenant-scoped role; every new table ships with a cross-tenant negative test.
- AWS region eu-central-1 only. OpenAI calls use the EU data-residency project/endpoint. Twilio uses the IE1 region.
- Stripe via REST only (no SDK), per BLUEPRINT.md.
- You never run terraform apply/destroy, never touch real AWS/Twilio/Stripe/OpenAI accounts, never read credential files.

## Stack & commands
- Node 24 LTS (see .node-version), pnpm 10 (packageManager field), Turborepo.
- Install: `pnpm install --frozen-lockfile` · Build: `pnpm turbo build` · Lint: `pnpm turbo lint` · Typecheck: `pnpm turbo typecheck`
- Unit: `pnpm turbo test` (Vitest) · E2E: `pnpm exec playwright test`
- Local DB: `docker compose -f infra/docker/compose.dev.yml up -d` (Postgres 17 + pgvector, Valkey)
- IaC: `terraform fmt -recursive` and `terraform validate` only.

## Git conventions
- Branch per phase: `phase/pNN-<slug>`. Small commits. Conventional Commits (`feat(api): …`, `chore(infra): …`).
- Never mention AI, Claude, or assistants in commits, PR titles or PR bodies. No Co-Authored-By trailers.
- Never push to main, never force-push, never use --no-verify.

## Reviews (QG-09)
- Before declaring a phase gate ready, run the security-reviewer and architecture-reviewer subagents and record their findings + resolutions as evidence.
```

#### `.claude/settings.json` (committed)

This design reflects three documented behaviors:
- A deny can't be carved out by a narrower allow.
- A matching `ask` wins over a more specific `allow`.
- Anything not matched falls back to the permission mode, which in `default`/Manual prompts you.

So don't write `Bash(aws *)` into `ask` and hope an allow exempts `aws sts get-caller-identity`. Leave AWS unlisted (you'll be prompted) and deny only the dangerous forms.

```json
{
  "$schema": "https://json.schemastore.org/claude-code-settings.json",
  "attribution": { "commit": "", "pr": "" },
  "permissions": {
    "defaultMode": "default",
    "disableBypassPermissionsMode": "disable",
    "allow": [
      "Bash(pnpm install)",
      "Bash(pnpm install --frozen-lockfile)",
      "Bash(pnpm turbo *)",
      "Bash(pnpm run lint *)",
      "Bash(pnpm run test *)",
      "Bash(pnpm run typecheck *)",
      "Bash(pnpm exec vitest *)",
      "Bash(pnpm exec playwright test *)",
      "Bash(pnpm exec drizzle-kit generate *)",
      "Bash(docker compose -f infra/docker/compose.dev.yml *)",
      "Bash(terraform fmt *)",
      "Bash(terraform validate *)",
      "Bash(terraform init -backend=false *)",
      "Bash(git status)",
      "Bash(git diff *)",
      "Bash(git log *)",
      "Bash(git add *)",
      "Bash(git commit *)",
      "Bash(git switch *)",
      "Bash(gh pr view *)",
      "Bash(gh pr diff *)",
      "Bash(gh pr checks *)",
      "Bash(gh run list *)",
      "Bash(gh run view *)"
    ],
    "ask": [
      "Bash(git push *)",
      "Bash(gh pr create *)",
      "Bash(terraform plan *)",
      "Bash(pnpm add *)",
      "Bash(curl *)"
    ],
    "deny": [
      "Read(**/.env)",
      "Read(**/.env.*)",
      "Edit(**/.env)",
      "Edit(**/.env.*)",
      "Read(**/*.tfvars)",
      "Read(**/*.tfstate)",
      "Read(**/*.tfstate.*)",
      "Read(**/*.pem)",
      "Read(**/*.key)",
      "Read(~/.aws/**)",
      "Read(~/.ssh/**)",
      "Read(~/.config/gh/**)",
      "Read(~/.docker/config.json)",
      "Bash(terraform apply *)",
      "Bash(terraform destroy *)",
      "Bash(terraform import *)",
      "Bash(terraform state *)",
      "Bash(terraform force-unlock *)",
      "Bash(aws configure *)",
      "Bash(aws secretsmanager get-secret-value *)",
      "Bash(aws * delete-*)",
      "Bash(aws * terminate-*)",
      "Bash(git push --force *)",
      "Bash(git push -f *)",
      "Bash(git push origin main *)",
      "Bash(git reset --hard *)",
      "Bash(git commit * --no-verify *)",
      "Bash(gh pr merge *)",
      "Bash(gh secret *)",
      "Bash(gh repo delete *)",
      "Bash(pnpm run deploy *)",
      "Bash(rm -rf *)"
    ]
  },
  "hooks": {
    "SessionStart": [
      { "hooks": [ { "type": "command", "command": "\"$CLAUDE_PROJECT_DIR\"/.claude/hooks/session-start.sh", "timeout": 120 } ] }
    ],
    "PreToolUse": [
      { "matcher": "Bash", "hooks": [ { "type": "command", "command": "\"$CLAUDE_PROJECT_DIR\"/.claude/hooks/guard-bash.sh", "timeout": 10 } ] },
      { "matcher": "Read|Edit|Write", "hooks": [ { "type": "command", "command": "\"$CLAUDE_PROJECT_DIR\"/.claude/hooks/guard-files.sh", "timeout": 10 } ] }
    ],
    "PostToolUse": [
      { "matcher": "Edit|Write", "hooks": [ { "type": "command", "command": "\"$CLAUDE_PROJECT_DIR\"/.claude/hooks/format.sh", "timeout": 60 } ] }
    ]
  }
}
```

Notes and caveats:
- **`.env.example` gets blocked by `**/.env.*`.** Rename it to `env.example` so Claude can read the template.
- **Read/Edit deny rules also cover recognized Bash file commands.** The permissions docs say they apply to `cat`, `head`, `tail`, `sed`, `tee` and redirection targets. They do not cover every program (e.g. `python -c open(...)`), which is why the hook and sandboxing layers exist.
- **Deny rules have historically been buggy.** GitHub issues #6699 and #24846 reported `.env` deny rules not being enforced in some versions. Verify on a dummy `.env` after every Claude Code upgrade.
- **Approvals persist per repo.** "Yes, and don't ask again" writes allow rules to `.claude/settings.local.json`. Review that file weekly, because approvals accumulate there silently.
- **Attribution settings vary by version.** `attribution` with empty strings removes the Co-Authored-By trailer and the PR footer, and replaces the deprecated `includeCoAuthoredBy`. Julian Goldie cites the v2.1.281 changelog (23 September 2026) for a boolean shorthand, `"attribution": false`, which htlin222/CCChange PR #68 says equals `{"commit":"","pr":"","sessionUrl":false}` — but on v2.1.280 and earlier the boolean is a schema mismatch that makes the whole settings file be skipped, deny rules included, and Anthropic's settings reference still lists only the `commit`, `pr` and `sessionUrl` keys, so use the object form. Your guard hook enforces the no-AI-mentions rule regardless.

#### Hooks (commit under `.claude/hooks/`, `chmod +x`)

- **`guard-bash.sh` (PreToolUse, Bash).**
  - Read `tool_input.command` from stdin JSON and exit `2` with a stderr reason to block.
  - Block: any `terraform apply|destroy`; `git push` containing `--force`, `-f`, `main` or `+refs`; any `git` invocation with `-C` or `-c` followed by `push`; `--no-verify`; `git commit` whose message matches `(?i)claude|anthropic|\bAI\b|co-authored-by`; `aws` with `--profile` naming a prod profile; `psql`/`pg_dump` against any non-localhost host; `stripe`, `twilio` CLIs; `cat|less|base64` of `.env*`/`*.tfvars`.
  - This closes exactly the command-text gaps the permissions docs list.
- **`guard-files.sh` (PreToolUse, Read|Edit|Write).** Exit 2 if `tool_input.file_path` matches `.env`, `*.tfvars`, `*.tfstate`, `*.pem`, `~/.aws`, `~/.ssh`.
- **`format.sh` (PostToolUse, Edit|Write).** Run `pnpm exec prettier --write "$file"` and `pnpm exec eslint --fix "$file"` for TS/TSX/JSON/MD. Run `terraform fmt "$file"` for `.tf`. Keep it per-file and fast; run full typecheck/test at commit time, not after every edit.
- **`session-start.sh` (SessionStart).**
  - Print the current phase and open blockers from PROGRESS.md so each session starts oriented.
  - When `CLAUDE_CODE_REMOTE=true` (cloud), start `docker compose` services and run `pnpm install --frozen-lockfile`. The cloud cache keeps files but not running processes.

Two hook facts to design around:
- **A timed-out hook doesn't block.** The hooks reference says a timed-out `command` hook on PreToolUse does not block the tool call, so guards must be fast and fail closed (exit 2 on parse errors).
- **Hooks depend on `jq`.** Hooks usually parse JSON with `jq`. Cloud VMs have it. Install it locally (a static binary in `~/.local/bin` needs no sudo) or write the hooks in Node.
- **Git hooks too.** Also add a real git `commit-msg` hook (commitlint for Conventional Commits plus the no-AI regex) and a secret scanner (e.g. gitleaks) in pre-commit and CI. These protect commits made by anyone, including you.

#### Skills / slash commands (commit under `.claude/skills/`)

Custom commands have been merged into skills: `.claude/skills/phase/SKILL.md` creates `/phase`. Set `disable-model-invocation: true` on every workflow skill, so that only you can trigger it. The docs' example: "You don't want Claude deciding to deploy because your code looks ready."

- **`/phase <PNN>`:**
  1. Read PROGRESS.md, then the PNN section of PLAN.md and referenced BLUEPRINT.md sections.
  2. Write `docs/phases/PNN-plan.md` mapping every checklist item to an evidence ID and verification command.
  3. List EXT/founder dependencies.
  4. Stop for approval.
- **`/verify-evidence <PNN>`:** For each evidence ID in the phase, re-run its verification command, compare with the ledger, and mark each as VERIFIED, STALE or MISSING. It never marks the gate passed.
- **`/gate-ready <PNN>`:** Run lint, typecheck, tests and `terraform validate`; invoke both reviewer subagents; produce a gate report in `docs/phases/PNN-gate.md`; stop.
- **`/handoff`:** Update PROGRESS.md (done, evidence, blockers, next step), commit it, and print a one-paragraph resume prompt.

#### Subagents (commit under `.claude/agents/`)

Subagents are Markdown files with YAML frontmatter (`name`, `description`, `tools`, `model`). They receive only their own system prompt, not the full Claude Code system prompt. Since v2.1.198 the `/agents` wizard no longer opens; you create or edit the files directly or ask Claude to write them.

```markdown
---
name: security-reviewer
description: Use before any phase gate (QG-09) and on any diff touching auth, RLS, secrets, IAM, webhooks, or PII. Read-only.
tools: Read, Grep, Glob, Bash
model: opus
---
You are a security reviewer for a multi-tenant EU SaaS. Review the current branch diff (git diff main...HEAD).
Check: secrets in code/config/tests; RLS ENABLE+FORCE on every tenant table and a cross-tenant negative test; tenant context set per request/transaction; IAM least privilege and no wildcards in Terraform; webhook signature verification (Twilio, Stripe); PII in logs; region pinning (eu-central-1, OpenAI EU, Twilio IE1); dependency risk.
Output a findings table: ID, severity, file:line, issue, fix. Do not edit files.
```

Add an `architecture-reviewer` along the same lines: checks against BLUEPRINT.md module boundaries, package dependency direction and ADR consistency. Make it read-only; `model: opus` suits review depth.

Optionally add an `evidence-auditor` (model `sonnet`, read-only) that cross-checks PROGRESS.md against the repo. Keep reviewers read-only so they can't "fix" what they're supposed to judge.

#### Plan mode, output styles, context and checkpoints

- **Plan mode** reads and explores without editing source. Start every phase there (Shift+Tab, or `claude --permission-mode plan`). The `opusplan` model alias uses Opus in plan mode and Sonnet for execution.
- **Output styles:** not needed for this workflow. The default style is fine; spend configuration effort on hooks and skills instead. (I did not research output styles in depth.)
- **Context strategy for a multi-week project:**
  - Treat each phase as one or more fresh sessions, with PROGRESS.md as the only memory that matters.
  - Use `/compact <focus>` mid-phase when long test output piles up.
  - Use `/clear` at phase boundaries (locally). In cloud sessions `/clear` is not available; start a new session from the sidebar.
  - Cloud sessions auto-compact partway through the window, because they set `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` themselves.
  - Use `/context` to check what is loading.
- **Checkpoints:** snapshots cover the 100 most recent checkpoints per session, and Anthropic's checkpointing docs say the retention sweep deletes them "by default about 30 days after the session last saved one" (adjustable via `cleanupPeriodDays`). They don't track Bash-made file changes, subagent edits, or edits from other sessions. Commit after every green checklist item.

### 2. MCP servers: what to add, what to avoid

| Server | Verdict | Why / how |
|---|---|---|
| **GitHub** | Use `gh` CLI locally; in cloud use the built-in GitHub tools. Official GitHub MCP only if needed, read-only. | Cloud already routes GitHub through Anthropic's proxy (push only to the session's branch; GraphQL limited to a pinned PR set). If you add the official server locally, use the remote endpoint with `X-MCP-Toolsets: repos,pull_requests,actions` and `X-MCP-Readonly: true`. GitHub states lockdown mode "is not a security boundary." |
| **Terraform (HashiCorp official)** | Add (registry/docs only) | Gives current provider/module docs so Claude doesn't write outdated AWS provider syntax. AWS Labs' own migration guide points users from `awslabs.terraform-mcp-server` to HashiCorp's server. Run it without an HCP/TFE token (registry only). HashiCorp warns not to use it with untrusted clients. Pin the image version. |
| **AWS docs / knowledge servers** | Optional, docs-only | Fine if they only read public documentation. **Avoid** any AWS server that executes API calls or CLI commands with your credentials during build phases. |
| **Library docs (e.g. Context7-style)** | Optional | Useful for fast-moving APIs (Next.js App Router, Drizzle, Fastify). Treat fetched docs as untrusted input (prompt-injection surface). I did not verify a specific server's current security posture. |
| **Playwright MCP** | Optional, local only | The Playwright test runner covers E2E evidence. The MCP server is only useful for interactive UI debugging against localhost. Don't point it at authenticated third-party consoles. |
| **Postgres MCP** | Only against local Docker DB, read-only role | Never against RDS. A `psql` against localhost does the same job with less surface. |
| **Stripe MCP** | Avoid until the billing phase, then test mode + restricted key | Stripe's docs say "Beginning October 31, 2026, Stripe MCP no longer accepts full-access secret keys or restricted API keys without the Agent tag." If you use it, use OAuth or an Agent-tagged restricted key scoped to test mode. Your plan uses REST from app code anyway, so the MCP adds little. |
| **Twilio MCP** | Avoid | Not researched in depth here. Voice/ConversationRelay configuration touches real phone numbers and billing, so keep it in the console with you. |

Scope rules:
- Servers added with `claude mcp add` at default or user scope live in `~/.claude.json` and don't reach cloud sessions. Use `--scope project` (writes `.mcp.json`) only for servers you want everywhere, and only if they need no secrets.
- Deny rules like `mcp__*` can remove all MCP tools. Allow rules must name a specific server (`mcp__terraform__*`).
- In cloud sessions, MCP connector traffic goes through Anthropic's servers and bypasses the environment's network allowlist, so "turn off any connector you don't need."

### 3. Claude Code on the web (cloud sessions)

**Availability and auth.**
- Cloud sessions are available on Pro, Max and Team plans, and for Enterprise premium or Chat + Claude Code seats.
- There are two ways to connect GitHub:
  - **Claude GitHub App:** private repos it's installed on. Required for Auto-fix.
  - **`/web-setup`:** sends your local `gh` token to your Claude account.
- For a private repo plus PR auto-fix, install the GitHub App on `AyhamJo7/moin` only (not "all repositories").
- Your GitHub credentials never enter the VM. The proxy swaps a scoped credential server-side and allows `git push` only to the session's current working branch.

**Environment.** Create a dedicated "moin" environment rather than using Default:
- **Network:** Custom, with "include default list" checked. Add `registry.terraform.io`, which is not in the Trusted list and which `terraform init` needs for providers. `releases.hashicorp.com`, `nodejs.org`, `*.amazonaws.com` and Docker Hub already are.
- **Environment variables:** only non-secret values (`NODE_ENV=development`, `CI=1`). The docs warn anyone using the environment can read them.
- **API credentials** (Pro/Max only; the agent proxy injects them without Claude seeing the key): don't add any for now. Nothing in the early phases should call Stripe, Twilio or OpenAI for real.
- **AWS:** don't give cloud sessions AWS credentials at all. The docs list interactive auth like AWS SSO as something that doesn't carry over.

**Setup script** (runs as root before Claude starts; keep it under about five minutes so it gets cached):

```bash
#!/bin/bash
set -uo pipefail
# Node 24 from nodejs.org (the VM ships 20/21/22 with 22 on PATH)
NODE_VER=$(curl -fsSL https://nodejs.org/dist/index.json | jq -r '[.[] | select(.version|startswith("v24."))][0].version')
curl -fsSL "https://nodejs.org/dist/${NODE_VER}/node-${NODE_VER}-linux-x64.tar.xz" | tar -xJ -C /opt \
  && ln -sfn "/opt/node-${NODE_VER}-linux-x64/bin/"{node,npm,npx,corepack} /usr/local/bin/ || echo "WARN: node24 install failed"
corepack enable && corepack prepare pnpm@10 --activate || npm i -g pnpm@10 || true
# Terraform from releases.hashicorp.com (tfenv/fnm GitHub release downloads may 403 via the GitHub proxy)
TF_VER=1.x.y   # set to the version pinned in .terraform-version
curl -fsSLo /tmp/tf.zip "https://releases.hashicorp.com/terraform/${TF_VER}/terraform_${TF_VER}_linux_amd64.zip" \
  && unzip -o /tmp/tf.zip -d /usr/local/bin || echo "WARN: terraform install failed"
# Pre-pull local service images so they're in the cached snapshot
cd "${CLAUDE_PROJECT_DIR:-.}" 2>/dev/null && docker compose -f infra/docker/compose.dev.yml pull || true
```

Setup-script caveats:
- **Why not fnm/tfenv in the cloud:** the docs say release-asset requests to repositories not attached to the session get a 403.
- **`/usr/local/bin` vs `/opt/node22`:** check with `check-tools` or `node -v` in the first cloud session that `/usr/local/bin` wins over the default Node 22 PATH entry.
- **Postgres version:** the VM's PostgreSQL 16 doesn't match your PG 17 + pgvector target. Use the `pgvector/pgvector:pg17` image via compose in both local and cloud, so there is one DB definition.

**Docker in cloud: docs vs. an issue report.** Current Anthropic docs list `docker`, `dockerd` and `docker compose` as pre-installed and tell you to "ask Claude to run docker compose up". An earlier GitHub issue (#29515) reported Docker as unavailable. Trust the current docs, but make "start compose, run the RLS integration tests" your first cloud smoke test.

**Limits that shape task choice:**
- Commands wait 2 minutes by default, up to 10 (adjustable with `BASH_DEFAULT_TIMEOUT_MS`/`BASH_MAX_TIMEOUT_MS`).
- The VM "may stop tasks that need significantly more memory."
- Sessions expire after an unpublished idle period. Background work isn't restored when you reopen.

**What to run where:**

| Local terminal | Cloud session |
|---|---|
| Phase planning and gate reviews (you're present) | Well-specified, self-contained checklist items after the phase plan is approved |
| Anything needing AWS SSO, `terraform plan` against real accounts, provider sandboxes | Unit/integration test writing, refactors, lint/type fixes, docs |
| Playwright runs that need a real browser session you watch | CI-failure fixing via Auto-fix on PRs |
| First run of every new hook/permission change | Long test suites you don't want to babysit |

**Keeping local and cloud consistent:**
- **Single source:** everything lives in the repo (`CLAUDE.md`, `.claude/`, `.mcp.json`, `.node-version`, `packageManager`, `.terraform-version`, `PROGRESS.md`).
- **One writer per phase branch at a time.** You asked for one sequential session; keep it that way. Don't let a cloud session and a local session edit the same phase simultaneously.
- **Push before `--cloud`.** `claude --cloud "…"` clones the GitHub remote at your current branch, not your working tree.
- **Moving back.** `claude --teleport` pulls a cloud session and its branch back into your terminal. It needs a clean working tree and the same claude.ai account.
- **Handoff.** Merge cloud branches into the phase branch via PR, and update PROGRESS.md at every handoff.

### 4. GitHub prerequisites

- **Plan:** GitHub Pro on your personal account. Without it, rulesets and branch protection are not enforced on private repos. The alternative is moving the repo to an org on GitHub Team.
- **Ruleset on `main`:**
  - require PR before merge
  - require status checks (lint, typecheck, test, `terraform validate`, gitleaks, commitlint)
  - block force pushes and deletions
  - require linear history
  - optionally require signed commits
  - Give yourself a bypass for emergencies only.
- **Commit signing:**
  - Set up SSH commit signing locally (`git config --global gpg.format ssh`, `user.signingkey ~/.ssh/id_ed25519.pub`, `commit.gpgsign true`) and upload the key to GitHub as a *signing* key. Claude's local commits are then signed by your git config. The `Read(~/.ssh/**)` deny blocks Claude's tools, not git's own use of the agent.
  - Cloud-session commits are made in Anthropic's VM. I could not confirm they can carry your signature.
  - Practical approach: require signed commits only on `main` and squash-merge PRs in the GitHub UI. GitHub signs web merges with its own key; verify that on your first PR.
- **gh CLI:** `gh auth login` with a fine-grained token or OAuth limited to `AyhamJo7/moin` if possible. Run `/web-setup` only if you don't install the GitHub App.
- **Claude GitHub App + `claude-code-action@v1`:**
  - Run `/install-github-app` in a local session. It installs the app and sets the auth secret. You can use `claude setup-token` to generate a subscription token instead of an API key.
  - Minimal PR-review workflow: `on: pull_request: [opened, synchronize]`, `permissions: contents: read, pull-requests: write, id-token: write`, a review prompt that references CLAUDE.md invariants, and `claude_args` with a read-only `--allowedTools` list (`gh pr diff`, `gh pr view`, inline-comment tool).
  - The same App powers Actions, Code Review and cloud Auto-fix.
  - Consistent with your "no AI mentions" rule: the review appears as bot comments, not in commits or PR bodies. Instruct it never to push commits.
- **GitHub Actions ↔ AWS via OIDC:** you create the IAM OIDC provider and roles yourself (it's an EXT gate). Claude writes the Terraform and workflow YAML; you apply the bootstrap.

### 5. Recommended split of responsibilities

| Claude autonomously | Claude with your approval (ask) | Human only |
|---|---|---|
| Read PLAN/BLUEPRINT, write phase plans | `git push` of phase branches | Creating AWS/Twilio/Stripe/OpenAI/Google/Microsoft accounts and orgs |
| Write code, tests, migrations, Terraform, CI YAML | `gh pr create` | Contracts, DPAs, EU-residency enrollment, Twilio regulatory bundles, Stripe activation |
| Run pnpm/turbo/vitest/playwright locally | `terraform plan` (only with a read-only dev role you hand it) | Generating, storing and rotating credentials; putting them in Secrets Manager/GitHub secrets |
| Run local Docker Postgres/Valkey | Adding dependencies (`pnpm add`) | `terraform apply`/`destroy` in any account; bootstrap of state bucket and OIDC roles |
| `terraform fmt/validate`, `init -backend=false` | Network fetches (`curl`) | Merging to `main`; approving phase gates in PROGRESS.md |
| Commit on the phase branch; update PROGRESS.md | Invoking a new MCP server | Provider consoles (Twilio numbers, ConversationRelay config, Stripe webhooks, Cognito/SES production access, DNS) |
| Run reviewer subagents, write gate reports | — | Anything touching production data |

This matches Anthropic's guidance:
- Use `bypassPermissions` only "in isolated environments like containers or VMs". Your committed settings disable it.
- Enforce with permissions, hooks and sandboxing, not instructions.

Relax the "ask" column gradually, for example by allowing `git push` to `phase/*` after P05, once the guard hook has proven itself.

### 6. Local toolchain checklist (no sudo) and cost/model choices

- **Node 24:**
  - Install fnm to your home directory with its install script (`--install-dir ~/.local/share/fnm --skip-shell`, then add it to your shell rc). Run `fnm install 24 && fnm default 24` and commit `.node-version` = `24`.
  - Set `engines.node: ">=24 <25"` plus `engine-strict=true` in `.npmrc`, so a stray Node 22 fails loudly.
  - Corepack's bundling in future Node versions is version-dependent. Pin `"packageManager": "pnpm@10.x.y"` in `package.json`, and fall back to `npm i -g pnpm@10` (goes into fnm's prefix, no sudo) if corepack isn't available.
- **pnpm 10:** `corepack enable && corepack prepare pnpm@10 --activate`, then `pnpm -v`.
- **Docker:** confirm `docker compose version` works without sudo (docker group or rootless). Claude's sandbox is incompatible with `docker`; the docs say to add `docker *` to `excludedCommands` if you enable sandboxing.
- **Terraform without sudo:**
  - `git clone --depth=1 https://github.com/tfutils/tfenv.git ~/.tfenv`, add `~/.tfenv/bin` to PATH, commit `.terraform-version`, then `tfenv install`.
  - Or download the zip from releases.hashicorp.com into `~/.local/bin`.
- **AWS CLI v2 without sudo:** the official installer accepts `--install-dir ~/.local/aws-cli --bin-dir ~/.local/bin`. Configure IAM Identity Center profiles:
  - `moin-dev-readonly`: the only profile Claude may ever use, and only when you hand it over.
  - `moin-dev-admin` and `moin-prod-admin`: yours only.
  - Never set `AWS_PROFILE` globally in the shell you launch Claude from.
- **gh:** a user-local binary is fine; `gh auth login`, `gh auth status`.
- **jq, gitleaks:** static binaries into `~/.local/bin`.
- **Optional Claude sandbox:**
  - It needs `bubblewrap` and `socat`, and the documented install is `sudo apt-get install`. On Ubuntu 24.04+, AppArmor may also need a sudo-level profile.
  - Without sudo you likely can't enable it. The docs say it then "runs commands without sandboxing" unless `sandbox.failIfUnavailable` is set.
  - So hooks plus permissions are your main line of defense locally. That is a key reason to keep AWS credentials out of Claude's reach.
- **Claude plan:**
  - A multi-week, phase-by-phase build with Opus-heavy planning and reviews realistically needs a Max plan. Pro works for lighter use.
  - Cloud sessions and GitHub Action runs using your subscription token draw from the same limits as local use.
  - Check `/usage` daily in the first week to calibrate.
- **Model:**
  - Use `opusplan` for phase work (Opus plans, Sonnet executes), and `model: opus` on the two reviewer subagents.
  - The model-config docs note each model has its own prompt cache, so switching models (including every plan-mode toggle under `opusplan`) re-reads the conversation uncached. Switch at task boundaries, not mid-thought.
  - Julian Goldie and MIXED News both quote the Claude Code v2.1.280 changelog (22 September 2026) as making Opus 5.5 (`claude-opus-5-5`) "now the default Opus model" and moving Pro and Team Standard defaults from Sonnet to Opus, "matching Max, Team Premium, and Enterprise" (I did not open the changelog itself). Pin the model in `~/.claude/settings.json` rather than relying on defaults.

### 7. The kickoff prompt

Design principles:
- **Scope:** exactly one phase.
- **Order:** plan before code.
- **Definition of done:** evidence IDs.
- **Stops:** explicit stop conditions (gate, EXT dependency, ambiguity, failing invariant).
- **State:** ledger updates as the only memory.
- **Boundaries:** limits repeated from CLAUDE.md, because a prompt carries more weight than background context.
- **One session per phase:** start the next phase with `/clear` (local) or a new cloud session and `/phase P03`.

**Example kickoff prompt (paste in a local session started with `claude --permission-mode plan`):**

```text
We are building moin, defined by PLAN.md (phases P00–P33) and BLUEPRINT.md. P00–P01 are complete per PROGRESS.md. Your scope for this session is P02 ONLY.

1. Orient (read-only):
   - Read CLAUDE.md, PROGRESS.md, the P02 section of PLAN.md, and only the BLUEPRINT.md sections P02 references. Do not read other phases except to check a dependency P02 names.
   - Run `git status`, `node -v`, `pnpm -v`, `docker compose version`, `terraform -version` and report mismatches with the pinned versions (Node 24, pnpm 10).

2. Plan (still in plan mode):
   - Write docs/phases/P02-plan.md containing:
     a) every P02 checklist item → its evidence ID → the exact verification command or artifact that will prove it;
     b) files/packages you expect to create or change;
     c) every EXT/founder dependency, labeled EXT, with the exact thing you need from me;
     d) risks to invariants (secrets, prod data, tenant isolation/RLS, region pinning) and how you'll test them;
     e) the commit sequence (Conventional Commits, small).
   - Then STOP and wait for my approval. Do not edit any other file yet.

3. Execute (after I approve and switch you out of plan mode):
   - Create branch phase/p02-<slug>. Work item by item in plan order.
   - After each item: run its verification, record the evidence ID in PROGRESS.md (command, exit code, short output summary or artifact path, commit SHA), and commit.
   - If a verification fails twice with different fixes, stop and report instead of trying a third approach.
   - Never run terraform apply/destroy, never use real provider credentials, never read .env/tfvars/credential files, never push. I push.

4. EXT gates:
   - When you reach an item that needs an account, credential, contract, console action or prod change, do not stub it as done and do not work around it.
   - Add it to PROGRESS.md under "Blocked on founder" with precise instructions for me.
   - Mark the item BLOCKED-EXT, and continue with the remaining items that don't depend on it.

5. Gate:
   - When all non-blocked items have evidence, run lint, typecheck, unit tests, and terraform validate if infra changed.
   - Then run the security-reviewer and architecture-reviewer subagents on `git diff main...HEAD`. Fix their high/critical findings or list them as open.
   - Write docs/phases/P02-gate.md summarizing evidence status (VERIFIED / BLOCKED-EXT / OPEN).
   - Update PROGRESS.md with "P02: GATE READY — awaiting founder review", commit, and STOP. Do not begin P03 under any circumstances.

6. Stop immediately and ask me if: PLAN.md and BLUEPRINT.md conflict, a checklist item is ambiguous, an invariant would have to be weakened, or you need a tool/permission you don't have.

Report format at every stop: what was done, evidence recorded, what's blocked on me, and the exact next step.
```

**Session hygiene:**
- For a long phase, run `/handoff` then `/clear` and resume with "Continue P02 from PROGRESS.md".
- Move to the cloud only for items already fully specified in `P02-plan.md`, using something like `claude --cloud "Execute items P02-4..P02-6 from docs/phases/P02-plan.md; follow CLAUDE.md; stop at the end of item 6"`.

## Recommendations — Prioritized Checklist

### Must do before kickoff
1. Upgrade to GitHub Pro. Create the `main` ruleset (PR required, status checks, no force-push/deletion, linear history).
2. Install locally without sudo: fnm and Node 24, pnpm 10 via corepack, tfenv or Terraform in `~/.local/bin`, AWS CLI v2 in `~/.local`, gh, jq, gitleaks. Commit `.node-version`, `.terraform-version` and the `packageManager` field.
3. Commit `CLAUDE.md` (skeleton above), `PROGRESS.md` (ledger with P00–P01 marked done and a "Blocked on founder" section), and `env.example`.
4. Commit `.claude/settings.json` (above) and the guard/format/session-start hooks. Test them on a throwaway branch:
   - ask Claude to `cat .env` (should be blocked);
   - try `git -C . push` (should be blocked by the hook);
   - commit with "Claude" in the message (should be blocked).
5. Commit the `/phase`, `/verify-evidence`, `/gate-ready` and `/handoff` skills with `disable-model-invocation: true`, and the `security-reviewer`/`architecture-reviewer` subagents.
6. Add git `commit-msg` (commitlint + no-AI regex) and pre-commit gitleaks. Add CI jobs for lint, typecheck, test, gitleaks and commitlint.
7. Set up SSH commit signing and `gh auth login`.
8. In `~/.claude/settings.json`: set your model (`opusplan`) and confirm attribution is off. Keep no project-critical config there.
9. Make sure no AWS profile is exported in the shell you launch Claude from. Keep provider credentials out of the repo tree entirely.

### Nice to have (first week)
1. Install the Claude GitHub App on `AyhamJo7/moin` only. Add a `claude-code-action@v1` PR-review workflow with read-only tools.
2. Create the "moin" cloud environment (Custom network plus `registry.terraform.io`, the setup script above). Run a smoke test: Node 24, pnpm install, compose up with PG17 + pgvector, RLS tests.
3. Add the HashiCorp Terraform MCP server locally, registry-only and version-pinned.
4. Add path-scoped `.claude/rules/` for `infra/**`, `packages/db/**` and `apps/web/**`.
5. Add an `evidence-auditor` subagent and run `/verify-evidence` before every gate.

### Later phases
1. Before infra phases: create an IAM Identity Center read-only dev role. Allow Claude to run `terraform plan` with it only when you hand over the profile explicitly. Bootstrap the state backend and GitHub OIDC roles yourself.
2. Before Stripe/Twilio/OpenAI phases: you create test-mode/sandbox keys and store them in Secrets Manager/GitHub secrets. Claude writes code against env-var names and recorded fixtures. Consider Stripe MCP only in test mode with an Agent-tagged restricted key.
3. Once the guard hook has a clean track record: move `git push` of `phase/*` branches from ask to allow, and try cloud sessions for well-specified items.
4. Revisit parallel sessions or worktrees only after single-session phase execution is boringly reliable.

## Caveats

- **Version-dependent behavior.** Claude Code ships fast; the docs cite features gated on specific versions (e.g. v2.1.198 removing the `/agents` wizard, v2.1.211 changing where approvals save). Re-verify permission and hook behavior after upgrades. Past bugs (#6699, #24846) show deny rules have failed before.
- **Unverified items:**
  - the boolean `"attribution": false` form (cited to the v2.1.281 changelog, but it breaks the settings file on v2.1.280 and earlier);
  - whether cloud-session commits can be signed;
  - the exact idle-expiry time of cloud sessions;
  - whether sandboxing can work without sudo on your machine;
  - the current default model on your plan.
- **Cloud resource figures are approximate.** Anthropic describes them as ceilings that "may change over time." Setup-script caching timings (about five minutes, about seven days) are stated as "roughly."
- **Docker in cloud.** Anthropic's current docs and an earlier GitHub issue conflict on Docker availability. Confirm with a smoke test before relying on cloud for DB-backed tests.
- **Twilio and library-docs MCP servers were not researched in depth.** The "avoid"/"optional" verdicts rest on least-privilege reasoning, not on reviews of those specific servers.
- **Prompt injection is the residual risk.** Any fetched web page, issue text, or MCP tool output can carry instructions. Keeping credentials out of Claude's reach and enforcing with hooks limits the blast radius even if Claude is misled.
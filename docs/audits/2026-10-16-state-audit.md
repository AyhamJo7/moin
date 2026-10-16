# KlarDesk / moin — Full State Audit and Next-Step Roadmap

**Audit date:** 2026-10-16 · **Audited revision:** `origin/main` = `993ea23` ("feat(p33): SELL exit gate with discrete gaps (#226)")
**Mode:** read-only. Nothing was merged, deleted, pushed, deployed or created. No secrets were read.
**Sources:** live `git` (after `git fetch --prune`), GitHub API via `gh`, `PLAN.md` via `plan_section.py`, `PROGRESS.md`, `docs/evidence/` (+ `evidence.py check`), the source tree of `origin/main`, Docker and process state on this machine.

Evidence labels used below: **VERIFIED** = observed in this session with the command named; **UNVERIFIED** = reported in a repo document or note but not re-checked; **ESTIMATE** = audit judgement, method stated.

---

## 1. Executive Summary

**Where the project is.** The repository has a genuinely strong foundation: a governed monorepo with 14 CI gates, a hardened multi-tenant Postgres core (FORCE RLS, role split, hash-chained audit, 76 migrations, 68 tables), a real OIDC/session/RBAC/step-up/CSRF stack, a full core business data model (contacts, conversations, tasks, leads, requests, notes/facts, merge/unmerge, search) and a knowledge system at the database layer, plus a Twilio ConversationRelay adapter with signature validation. That work (PRs #1–#117, roughly) is substantive: hundreds to thousands of lines per PR, with real-Postgres integration tests and mutation checks.

**What changed in the last 25 hours, and why the PR count misleads.** PRs **#107–#226 (120 PRs) were merged between 2026-10-15 02:33 UTC and 2026-10-16 03:27 UTC**, about one every 12 minutes. From #118 onwards almost every PR adds **25–160 lines of pure TypeScript ("shapes") plus a unit test**. Nothing imports them: **92 product source files (6,551 LOC) are unreachable from any runtime entrypoint**. Another 25 tooling/test-support files are also unimported, but that is legitimate. Examples (VERIFIED by reading the code):

- `feat(p17): WAF rule shapes` returns a hard-coded array. No WAF exists.
- `feat(p05): terraform foundation shapes` adds three `.gitkeep` files and a TS list of module names. There are zero `.tf` files.
- `feat(p33): SELL exit gate` is a boolean aggregator over inputs nobody supplies.
- `feat(p13): today aggregation`: the owner web app is still one placeholder page reading "Die Owner-App entsteht in Phase P13."
- The voice runtime still runs the **P04 latency-measurement script**. The P11/P12 reception-flow modules (greeting, intent routing, FAQ answer, capture loops, outcome writer, call state machine) are not imported by any production code.

**The governance records disagree with each other and with the code.**

- The **Status Ledger** shows P08–P33 as `NOT_STARTED`. That understates the code that exists, but it is closer to the truth about completion.
- **`PROGRESS.md`** marks **at least 267 items `READY_FOR_REVIEW`** (count from the parseable rows), including items whose own notes say the loaders, wiring and E2E test "ride separately". Example: P13.02.04 is _"E2E test: a simulated call appears in the right section within 60 s"_, and no such test or page exists. This breaks PLAN's "no fake completion" rule.
- The EXT table shows all 28 external gates `NOT_STARTED`. In reality EXT-09 (AWS) is `IN_PROGRESS` and EXT-24 (GitHub rulesets) is satisfied.
- 264 of 325 evidence records have no CI link and 246 have no reviewer.
- None of the ~100 sensitive-area PRs after P06 got the mandatory **QG-09** second review. These cover webhooks, tool guard, RLS tables, privacy handlers and booking.

This is the one place where PLAN, status and evidence disagree materially. It does not stop the audit, but it must be fixed before more work lands on top (§24, Mission 0).

**What is missing.**

- Infrastructure: no Terraform, no staging, no production.
- Async runtime: no SQS consumer, no dispatcher, no SSE endpoint, no Valkey client.
- No working call flow and no owner UI.
- No AI on the call path, and no eval datasets (`evals/` is empty).
- Notification senders, billing and onboarding are not built.
- **Every external gate except EXT-24**:
  - no lawyer engaged;
  - no entity registration confirmed;
  - the Twilio account is suspended pending an identity/use-case reply;
  - the OpenAI account shows no EU data-residency option;
  - no domain or brand decision;
  - no insurance;
  - the Gurlitt cooperation is unconfirmed.

  The Twilio and OpenAI facts come from uncommitted notes dated 2026-10-15 (UNVERIFIED).

**Biggest bottlenecks, in order:**

1. **External long-lead items that have not started.** Legal stage A, entity, Twilio, LLM residency, insurance, Gurlitt and domain all take weeks and only you can start them.
2. **Pilot-tier engineering.** About 40% of the work exists in some form, under 1% is founder-verified, and roughly 6–10 calendar weeks of real wiring and verification remain.
3. **Your review queue.** QG-09 verdicts for §§1–13, tier verdicts for P02/P06/P07, and 120 PRs merged without a second review.

**Is engineering still the main bottleneck?** For the next 3–4 weeks, partly. A lot of truthful engineering can still be built without anyone else. But the external chain has longer lead times and has not started, so from roughly mid-November it becomes the bottleneck unless you start it this week.

```text
Merged PRs:                    219 merged / 226 total (7 closed unmerged, 0 open) — VERIFIED (gh)
Engineering implementation:    ~30% item-weighted (299/995), ~21% effort-weighted (33/157 PLAN eng-days) — ESTIMATE, range 25–38%
Evidence-verified engineering: 0.7% founder-VERIFIED (7/995); 13% evidence-ticked at agent ceiling (132/995)
Overall roadmap:               ~27% work-weighted (≈320/1,202 items); 11.8% ticked (142/1,202); 0.6% VERIFIED (7/1,202)
Pilot readiness:               0 of 4 pilot gates (PG-0…PG-3); PILOT engineering ~40% implemented, 0.9% VERIFIED; 1/16 pilot EXT gates satisfied
MT-LIVE readiness:             0% by gates; ~35% of cumulative work implemented
Paid Early Access readiness:   0% by gates; LAUNCH-tier engineering ~8%; billing (P23) 0%
P33 / FULL SELL-READY:         literal P33 checklist 0/10; SR criteria 0/61; dependency-adjusted ~27% work / ~11% ticked / ~0.6% VERIFIED
```

---

## 2. Verified Repository State

| Fact                                                  | Value                                                                                                                                                                                 | How verified                                                   |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Git control checkout (owns `.git` for every worktree) | `~/projects/business/moin` — the **main working tree**, on branch `feat/p06-13-xsuite` @ `2f94b9e` (merged as PR #48); untracked `.omo/` (OpenCode run-continuation files, 76 KB)     | `git rev-parse --git-common-dir` = `.git`; `git worktree list` |
| Worktree with `main` checked out                      | `~/projects/business/moin-main` @ `5e13939` (#60) — **165 commits behind `origin/main`**, clean                                                                                       | `git rev-list --count main..origin/main`                       |
| `origin/main`                                         | `993ea23` (#226), linear history                                                                                                                                                      | `git log --first-parent`                                       |
| CI on `origin/main`                                   | `verify`, `security-scan`, `container-scan`: **success** on `993ea23` (2026-10-16 03:27 UTC)                                                                                          | `gh run list --branch main`                                    |
| Branch protection                                     | Ruleset `main-protection` active: deletion, non-fast-forward, pull_request, required status checks, linear history (EXT-24 satisfied)                                                 | `gh api …/rulesets`                                            |
| Repo settings                                         | **public** (proprietary licence), `allow_auto_merge=false`, `delete_branch_on_merge=false`; **Dependabot alerts disabled, secret scanning disabled**, no code scanning                | `gh api`                                                       |
| PRs                                                   | 226 total: **219 merged, 7 closed unmerged** (#17, #20–#24 negative controls, #94 superseded by #95), **0 open, 0 draft**; all merged by `AyhamJo7`                                   | `gh pr list --state all`                                       |
| Merge velocity                                        | #1–#106 over 2026-09-28 → 10-15; **#107–#226 in ~25 h** (10-15 02:33 → 10-16 03:27 UTC)                                                                                               | merge timestamps                                               |
| Registered worktrees                                  | **310** = 1 main + 309 linked: **141** `moin-*` dirs in `~/projects/business`, **168** under `moin/.claude/worktrees/`; 0 detached, 0 locked, 0 prunable, 0 missing                   | `git worktree list --porcelain`                                |
| Unregistered `moin*` entries                          | `moin-sessions/` (root-owned Docker bind-mount dirs, **empty**), `moin-merge-order.md` (2026-10-15 notes)                                                                             | `ls`, `comm`                                                   |
| Dirty worktrees                                       | 53 (main + 52 linked). **51 linked worktrees hold the same uncommitted control-plane test fix** (identical diff hash + identical untracked file). 3 hold unique notes (§15).          | `git status --porcelain` per worktree                          |
| Unpushed commits                                      | **None.** Every worktree HEAD equals (186), is contained in (117) or is an ancestor of `main` (5) a merged PR head; 2 carry one **pushed** docs-only commit not in `main`             | `merge-base --is-ancestor` vs every PR `headRefOid`            |
| Local branches                                        | 338: 194 = merged PR head, 122 contained in a merged PR head, 19 in `main`, 2 merged + 1 pushed docs commit, **1 local-only safety ref** `backup/p06-10-audit-pre-normalize-20260930` | same method                                                    |
| Remote branches                                       | 217: `main` + 216 merged (197 exact, 5 in main, 12 stacked branches whose extra commits are all patch-equivalent to `main`, 2 with one docs-only commit not in `main`)                | patch-id comparison                                            |
| Stashes / tags                                        | **26 stashes** (shared repo), 0 tags                                                                                                                                                  | `git stash list`, `git tag`                                    |
| Per-worktree gate evidence                            | **302 `.git/worktrees/*/claude-evidence/` dirs, 9,337 files, 133 MB** — cited by EV records; deleted by `git worktree remove`                                                         | `find`, `du`                                                   |
| Disk                                                  | `moin/.claude/worktrees` 14 GB; `moin-*` dirs ≈ 4.3 GB; `.git` 218 MB                                                                                                                 | `du`                                                           |
| Live agent sessions                                   | tmux `claude`, `codex`, `opencode`, `agy` running (`--dangerously-skip-permissions` / `--yolo`); one Claude process has cwd `.claude/worktrees/feat-p33-sellgate`                     | `tmux ls`, `/proc/<pid>/cwd`                                   |
| Local stack                                           | Docker up: `moin-postgres/sqs/oidc/valkey/mail/s3` healthy; Node 24.21.0 + pnpm present under nvm (shell default is Node 26)                                                          | `docker ps`, `ls ~/.nvm`                                       |
| Local gates this session                              | **Not run** (audit is read-only; CI on `993ea23` is the verification of record). SessionStart reports `gates full` STALE/FAIL @ `2f94b9e` (old branch).                               | —                                                              |

**Code inventory of `origin/main`** (VERIFIED by tree inspection):

| Item                          | Value                                                                                                                                                                                                                                              |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Migrations / tables           | 76 / 68 (40 created via `apply_tenant_rls`, ~14 more with explicit FORCE RLS in 0062–0076)                                                                                                                                                         |
| Non-test TS files / LOC       | 320 / ~37,250. **92 product files / 6,551 LOC unreachable** from `main-*.ts`, web pages, db CLI or scripts. A further 25 tooling/test-support files (lint fixtures, xsuite helpers, Next config/middleware, vitest setup) are unimported by design |
| Tests                         | 252 test files, 72 integration (real Postgres)                                                                                                                                                                                                     |
| HTTP surface                  | 19 routes: auth (4), members (5), recovery (3), support (3), voice (2), health (2) + the ConversationRelay WebSocket. **No route for contacts, tasks, leads, knowledge, events (SSE) or settings.**                                                |
| Web app                       | 1 placeholder page; 13 pure helper modules in `apps/web/lib` that nothing imports                                                                                                                                                                  |
| Infrastructure                | **0 Terraform files** (`infrastructure/terraform/{bootstrap,envs,modules}/.gitkeep`)                                                                                                                                                               |
| `evals/`, `templates/`        | empty                                                                                                                                                                                                                                              |
| `@moin/contracts`, `@moin/ui` | placeholder `PACKAGE_NAME` exports only; CI "OpenAPI and client drift" job is a **reserved no-op**                                                                                                                                                 |
| External SDKs/clients         | none for SQS, Valkey/Redis, S3, SES, SMS, Stripe or Bedrock; OpenAI adapter via `fetch` exists but is unwired                                                                                                                                      |
| Voice runtime                 | inbound webhook → number→tenant resolution → disclosure TwiML → WebSocket session running the **P04 measurement script**; session tokens and CallSid dedup **in memory** (single instance only)                                                    |
| Evidence registry             | 325 records; `evidence.py check`: 324 OK, 1 STALE (EV-P06-054 cites a commit absent from the repo), **264 "CI run pending", 246 "Reviewer pending"**                                                                                               |

---

## 3. Completion Methodology

**Source of truth for the denominator:** PLAN.md checklist items `Pxx.yy.zz` (parsed: **1,202 items in 359 sections**, P00–P33). Each item is classified by keyword into:

| Class      | Count | Meaning                                                   |
| ---------- | ----- | --------------------------------------------------------- |
| `eng`      | 909   | code/doc work an engineer or agent can do                 |
| `infra`    | 101   | engineering that needs AWS/staging/production to exist    |
| `provider` | 33    | needs a provider console or real network                  |
| `human`    | 159   | founder, lawyer, customer, insurer, tax adviser, sign-off |

Classification is a keyword heuristic, ±10%. P00 (planning) and P01 (founder discovery) are excluded from the engineering denominator, leaving **995 engineering-owned items**.

**Numerators. Four levels, reported separately and never mixed:**

1. **Founder-VERIFIED.** Recorded `VERIFIED` in PROGRESS with founder authorisation: 7 items (P06.05.04, P06.06.01–.03, P06.09.03, P06.10.06, P06.10.07).
2. **Evidence-ticked.** `- [x]` in PLAN with an EV ID, which is the agent ceiling `READY_FOR_REVIEW`. 142 items in total, 132 of them engineering items in P02/P03/P04/P06.
3. **Implemented (ESTIMATE).** The share of a phase's engineering items whose deliverable exists in code. It is graded per phase by reading the merged PRs and the code:

   | Depth  | Meaning                                                 | Credit                                 |
   | ------ | ------------------------------------------------------- | -------------------------------------- |
   | **L3** | wired into a runtime entrypoint, integration-tested     | 1.0                                    |
   | **L2** | migration + services + real-Postgres tests, not exposed | ≈0.5–0.85 depending on what is missing |
   | **L1** | pure "shape" function + unit test                       | ≈0.05–0.3                              |
   | **L0** | nothing                                                 | 0                                      |

   The per-phase fractions are in §5.

4. **"Some code exists in the section".** An upper bound only, not completion: 642 of 1,043 non-human items sit in sections touched by at least one PR.

**Weighting.**

- Item-weighted: every item counts 1.
- Effort-weighted: each phase's implemented fraction × PLAN's own engineering-day estimate for that phase. That total is 157 eng-days for P02–P33; P32 is counted as 2 eng-days.

PLAN's day estimates are optimistic ("solo + agents"), so the effort-weighted figure is a floor on the remaining calendar time, not a forecast.

**Uncertainty.** The implemented percentage depends on the L1/L2 credits. Using L1 = 0.05–0.35 and L2 = 0.6–0.9 gives **25–38%** engineering implemented. Ticked and VERIFIED counts are exact, because they are counted rather than judged.

**Gate-based readiness** is counted directly against PLAN's gate tables, with no percentages:

| Gate set            | Count                                               |
| ------------------- | --------------------------------------------------- |
| PG pilot gates      | PG-0…PG-7 (8)                                       |
| Launch gates        | LG-V01…V14, LG-B01…B04, LG-I01…I05, LG-P01…P18 (41) |
| External gates      | EXT-01…EXT-28 (28)                                  |
| Founder decisions   | DG-00…DG-14 (15)                                    |
| Sell-ready criteria | SR-01…SR-61 (61)                                    |
| Readiness states    | 8                                                   |

A gate counts as met only with evidence on the required environment.

---

## 4. Project Completion Dashboard

| Metric                                        | Numerator / denominator                                                                                            | Value                   | Basis                                                |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ----------------------- | ---------------------------------------------------- |
| **A. Engineering implementation**             | 299 / 995 engineering items                                                                                        | **~30%** (range 25–38%) | ESTIMATE, item-weighted, depth-credited              |
| A′. same, effort-weighted                     | 33.2 / 157 PLAN eng-days                                                                                           | **~21%**                | ESTIMATE                                             |
| A″. code exists somewhere in the section      | 642 / 1,043                                                                                                        | 62%                     | upper bound, **not** completion                      |
| **B. Evidence-verified engineering** (strict) | 7 / 995                                                                                                            | **0.7%**                | founder-VERIFIED                                     |
| B′. evidence-ticked (RFR, agent ceiling)      | 132 / 995                                                                                                          | 13.3%                   | PLAN ticks with EV IDs                               |
| B″. ticked + evidenced-but-unticked P07       | ~179 / 995                                                                                                         | ~18%                    | P07 has EV-P07-001…018, no ticks                     |
| **C. Overall roadmap (P00–P33, all classes)** | ≈320 / 1,202                                                                                                       | **~27%**                | work-weighted (eng credit + P00 ticks + human ticks) |
| C′. ticked                                    | 142 / 1,202                                                                                                        | 11.8%                   | exact                                                |
| C″. VERIFIED                                  | 7 / 1,202                                                                                                          | 0.6%                    | exact                                                |
| C‴. gates met                                 | readiness 0/8 · PG 0/8 · LG on a release 0/41 · EXT 1/28 (+1 partial) · DG with a recorded decision 0/15 · SR 0/61 | —                       | exact                                                |

**D. Go-to-market readiness ladder**

| State                                                                         | Work implemented                                                                          | Verified                 | Gates                                     | Verdict         |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------ | ----------------------------------------- | --------------- |
| Local engineering-ready (call → task → owner view runs locally on simulators) | PILOT engineering ~40%                                                                    | <1%                      | no end-to-end path exists                 | **not met**     |
| Staging-ready                                                                 | IaC 0%; AWS org exists (5 accounts, Identity Center, budget alerts; SCPs/SES/quotas open) | —                        | P05 0/54 items                            | **~5%**         |
| Pilot-ready (PG-3)                                                            | ~36% of pilot-tier work (296/830)                                                         | 7/772 PILOT items (0.9%) | PG-0…PG-3: 0/4; LG-V 0/14; pilot EXT 1/16 | **not ready**   |
| MT-LIVE                                                                       | ~35% cumulative                                                                           | 0                        | P17.13 gate + EXT-18 not started          | **0% by gates** |
| Early Access / paid launch (P26)                                              | ~30% cumulative; LAUNCH tier ~8%; P23 billing 0%                                          | 0                        | EXT-02B/13/19 not started                 | **0% by gates** |
| FULL SELL-READY (P33)                                                         | ~27% cumulative                                                                           | ~0.6%                    | SR 0/61                                   | **0% by gates** |

**E. P33**

- **Literal P33 checklist: 0/10 (0%).** PR #226's `sellGate()` is a helper, not a P33 deliverable. P33 is an evaluation of evidence that does not exist yet.
- **Dependency-adjusted progress toward the P33 exit gate.** This is everything in PILOT through SELL tiers, 1,184 items:
  - ~27% implemented;
  - ~11% evidence-ticked;
  - ~0.6% VERIFIED;
  - 0/61 SR criteria;
  - 0 of the 6 SELL EXTs (EXT-02/03/04/05/08/13).

---

## 5. P00–P33 Phase Matrix

Legend: **Eng impl.** = audit estimate of the phase's engineering items implemented (depth-credited). **Ticked** = PLAN checkboxes with EV IDs. **VER** = founder-VERIFIED items.

| Phase   | Purpose                                    | Ledger status                         | Eng impl.                                              | Ticked / items                | VER | External dependency         | Remaining work                                                                                           | Blocks                              |
| ------- | ------------------------------------------ | ------------------------------------- | ------------------------------------------------------ | ----------------------------- | --- | --------------------------- | -------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| P00     | Planning baseline                          | PILOT RFR                             | n/a                                                    | 10/17                         | 0   | founder adoption            | P00.05 adopt plan, DG-00/DG-09                                                                           | formal baseline                     |
| P01     | Gurlitt observation & SME interviews       | NOT_STARTED                           | n/a (founder)                                          | 0/49                          | 0   | EXT-16                      | whole phase: protocol, 7-day baseline, systems & knowledge inventory, 10 interviews                      | PG-1 → P18                          |
| **P02** | Engineering foundation                     | PILOT RFR                             | **100%**                                               | 50/50                         | 0   | EXT-24 ✓                    | founder tier verdict                                                                                     | —                                   |
| **P03** | ADRs, domain, threat model, data inventory | IN_PROGRESS                           | **~100%** of eng                                       | 29/31                         | 0   | EXT-02                      | P03.07.03/.04 engage counsel                                                                             | EXT-02 A                            |
| **P04** | Feasibility + long-lead track              | IN_PROGRESS                           | ~39% (adapter, signature, token, harness)              | 8/44                          | 0   | EXT-01/07/08/10/11/12/20    | every measurement; DG-01 decision                                                                        | P10–P12 (DG-01)                     |
| P05     | Cloud foundation, walking skeleton         | NOT_STARTED                           | **~2%** (shapes, 0 HCL)                                | 0/54                          | 0   | EXT-09 (org exists)         | all Terraform, CI deploy, skeleton, P05.11 minimal site                                                  | staging and every real-network test |
| **P06** | Tenancy, identity, authZ, audit            | IN_PROGRESS                           | **~76%**                                               | 45/72                         | 7   | EXT-09 (Cognito/WAF)        | Cognito/Terraform halves, operator identity, .03.04 voice integration, **QG-09 §§1–13 founder verdicts** | P07+, MT-LIVE                       |
| **P07** | Core business model                        | IN_PROGRESS (header says NOT_STARTED) | **~85%** DB layer, no API                              | 0/48 (EV-P07-001…018 exist)   | 0   | —                           | tier verdicts; API exposure (P13)                                                                        | P09, P13, P14, P16                  |
| P08     | Async, events, scheduling, realtime        | NOT_STARTED                           | ~50% (tables + pure loops; no SQS/Valkey/SSE endpoint) | 0/39 (PROGRESS claims 39 RFR) | 0   | —                           | transports, dispatcher, sweeps, SSE, middleware, failure injection on real emulators                     | P11, P13.10, P14                    |
| **P09** | Knowledge system                           | NOT_STARTED                           | ~76% DB layer (incl. SSRF-safe import)                 | 0/38                          | 0   | —                           | embeddings provider, PDF (LAUNCH), owner UI                                                              | P10, P12                            |
| P10     | AI orchestration, policy, templates, evals | NOT_STARTED                           | ~30% libraries, unwired; no eval data                  | 0/61 (52 claimed RFR)         | 0   | EXT-12, DG-14, DG-01        | wire into turn pipeline, provider adapter, eval datasets, prompt/template data                           | P12                                 |
| P11     | Telephony platform                         | NOT_STARTED                           | ~26% (webhook/routing/dedup wired; rest shapes)        | 0/74 (65 claimed RFR)         | 0   | EXT-10/11, DG-01            | call machine + finaliser wired, fallback layers, Valkey stores, caps, metering, simulator scenarios      | P12, P23                            |
| P12     | Reception flows + voice eval               | NOT_STARTED                           | ~12% shapes                                            | 0/61 (35 claimed RFR)         | 0   | EXT-20, EXT-12, EXT-10      | whole runtime; LG-V01…V14                                                                                | PG-3                                |
| P13     | Owner web app                              | NOT_STARTED                           | **~8%** (placeholder)                                  | 0/50 (41 claimed RFR)         | 0   | DG-10                       | whole app                                                                                                | PG-2, PG-3, any demo                |
| P14     | Notifications & escalation                 | NOT_STARTED                           | ~27% (tables)                                          | 0/23                          | 0   | SES (EXT-09 + DG-00), DG-12 | senders, timers wiring                                                                                   | PG-3                                |
| P15     | Operations baseline                        | NOT_STARTED                           | ~11% (shapes + runbooks)                               | 0/38                          | 0   | EXT-09                      | OTel/metrics, alarms, canaries, ops CLI                                                                  | LG-P05/P11/P14                      |
| P16     | Privacy, DSAR, AI-Act controls             | NOT_STARTED                           | ~11% shapes                                            | 0/55                          | 0   | EXT-02/04                   | retention engine, export/erasure E2E, disclosure records wiring                                          | PG-0, LAUNCH                        |
| P17     | Prod, security, DR baseline                | NOT_STARTED                           | ~6% shapes                                             | 0/39                          | 0   | EXT-09                      | all infra security, backups, restore drill, WAF, scans                                                   | PG-3, MT-LIVE                       |
| P18     | Pilot readiness & onboarding               | NOT_STARTED                           | ~11% shapes                                            | 0/37                          | 0   | EXT-02/06/11/16             | provisioning CLI, knowledge entry, shadow replay, PG-2/PG-3                                              | P19                                 |
| P19     | Gurlitt controlled pilot                   | NOT_STARTED                           | 0                                                      | 0/20                          | 0   | EXT-16/21                   | 30-day run                                                                                               | P26, SELL                           |
| P20     | Booking core                               | NOT_STARTED                           | ~9% (holds at DB level)                                | 0/35                          | 0   | EXT-14/15/17, DG-02         | calendar adapter, LG-B gates                                                                             | SELL                                |
| P21     | Templates, Handwerk, non-restaurant pilots | NOT_STARTED                           | ~5%                                                    | 0/26                          | 0   | EXT-05/18                   | Handwerk template, pilots                                                                                | MT-LIVE, SELL                       |
| P22     | Team workflows                             | NOT_STARTED                           | ~7%                                                    | 0/14                          | 0   | —                           | whole phase                                                                                              | LAUNCH                              |
| P23     | Billing, metering, entitlements            | NOT_STARTED                           | **0%**                                                 | 0/40                          | 0   | EXT-01/08/13, DG-09         | usage ledger (INV-20), Stripe, entitlements                                                              | P24, P26                            |
| P24     | Customer onboarding                        | NOT_STARTED                           | 0%                                                     | 0/26                          | 0   | EXT-26                      | whole phase                                                                                              | P26                                 |
| P25     | Commercial enablement                      | NOT_STARTED                           | 0%                                                     | 0/36                          | 0   | EXT-02/07/23/25             | AGB/AVV templates, site, pricing                                                                         | P26                                 |
| P26     | Early Access launch gate                   | NOT_STARTED                           | 0%                                                     | 0/12                          | 0   | EXT-02B/13/19               | gate                                                                                                     | P27, P32                            |
| P27     | Email inbox                                | NOT_STARTED                           | ~2%                                                    | 0/34                          | 0   | EXT-14/15, DG-04            | whole phase                                                                                              | SELL                                |
| P28     | Timeline, reply drafting                   | NOT_STARTED                           | ~3%                                                    | 0/16                          | 0   | —                           | whole phase                                                                                              | SELL                                |
| P29     | Integration extensibility                  | NOT_STARTED                           | ~10%                                                   | 0/9                           | 0   | —                           | whole phase                                                                                              | TEN                                 |
| P30     | Security hardening + pentest               | NOT_STARTED                           | ~3%                                                    | 0/16                          | 0   | EXT-19                      | whole phase                                                                                              | SELL                                |
| P31     | Reliability, scale, DR, cost               | NOT_STARTED                           | ~3%                                                    | 0/17                          | 0   | production data             | whole phase                                                                                              | SELL                                |
| P32     | Multi-customer validation                  | NOT_STARTED                           | ~4%                                                    | 0/11                          | 0   | EXT-18/22                   | whole phase                                                                                              | SELL                                |
| P33     | Sell-ready gate                            | NOT_STARTED                           | 0%                                                     | 0/10                          | 0   | every SELL EXT              | evaluation                                                                                               | FULL SELL-READY                     |

**Phases with substantial engineering already in place even though their gate is open:** P02 (complete), P03 (complete bar counsel), P06 (~76%, 7 items VERIFIED), P07 (~85% at DB level), P09 (~76% at DB level), P08 (data layer), P04 (adapter and apparatus). Everything after P11.03 is mostly shapes.

---

## 6. Critical Paths

Durations are ESTIMATES assuming you start the external items this week and one or two agent workstreams run continuously with your reviews.

**To the pilot (PG-3 → P19).** Three chains run in parallel. The pilot starts when the slowest finishes.

| Chain              | Path                                                                                                                                                                                                                                                                                                                                                                                                                                | Estimate     |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| Engineering        | Mission 0 truth reconciliation → vertical slice (simulated call → deterministic capture → task → owner Today view) → P08 runtime → P05 Terraform + your staging apply → P10 gateway (Bedrock or OpenAI EU) + eval datasets → P12 full flows → P13 PILOT views → P14 senders (SES) → P15 alarms + call canary (**≥ 7 consecutive green days, LG-P11**) → P16/P17 PILOT slices (restore drill, WAF) → P18 shadow replay (PG-2) → PG-3 | ≈ 8–11 weeks |
| Voice / real-world | EXT-10 Twilio un-suspended → staging voice endpoint → P04.05 measurements (≥ 50 calls, EXT-20 volunteers) → **DG-01 GO** → number bundle (EXT-11, needs EXT-01 documents) → Gurlitt forwarding test (EXT-26) → real-network matrix (LG-V03 ≥ 150 read-backs, LG-V09 ≥ 500 turns)                                                                                                                                                    | ≈ 6–9 weeks  |
| Legal / commercial | engage counsel (P03.07.03) → EXT-02 stage A + EXT-04 wording + EXT-05 restaurant scripts → must-fix items closed; EXT-06 insurance; EXT-01/08 invoicing ability; Gurlitt agreement + AVV (EXT-16) + P01 observation (PG-1)                                                                                                                                                                                                          | ≈ 5–8 weeks  |

**Realistic pilot start:** early-to-mid December 2026 at the earliest, more likely January 2027. PLAN's "likely" date of 2026-11-16 is no longer achievable.

**To the first paying customer.** Pilot (PG-4: ≥ 30 days, ≥ 50 AI-handled calls, 0 S1) → conversion talk (~day 21) → for **recurring** billing:

- P23 usage ledger + Stripe;
- EXT-13 Stripe live (needs entity + bank);
- EXT-02 stage B documents;
- EXT-19 scoped security test;
- P26 gate.

A one-off pilot invoice only needs EXT-01/08/28 and is possible earlier (PG-0). **Estimate: February–March 2027.**

**To MT-LIVE.** The pilot path plus P17.13 MT-LIVE gate plus EXT-18 (≥ 2 signed non-restaurant pilots with AVVs) plus EXT-05 Handwerk scripts. **Estimate: about 4–6 weeks after the pilot starts.**

**To Early Access (P26).** Every `[G:LAUNCH]` item VERIFIED, plus EXT-19 scoped test (**PLAN said book by 2026-11-01**), EXT-02 B and EXT-13. **Estimate: March 2027.**

**To P33 FULL SELL-READY.** P26 → P27/P28 (email intake needs DG-04 + EXT-14 CASA, which takes 6–12 weeks) → P30 full pentest → P31 → P32 (≥ 300 AI-handled calls across customers, recurring payment settled, 30 days with 0 S1) → P33. **Estimate: Q2 2027.** The CASA assessment and the 30-day production windows cannot be compressed.

---

## 7. Remaining Engineering Work

Grouped into **work packages (WP)** because there are ~700 open engineering items. Each row lists the PLAN sections it closes.

Rules that apply to every row:

- A PR may move items to `READY_FOR_REVIEW` only when the item's **own** acceptance text is met.
- Shapes do not count.
- "QG-09" means the security-reviewer and architecture-reviewer pass plus your verdict. "INV-rev" means invariant-reviewer as well.

### Tier 1 — build now, on the critical path to the pilot

| WP                                      | PLAN IDs                                                                                                           | Depends on                                            | Current                             | Exact remaining deliverable                                                                                                                                                                                                                                                                                                                                                                                        | Effort | Risk                                                                                               | PR now?        | Gates                                         | Proof needed                                                                                                                           |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ | -------------------------------------------------------------------------------------------------- | -------------- | --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| **WP-1 Voice reception runtime**        | P11.04–.08, .10, .12, .15, .16; P12.01–.13; P06.03.04                                                              | P07 ✓, P09 ✓ (DB), P10 port + fake provider ✓         | shapes + measurement script         | Replace the measurement script with: the call state machine; disclosure-first greeting; deterministic capture loops (callback, lead, appointment request) with read-back; verbatim FAQ answers from the approved-retrieval view; escalation; silence and barge-in handling; outcome writer + finaliser (INV-06/19), persisted through P07 services in `withTenant`; Valkey-backed session tokens and CallSid dedup | 8–12 d | High (INV-03/05/06/19 control path). A DG-01 NO-GO changes the transport adapter but not the flows | Yes (stack)    | QG-09 + INV-rev                               | Simulator full-path scenarios (P11.16); FS-01/02/19 failure injection; mutation-check; text-level LG-V01/04/05/11/13/14 on the harness |
| **WP-2 Owner API + contracts**          | P13 API side; P02.06 OpenAPI drift slot; P08.04.01                                                                 | P06 ✓, P07 ✓, P09 ✓                                   | no routes; `@moin/contracts` empty  | Zod DTOs, OpenAPI 3.1, drift check; controllers for Today, Inbox, Customers, Tasks, Leads, Requests, Knowledge (approve/reject), Settings; RBAC guards; Idempotency-Key on mutations; 409 problem types                                                                                                                                                                                                            | 5–7 d  | Medium-high (authZ, isolation)                                                                     | Yes            | QG-09                                         | xsuite 100% coverage of the new routes; RBAC matrix extended; integration tests                                                        |
| **WP-3 Async runtime**                  | P08.02.02/.03, .03.02, .05.01–.03, .07.02, .08.01–.03, .09.01–.02, .10.01–.03, .11                                 | P08 tables ✓                                          | tables + pure loops                 | SQS transport (ElasticMQ locally) in the worker role; outbox dispatcher; inbox processor; timer sweeps; `GET /api/v1/events` SSE with Valkey fan-out + `Last-Event-ID` replay; Valkey rate limiter; flag accessors + kill switches wired; failure injection against the real emulators                                                                                                                             | 5–7 d  | High (idempotency/dispatch)                                                                        | Yes            | QG-09 + INV-rev; licence check for 2 new deps | FS-01/10/14/18 report; 20× stress                                                                                                      |
| **WP-4 Owner web app, PILOT views**     | P13.01–.06, .08–.13                                                                                                | WP-2 (+WP-3 for SSE), DG-10 (PLAN default acceptable) | placeholder page                    | Today, Inbox, Customers, Knowledge approval (needed for **PG-2**), Settings; SSE with polling fallback; a11y floor; CSP/CSRF; PWA; German copy                                                                                                                                                                                                                                                                     | 8–10 d | Medium                                                                                             | Yes            | QG-09 for auth/CSRF                           | Playwright E2E in 3 browsers + mobile; axe; **LG-P13** (call → visible < 60 s) on simulator                                            |
| **WP-5 Terraform foundation + staging** | P05.02–.10 code; P17.03/.04/.05/.08 IaC; web Dockerfile                                                            | AWS org ✓ (apply is founder-only)                     | 0 HCL                               | bootstrap (state bucket, KMS, CI OIDC); modules network/edge (ALB, ACM, WAF)/ecs-service/rds/valkey/sqs/s3/scheduler/ses/kms/observability/backup; `envs/staging`, `envs/production`; plan-on-PR workflow; ECR push; web image                                                                                                                                                                                     | 7–10 d | Medium                                                                                             | Yes (no apply) | security-reviewer recommended                 | `terraform validate`, tflint, trivy config green; your `plan`/`apply` output as evidence later                                         |
| **WP-6 Notifications**                  | P14.02–.04, .06, .08                                                                                               | WP-3, DG-12                                           | tables                              | Email over SMTP (Mailpit) with an SES adapter bound later; SMS adapter (Twilio) bound later; escalation timers on WP-3 sweeps; urgent canary                                                                                                                                                                                                                                                                       | 3–4 d  | Medium                                                                                             | Yes            | QG-09 (integration)                           | LG-P12 locally (P95 < 2 min) with injected faults                                                                                      |
| **WP-7 AI path + eval datasets**        | P10 wiring; P10.02 provider; P10.13; P12.14 harness                                                                | WP-1, DG-14                                           | libraries unwired; `evals/` empty   | NLU turn via the gateway port in WP-1; Bedrock Converse adapter (eu-central-1) and/or OpenAI EU adapter config; synthetic German eval sets at PLAN sizes: intents ≥ 400/template, FAQ ≥ 300, uncertain-FAQ ≥ 150, injection ≥ 200, emergency ≥ 300, interruption ≥ 100, phone-number text set ≥ 600                                                                                                                | 8–12 d | High (tool guard, INV-04/13)                                                                       | Yes            | QG-09 + INV-rev                               | Harness plumbing green on the fake provider. **Real LG-V numbers stay WAITING_FOR_EXTERNAL (EXT-12/DG-14)**                            |
| **WP-8 Privacy, PILOT slice**           | P16 PILOT sections (retention, turn-log policy, disclosure records, subprocessor register, contact export/erasure) | P07 ✓, WP-3                                           | shapes                              | Retention engine as a scheduled job over the real tables; DG-13 default enforced (no caller text); disclosure record written from the call path; export/erasure end-to-end for contacts                                                                                                                                                                                                                            | 5–7 d  | Medium-high                                                                                        | Yes            | QG-09 (privacy handlers)                      | Local half of LG-P10; audit events                                                                                                     |
| **WP-9 Pilot tooling + demo data**      | P18.03, .09, .10; P02.04.02 seed; SR-52/53                                                                         | P06 ✓                                                 | shapes; `db:seed` writes **0 rows** | Real tenant-provisioning CLI over P06.04; kill switch wired to flags; monitoring queue on real data; demo tenants "Musterrestaurant" / "Musterbetrieb SHK"; demo reset                                                                                                                                                                                                                                             | 3–4 d  | Low-medium                                                                                         | Yes            | —                                             | Provisioning idempotency test; seeded demo reproducible                                                                                |

### Tier 2 — build now, removes future blockers

| WP                                             | PLAN IDs                                                                                                                                                                                                            | Deliverable                                                                                                                                                                                                | Effort  | Gates / proof                                                                  |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | ------------------------------------------------------------------------------ |
| **T2-1 Truth reconciliation**                  | Status Ledger, phase headers, PROGRESS, EXT table, README, CLAUDE.md §1                                                                                                                                             | Ledger rows P08–P33 `IN_PROGRESS` with "shapes only" notes; downgrade PROGRESS over-claims; EXT-09 `IN_PROGRESS`, EXT-24 satisfied, EXT-10/12 current facts; README "Greenfield" removed                   | 0.5–1 d | docs-consistency gate; **needs your approval** (it edits several phases' rows) |
| **T2-2 Retroactive QG-09**                     | QG-09 over PRs touching RLS tables 0062–0076, webhooks (#132, #133, #222), tool guard (#124), idempotency/outbox/timers (#108, #110, #113), privacy handlers (#184–#192, #214, #215), upload (#210), booking (#217) | Review findings; HIGH/CRITICAL fixed with mutation-proven tests                                                                                                                                            | 2–3 d   | `/gate-ready`                                                                  |
| **T2-3 Cross-tenant suite catch-up**           | P06.13, LG-P01                                                                                                                                                                                                      | xsuite seeds and probes **10 of ≥ 40 tenant tables** (written before P07/P09). Extend the two-tenant seed and DB probes to every RLS table; add a catalog-driven assertion so new tables cannot be skipped | 2 d     | LG-P01; CI                                                                     |
| **T2-4 Evidence hygiene**                      | Evidence rules                                                                                                                                                                                                      | Back-fill CI run IDs for 264 records from `gh run list`; fix EV-P06-054 stale commit; reviewer fields honest                                                                                               | 0.5–1 d | `evidence.py check` clean                                                      |
| **T2-5 No-orphan rule**                        | P02.02.07                                                                                                                                                                                                           | dependency-cruiser `no-orphans` (or a reachability check) so unwired shapes fail CI; decide wire-or-delete for the 92 orphan product files                                                                 | 0.5 d   | CI                                                                             |
| **T2-6 Control-plane test fix**                | control plane (founder-only)                                                                                                                                                                                        | The 51-copy uncommitted fix stops `test_control_plane.py` copying `.claude/worktrees` (14 GB) into temp fixtures. Write it as `docs/control-plane/patches/0006-*.patch`; you apply it                      | 0.25 d  | `control_plane_check.py`                                                       |
| **T2-7 Restore + migration rehearsal (local)** | P17.06, P31.04, LG-P03/P04 local half, SR-04/05                                                                                                                                                                     | dump/restore with integrity + isolation assertions; expand/contract rehearsal script                                                                                                                       | 2 d     | drill report (local)                                                           |
| **T2-8 Observability in code**                 | P15.01–.02, .06                                                                                                                                                                                                     | OTel traces/metrics with stable names, PII log scanner as a CI gate, call debug timeline over real events                                                                                                  | 2–3 d   | unit + integration                                                             |
| **T2-9 Operator identity**                     | P06.09.01/.02, P06.11.03–.05                                                                                                                                                                                        | Trusted operator identity (Cognito group, bound later) so support reads and recovery deny-new-access work; today support reads are **disabled**                                                            | 3 d     | QG-09 + INV-rev                                                                |
| **T2-10 Load/latency harness**                 | P11.17 local part, P31.06                                                                                                                                                                                           | server-turnaround and API latency harness (local)                                                                                                                                                          | 1–2 d   | report                                                                         |

### Tier 3 — build now via late binding (verification waits for the provider)

| Item                                                                     | PLAN IDs             | Build against                                                | External that verifies it            |
| ------------------------------------------------------------------------ | -------------------- | ------------------------------------------------------------ | ------------------------------------ |
| Bedrock / OpenAI EU adapters                                             | P10.01, P10.02       | recorded contract fixtures, `store:false`, EU endpoint guard | EXT-12 / DG-14 model access          |
| SES adapter + SNS bounce/complaint handling                              | P14.03               | SES v2 API + SNS signature validation                        | EXT-09 SES production + DG-00 domain |
| Twilio SMS, status callbacks, call-log reconciliation client             | P11.06, P11.09, P14  | Twilio REST/webhook docs; signature guard exists             | EXT-10                               |
| Cognito in Terraform + claims mapping                                    | P06.05               | Cognito issuer regex already in config                       | EXT-09 apply                         |
| Usage ledger (INV-20) + Stripe TEST via REST `fetch` (workspace pattern) | P23.01–.06           | Stripe API; HMAC webhook verification                        | DG-09, EXT-13 for live               |
| Number provisioning/admin for Twilio numbers                             | P11.01 admin, P18.03 | number_routes table exists                                   | EXT-11                               |

### Tier 4 — technically possible but premature

| Item                                           | Why wait                                                                                      |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------- |
| P27 email inbox, P28, P29                      | DG-04 is open, EXT-14 needs a final domain and CASA (6–12 weeks), and these are SELL/TEN tier |
| P20 calendar booking beyond the DB-level holds | DG-02 is open; it depends on Gurlitt's systems inventory (P01.03)                             |
| P21 Handwerk template beyond the skeleton      | needs restaurant pilot learnings, DG-03 and EXT-05 Handwerk scripts                           |
| P24/P25 onboarding and commercial content      | needs EXT-02 stage B, pricing decisions and DG-11                                             |
| P30/P31/P32/P33                                | need a full surface, production data, a pentest vendor and customers                          |
| **Any further "shape" PR**                     | adds unreachable code and inflates status; stop until the wiring in Tier 1 catches up         |

### Optimal engineering sequence

**M0** Truth reconciliation + T2-6 patch (½–1 day). Run T2-2 retro QG-09 and T2-3 xsuite in parallel.
→ **M1** Vertical slice: WP-1 deterministic path + minimal WP-2 + WP-4 Today view + WP-9 seed.
→ **M2** WP-3 async runtime.
→ **M3** WP-5 Terraform. You apply staging while M4 runs.
→ **M4** Rest of WP-2 and WP-4.
→ **M5** WP-7 AI path + eval datasets.
→ **M6** WP-6 + WP-8 + rest of WP-9.
→ **M7** T2-7/T2-8/T2-9/T2-10.
→ then LAUNCH tier: P23 ledger + Stripe TEST, P22, P24.

The goal of this order: every buildable PILOT item is done before mid-November, so the external chain is the only thing left.

---

## 8. Engineering Quality Gap Analysis

**R** = repository gap (engineering can fix). **X** = external verification gap (needs a provider, environment, lawyer or customer).

| Rank   | Area                        | Gap                                                                                                                                                                                                                            | Type                                        |
| ------ | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------- |
| **P0** | Telephony / AI              | No reception flow on the call path; measurement script only; INV-05/06/19 not enforced on real calls; AI gateway, policy engine and tool guard unwired                                                                         | R                                           |
| P0     | Owner UX                    | No owner app: the owner cannot see calls or approve knowledge (PG-2)                                                                                                                                                           | R                                           |
| P0     | Async                       | No consumers, dispatcher, sweeps or SSE; notifications cannot be delivered                                                                                                                                                     | R                                           |
| P0     | Tenant isolation            | Adversarial cross-tenant suite covers 10 of ≥ 40 tenant tables. Structural RLS catalog check passes in CI, but PLAN forbids counting RLS without the adversarial suite                                                         | R                                           |
| P0     | Review integrity            | ~100 sensitive-area PRs merged without QG-09; 246 EV records with no reviewer                                                                                                                                                  | R + founder                                 |
| P0     | Governance truth            | Ledger vs PROGRESS vs code disagree (§1)                                                                                                                                                                                       | R + founder                                 |
| P0     | Infra / DR / alerting       | No IaC, staging, backups, restore drill, alarms, canary or WAF                                                                                                                                                                 | R (IaC) + X (apply)                         |
| P0     | Safety logic                | Life-safety lexicon exists but is unwired (INV-13); scripts unreviewed (EXT-05)                                                                                                                                                | R + X                                       |
| P0     | Evals                       | `evals/` empty; LG-V01…V14 unmeasurable                                                                                                                                                                                        | R (datasets) + X (real model, real network) |
| P0     | Privacy                     | Retention, turn-log policy and disclosure records are shapes; DG-13 not decided                                                                                                                                                | R + X (EXT-02)                              |
| P0     | Scaling of voice state      | Session tokens and CallSid dedup are in memory, so only one voice task is possible                                                                                                                                             | R                                           |
| P0     | Demo/test data              | `db:seed` writes 0 rows; no demo tenants                                                                                                                                                                                       | R                                           |
| P0     | Legal/provider              | EXT-02A, EXT-05, EXT-06, EXT-10/11/12, EXT-16, EXT-20, EXT-27, domain                                                                                                                                                          | X                                           |
| **P1** | Billing                     | Usage ledger (INV-20), Stripe, entitlements, caps: 0%                                                                                                                                                                          | R + X (EXT-13)                              |
| P1     | Support/operator tooling    | No operator identity; support reads disabled; ops CLI is a shape                                                                                                                                                               | R                                           |
| P1     | Supply chain                | Dependabot alerts and GitHub secret scanning **off** on a public repo; `renovate.json` present but no Renovate PRs (app likely not installed)                                                                                  | founder setting                             |
| P1     | Information exposure        | `docs/operations/aws-organization-baseline.md` (public repo) lists all five AWS account IDs, root e-mail aliases and the Identity Center portal URL. Not secrets, but they help targeted phishing and account-recovery attacks | R + founder decision                        |
| P1     | Contracts                   | `@moin/contracts` empty; OpenAPI drift CI is a no-op                                                                                                                                                                           | R                                           |
| P1     | Onboarding/commercial       | P24/P25 not started                                                                                                                                                                                                            | R + X                                       |
| P1     | External security           | EXT-19 scoped test not booked                                                                                                                                                                                                  | X                                           |
| **P2** | Scale/DR                    | Cross-region backup copies, game days, SLOs on 30 days of data                                                                                                                                                                 | R + X                                       |
| P2     | Full pentest, ASVS L2       | P30                                                                                                                                                                                                                            | X                                           |
| P2     | Email/timeline/integrations | P27–P29                                                                                                                                                                                                                        | R + X                                       |
| **P3** | Hygiene                     | 92 orphan product files; stale README; PROGRESS front matter stale (still says P09.10, 2026-10-12); 11 stale `moin-server` images (~4 GB); 26 stashes                                                                          | R                                           |

Areas that are **in good shape** (VERIFIED in code and CI):

- tenancy RLS framework and role split;
- OIDC code flow + PKCE, server sessions, membership re-check, step-up MFA, revocation, CSRF;
- RBAC + last-owner trigger;
- hash-chained audit with daily verification;
- Twilio signature validation and single-use session tokens;
- config secrecy (redacted, ARN-based design);
- CI: gitleaks full history, semgrep, trivy fs/image + SBOM, hadolint, licences, e2e + axe, RLS catalog.

---

## 9. What Can Be Tested Today

| Question                                     | Answer                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Run the full product locally?             | **The platform, yes. The product, no.** The Docker stack is up now. `pnpm dev` starts web (:3000) and api (:3001); the voice role runs on its own port. Not started this session (UNVERIFIED locally; CI e2e smoke passes on `993ea23`).                                                                                                                                                                                                                                                             |
| 2. Open the web UI?                          | Only a placeholder home page with German nav links that all point to `/`.                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 3. Workflows that work end to end            | (a) OIDC login against local Keycloak → server session → membership re-check, step-up MFA, sign-out-others. (b) Member invite, disable, remove, transfer ownership; recovery disable/enable/revoke; support grants (grant reads disabled by design). (c) Signed Twilio webhook → tenant resolution → disclosure TwiML → ConversationRelay session running the **measurement script**. (d) DB-level services (contacts, tasks, knowledge, booking holds) **only through integration tests** — no API. |
| 4. Deploy a safe non-production staging now? | **Not from the repo.** No Terraform, no web image, no deploy pipeline. A hand-built deployment would bypass P05/P17 and INV-15/16 practice.                                                                                                                                                                                                                                                                                                                                                          |
| 5. Reach it from another device?             | Only by exposing localhost. Use a private overlay or SSH port-forward to **your own** devices only. Never a public tunnel (`docs/development/twilio-local.md`).                                                                                                                                                                                                                                                                                                                                      |
| 6. Zoom / customer demo?                     | You can screen-share the engineering (login, RBAC, simulator, xsuite, audit chain). **There is no product to demo to a customer yet.**                                                                                                                                                                                                                                                                                                                                                               |
| 7. Real phone call into it?                  | **No.** The Twilio account is suspended (EXT-10), there are no numbers (EXT-11) and no deployed voice endpoint. Even with a sandbox tunnel, a call would only hear the measurement script.                                                                                                                                                                                                                                                                                                           |
| 8. Real authentication?                      | Locally real: Keycloak OIDC with PKCE, real sessions, step-up. Production Cognito is not configured (P05/EXT-09).                                                                                                                                                                                                                                                                                                                                                                                    |
| 9. Multiple test tenants?                    | At DB level yes (P06.04 provisioning function; the xsuite seeds two). No CLI or UI for you, and the seed writes 0 rows.                                                                                                                                                                                                                                                                                                                                                                              |
| 10. Mocked / local-only / provider-stubbed   | Keycloak (for Cognito); ElasticMQ (SQS); S3Mock; Mailpit (SES); the AI gateway "fake" provider; Twilio only via signed webhooks + protocol simulator; no SMS, Stripe, Bedrock/OpenAI or SES; in-memory voice state                                                                                                                                                                                                                                                                                   |
| 11. Unsafe or misleading to demonstrate      | "The AI answers calls"; any shape module presented as a feature; the PG-3 or sell-gate helpers presented as readiness; any real caller or real personal data (INV-16); a public tunnel to a laptop                                                                                                                                                                                                                                                                                                   |
| 12. Required before any public URL           | **DG-00** domain; P05 baseline (VPC, ALB + ACM TLS, WAF, ECS, RDS with the P06 role split, Secrets Manager by ARN, KMS, CloudTrail/GuardDuty); Cognito; P17 PILOT slice (production access policy, 0 critical/high findings); **P05.11 minimal site with Impressum/Datenschutz** before anything public (get the exact obligation from EXT-02 counsel); synthetic data only (INV-16)                                                                                                                 |

---

## 10. Fastest Safe Online Demo Path

**Step 1 — today, €0: see what exists, on your machine only.**

```bash
cd ~/projects/business/moin-main && git pull --ff-only   # or the canonical checkout after cleanup
nvm use && corepack enable && pnpm install --frozen-lockfile
# .env is yours to create (INV-15); start from .env.example (all values are dev fakes)
pnpm preflight && pnpm dev:up && pnpm db:migrate && pnpm dev
```

Open http://localhost:3000 (placeholder) and log in through the api's OIDC flow against Keycloak at :8080. To view it from your phone, use an SSH port-forward or a private overlay network to your own devices. Never bind to `0.0.0.0` or open a public tunnel.

**Step 2 — after Mission M1 (≈ 2 weeks), still local: the first honest demo.**
A simulated German call → disclosure → name, number and reason captured with read-back → task under "Rückrufe" on the Today page within 60 s. You can show this over Zoom, labelled as "simulated call, synthetic data".

**Step 3 — private staging (≈ 3–4 weeks: WP-5 + your apply).**

| Aspect              | Plan                                                                                                                                                                                  |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Environment         | `moin-staging` account (exists), eu-central-1                                                                                                                                         |
| Services            | ECS Fargate ARM: web, api, voice, worker (1 task each); RDS PostgreSQL 17 single-AZ `db.t4g.small`; Valkey small; SQS + DLQs; S3 (SSE-KMS); EventBridge Scheduler                     |
| DNS / TLS           | Requires **DG-00**. `staging.<domain>` in Route 53, ACM DNS-validated cert, ALB TLS 1.2/1.3. PLAN's EXT-07 fallback: a neutral domain until the brand is cleared                      |
| Access              | WAF IP allowlist (your IPs) **and** Cognito login, so it is not publicly usable                                                                                                       |
| Auth                | Cognito user pool for staging, MFA on                                                                                                                                                 |
| Secrets             | Secrets Manager entries referenced by ARN in task definitions (OIDC client secret, Twilio auth token later); KMS CMKs `db/s3/queues/secrets/logs/backup`                              |
| Database            | migrator role runs migrations; `moin_app` runtime role NOBYPASSRLS                                                                                                                    |
| Observability       | CloudWatch logs (30-day), basic alarms to your e-mail; X-Ray/OTel later (WP T2-8)                                                                                                     |
| Test data           | synthetic demo tenants only (INV-16)                                                                                                                                                  |
| Expected cost       | PLAN cost model: **≈ €165/month** staging fixed (+≈ €20 shared). Stop RDS and scale ECS to 0 out of hours to cut it. **Your current AWS budget alert is $10/month — raise it first.** |
| Teardown            | `terraform destroy` on `envs/staging` (staging RDS without deletion protection; take a final snapshot only if wanted)                                                                 |
| Security boundaries | no real personal data; no real customer numbers; Twilio webhooks only through signed endpoints; no tunnels; CI deploy role scoped to staging                                          |

**Step 4 — the first real call (after EXT-10 + EXT-11 + DG-01).**
A Twilio sandbox number points to the staging voice host, and you call it from your own phone. This is the P04.05 measurement run that DG-01 needs.

---

## 11. Founder / Owner Actions

### Decisions only you can make (DG register + governance)

| ID                | Decision                                                                 | PLAN default                                                       | Deadline (PLAN)          | Status                                                                                                                   | Blocks                                     |
| ----------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------ | ------------------------ | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------ |
| **DG-09**         | Operating entity and Stripe account (iQuantum TEST account or a new one) | Gewerbeanmeldung now, UG in parallel                               | **2026-10-16 (today)**   | no record                                                                                                                | invoicing, EXT-11 bundle documents, EXT-13 |
| **DG-14**         | Alternative EU LLM provider                                              | pick one EU-resident option                                        | **2026-10-16 (today)**   | no record. Notes say OpenAI shows no EU-residency option (UNVERIFIED) → **Bedrock eu-central-1** is the practical choice | P10.02, P16.08, all LG-V evals             |
| **DG-00**         | Brand + `.de` domain                                                     | keep KlarDesk if the trademark search is clean; buy the domain now | 2026-10-02 (**overdue**) | no record. SES is blocked on the sending-domain choice                                                                   | P05.11, SES, staging DNS, EXT-14           |
| **DG-10**         | Owner-app visual language                                                | calm, light, high-contrast operational UI                          | 2026-10-12 (**overdue**) | no record                                                                                                                | P13.01                                     |
| **DG-12**         | Urgent notification channels                                             | e-mail + SMS (urgent, capped) at the pilot                         | 2026-10-20               | no record                                                                                                                | P14                                        |
| **DG-13**         | Turn-log / transcript policy                                             | no caller text; redacted 7-day log only with EXT-02 approval       | 2026-10-23               | needs EXT-02                                                                                                             | P16.17, P15.06                             |
| **DG-01**         | Voice stack GO/NO-GO                                                     | GO if P04.05 meets the criteria                                    | 2026-10-09 (**overdue**) | `docs/decisions/DG-01-voice-go-no-go.md`: **NOT TAKEN**, all 5 criteria "not measured"                                   | P11, P12                                   |
| DG-02             | First transactional tool                                                 | calendar at a Handwerk pilot unless Gurlitt's platform has an API  | 2026-11-02               | —                                                                                                                        | P20                                        |
| DG-04             | Email intake path                                                        | the provider most common in interviews                             | 2026-11-16               | —                                                                                                                        | P27                                        |
| DG-11             | Support hours / SLA                                                      | Mon–Fri 09–17 + automatic voice fallback                           | 2026-11-20               | —                                                                                                                        | P25                                        |
| DG-03/05/06/07/08 | positioning, wedge, add-ons                                              | evidence-based later                                               | 11-26 … on trigger       | —                                                                                                                        | later                                      |
| P04.02.01         | Number end user (Gewerbe, UG or customer)                                | with EXT-03 input                                                  | before EXT-11            | —                                                                                                                        | EXT-11                                     |
| P00.05            | Adopt PLAN v1.0.0 (scope, cap, dates vs gates)                           | —                                                                  | week 1                   | open                                                                                                                     | formal baseline                            |

### Reviews and acceptances waiting on you

1. **QG-09 verdicts §§1–13.** Use EV-P06-084, which recommends ACCEPT for 12 sections, §7 conditionally. Nothing in P06 can become VERIFIED until you give these.
2. **Tier verdicts:** P02 PILOT, P06 items, P07 PILOT/LAUNCH/SELL.
3. **Mission M0 approval.** Let one session edit Ledger rows P08–P33, the EXT table and PROGRESS over-claims (T2-1).
4. **Control-plane patches** in `docs/control-plane/patches/` (0001–0004, p06-13 CI) plus the new test fix (T2-6). Draft 0005 "merge grant" is in `moin-awsorg`, uncommitted. Note: the merges are now done, so 0005 is probably moot.
5. **Risk acceptance** for the 120 PRs merged without QG-09: either accept formally or require T2-2 before the code is wired.
6. **GitHub settings:** enable Dependabot alerts, secret scanning + push protection, and "auto-delete head branches"; install the Renovate app (or delete `renovate.json`).
7. **Public-repo exposure:** decide whether `docs/operations/aws-organization-baseline.md` keeps account IDs and root e-mail aliases in a public repo.
8. **Production promotion** decisions come later (PG-3, P26). Nothing is pending today.

### Things to stop doing

- Merging stacks of shape PRs. Two consecutive days of such merges inflated the ledgers without moving any gate.
- Running four autonomous agents with `--dangerously-skip-permissions` / `--yolo` against one repo while cleanup is pending. Park them first (§16 STEP 0).

---

## 12. Accounts, Credentials and Signups

**Where secrets live (project architecture):**

- **Local:** your own `.env`, which only you create (INV-15 workspace rule); `.env.example` values are fakes.
- **Staging and production:** **AWS Secrets Manager**, referenced by **ARN** in ECS task definitions, encrypted with the `secrets` CMK (INV-15).
- **Root, MFA and recovery codes:** your password manager and hardware keys.
- **Never** in the repo, tickets, chat or session prompts.

| ☐   | Provider / service                                 | Why needed                                    | PLAN / EXT       | Account exists?                                                                                             | Credential / config the code expects                                                                                                                                   | Needed by                      | Your action                                                                                                                            |
| --- | -------------------------------------------------- | --------------------------------------------- | ---------------- | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| ☐   | **AWS organisation**                               | hosting, data, identity, e-mail               | EXT-09, P05.01   | **Yes** (org + management/shared/backup/staging/production, Identity Center, budget $10, anomaly detection) | Terraform bootstrap: state bucket, KMS, **CI OIDC role** (GitHub → AWS, no keys)                                                                                       | PILOT                          | Raise the budget for staging (~€200/month); after WP-5, run `terraform apply` for bootstrap + staging; later SCPs via Terraform        |
| ☐   | **Amazon SES**                                     | owner/urgent e-mail, invitations              | EXT-09, P14      | no (sandbox)                                                                                                | verified sending domain, DKIM/SPF/DMARC, configuration set + SNS                                                                                                       | PILOT                          | Decide the sending domain (DG-00 or a subdomain); request production access                                                            |
| ☐   | **Amazon Cognito**                                 | production identity (replaces local Keycloak) | P06.05, ADR-0005 | no                                                                                                          | `OIDC_PROVIDER=cognito`, `OIDC_ISSUER_URL` (validated by regex), `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` (Secrets Manager), `OIDC_REDIRECT_URI`                         | PILOT                          | Created by Terraform; you approve the plan                                                                                             |
| ☐   | **AWS Bedrock (eu-central-1)** — DG-14 alternative | LLM for NLU/wording                           | EXT-12, DG-14    | not enabled                                                                                                 | IAM task role, **no API key**; model-access grants                                                                                                                     | PILOT                          | Enable model access in `moin-staging`; record the model list                                                                           |
| ☐   | **OpenAI EU-residency project**                    | primary LLM per ADR-0012                      | EXT-12           | account exists (Build plan); **no residency option visible** (UNVERIFIED)                                   | EU base URL + API key (Secrets Manager); `store:false` enforced in code                                                                                                | PILOT                          | Open a support ticket for data residency / ZDR eligibility; record the ticket ID, request date, expected date, fallback                |
| ☐   | **Twilio**                                         | voice, SMS                                    | EXT-10           | **created, suspended** pending a use-case/identity reply (UNVERIFIED)                                       | `TWILIO_AUTH_TOKEN` per subaccount (signature validation), IE1 API key/secret; subaccounts `staging`, `production`, `monitor`; geo permissions DE only; usage triggers | PILOT                          | Answer Twilio support; business profile; sign DPA; enable IE1; ask in writing about STT/TTS vendors, regions and retention (P04.10.02) |
| ☐   | **Twilio German numbers**                          | the pilot number(s)                           | EXT-11           | no                                                                                                          | regulatory bundle (documents ≤ 1 year, address in the area code); numbers: staging test, canary, Gurlitt 040, monitor caller                                           | PILOT                          | Needs EXT-01 documents + the number end-user decision                                                                                  |
| ☐   | **Domain registrar + DNS**                         | product domain, mail, TLS                     | EXT-07, DG-00    | no                                                                                                          | Route 53 delegation; ACM validation CNAMEs; SES DKIM CNAMEs; SPF/DMARC TXT                                                                                             | PILOT                          | Trademark quick search (DPMA/EUIPO/WIPO classes 9/35/38/42), buy the domain, delegate DNS                                              |
| ☐   | **Role mailboxes**                                 | support@ security@ privacy@ billing@          | P04.07.03        | no                                                                                                          | mail hosting (provider not specified in PLAN)                                                                                                                          | PILOT                          | Choose a mail host on the new domain; replace the Gmail `+alias` roots                                                                 |
| ☐   | **GitHub**                                         | repo, CI, rulesets                            | EXT-24           | **Yes**, ruleset active                                                                                     | —                                                                                                                                                                      | —                              | Enable Dependabot + secret scanning; Renovate app; auto-delete branches                                                                |
| ☐   | **Stripe**                                         | recurring billing                             | EXT-13, DG-09    | iQuantum account in TEST mode (workspace)                                                                   | secret key + **webhook signing secret** (Secrets Manager)                                                                                                              | LAUNCH                         | After DG-09 + entity + bank: activate live mode                                                                                        |
| ☐   | Google Cloud OAuth                                 | calendar (pilot via test users), Gmail (SELL) | EXT-14           | no                                                                                                          | OAuth client ID/secret; consent screen on the final domain                                                                                                             | SELL (calendar pilots earlier) | Later: needs DG-00 + the P05.11 site; CASA 6–12 weeks                                                                                  |
| ☐   | Microsoft Entra / Partner Center                   | M365 mail/calendar                            | EXT-15           | no                                                                                                          | multi-tenant app; publisher verification                                                                                                                               | SELL (if M365)                 | Later: needs EXT-01                                                                                                                    |
| ☐   | PostHog EU                                         | product analytics                             | EXT-25           | no                                                                                                          | DPA                                                                                                                                                                    | SELL                           | Optional                                                                                                                               |
| ☐   | Security test vendor                               | scoped test, then pentest                     | EXT-19           | no                                                                                                          | contract + scope letter                                                                                                                                                | LAUNCH / SELL                  | **Book now** (PLAN: by 2026-11-01; 2–6 weeks lead time)                                                                                |

**KMS keys** (`db`, `s3`, `queues`, `secrets`, `logs`, `backup`) and the CI OIDC trust are **Terraform-managed**. You don't hand out any secret for them; you approve the plan.

---

## 13. Legal / External / Commercial Actions

| EXT              | What must happen                                                                                                                                                                   | Whom to contact                           | Documents                                                                         | Blocks                                                     | Can engineering continue?                   |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- | --------------------------------------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------- |
| **EXT-01**       | Gewerbeanmeldung (Hamburg), Finanzamt registration, USt-IdNr., Kleinunternehmer decision; UG in parallel. **No public "UG (haftungsbeschränkt)" text before the HRB entry** (A-02) | Gewerbeamt, Finanzamt, notary (UG)        | registration confirmations                                                        | pilot invoice, EXT-11, EXT-13, EXT-15                      | yes                                         |
| **EXT-02 A/B/C** | Data-protection review. A: architecture, processor model, audio/turn logs, disclosure, retention, subprocessors. B: AVV, TOMs, AGB, privacy notices, SLA, Early Access terms       | German data-protection lawyer             | send `docs/legal-briefs/` (product + data flows, questions, disclosure + scripts) | A: **pilot**; B: paid launch                               | yes; P16 builds against PLAN defaults       |
| EXT-03           | Telecom law (TKG/TDDDG, number end-user model, forwarding, transfer, caller ID)                                                                                                    | telecom lawyer                            | written opinion                                                                   | paid launch; **number end-user decision needs it earlier** | yes                                         |
| EXT-04           | AI Act (Art. 50 disclosure wording, Art. 4 literacy, scope)                                                                                                                        | combine with EXT-02                       | wording confirmation                                                              | pilot (wording)                                            | yes                                         |
| EXT-05           | Life-safety + allergen scripts per template                                                                                                                                        | lawyer (+ optional gas utility guidance)  | approved scripts                                                                  | pilot (restaurant), MT-LIVE (Handwerk)                     | yes; deterministic engine waits on the text |
| **EXT-06**       | Cyber + IT professional / financial-loss liability insurance in force                                                                                                              | insurer / broker                          | policies covering SaaS + AI output                                                | **pilot** (before PG-3)                                    | yes                                         |
| EXT-07           | Trademark clearance + domain                                                                                                                                                       | counsel, registrar                        | search result                                                                     | pilot (domain), launch (brand)                             | yes; the brand is config (ADR-0034)         |
| **EXT-08**       | VAT, §14 UStG invoice content, e-invoicing, GoBD, Kleinunternehmer                                                                                                                 | Steuerberater                             | written checklist                                                                 | pilot invoice, launch                                      | yes                                         |
| EXT-09           | AWS org (done), SES production, quotas, SCPs                                                                                                                                       | AWS                                       | —                                                                                 | pilot                                                      | yes                                         |
| EXT-10/11        | Twilio un-suspension, DPA, IE1, numbers                                                                                                                                            | Twilio support                            | business profile, bundle                                                          | pilot                                                      | yes (simulator)                             |
| EXT-12           | OpenAI EU residency / ZDR, or Bedrock                                                                                                                                              | OpenAI support / AWS                      | DPA                                                                               | pilot                                                      | yes (fake provider)                         |
| **EXT-16**       | Gurlitt cooperation: observation, knowledge approval, AVV, forwarding, weekly reviews                                                                                              | Gurlitt owner                             | pilot agreement, AVV, written observation consent                                 | pilot                                                      | yes                                         |
| EXT-17           | Gurlitt reservation-platform API access                                                                                                                                            | platform vendor                           | written permission                                                                | SELL (if DG-02 picks it)                                   | yes                                         |
| EXT-18           | ≥ 2 non-restaurant pilots signed with AVVs                                                                                                                                         | Hamburg businesses (P01.06 introductions) | agreements, AVVs                                                                  | MT-LIVE                                                    | yes                                         |
| **EXT-19**       | Scoped security test (pre-launch), full pentest (SELL)                                                                                                                             | security vendor                           | scope, report reference                                                           | launch / SELL                                              | yes                                         |
| EXT-20           | Consented voice-eval speakers (accents, ages, noise)                                                                                                                               | volunteers                                | written consents; recordings outside Git                                          | pilot                                                      | yes                                         |
| EXT-21           | 30 days of real pilot traffic, ≥ 50 AI-handled calls                                                                                                                               | Gurlitt callers                           | —                                                                                 | pilot → SELL                                               | **cannot be accelerated**                   |
| EXT-22           | First recurring payment settled and reconciled                                                                                                                                     | customer, bank                            | —                                                                                 | COMMERCIALLY VALIDATED                                     | **cannot be accelerated by code**           |
| EXT-23           | Reference / case-study consent                                                                                                                                                     | customer                                  | written consent                                                                   | SELL                                                       | —                                           |
| EXT-25           | PostHog DPA                                                                                                                                                                        | PostHog                                   | DPA                                                                               | SELL                                                       | yes                                         |
| EXT-26           | Customer forwarding configured; carrier cost checked                                                                                                                               | each customer / carrier                   | verification call                                                                 | per customer                                               | yes                                         |
| **EXT-27**       | Subprocessor DPAs + transfer assessments (AWS, Twilio + STT/TTS, LLM, Stripe, PostHog)                                                                                             | providers, counsel                        | DPAs on file                                                                      | **pilot**                                                  | yes                                         |
| **EXT-28**       | Business bank account                                                                                                                                                              | bank                                      | —                                                                                 | pilot invoice, launch                                      | yes                                         |

**Commercial items:**

- Pilot agreement + AVV with Gurlitt (PG-0).
- Pilot minute cap and pilot price (P01.08 inputs).
- Invoicing capability: manual compliant invoices are allowed until Stripe live (EXT-01/08).
- Early Access terms (EXT-02 B) and the ≤ 5-customer cap enforced in code (P26).
- Pricing is configuration (A-04).
- Conversion talk around pilot day 21.
- First payment (EXT-22).
- References (EXT-23).

**Real-world evidence that no code can speed up:**

| Requirement                         | Source |
| ----------------------------------- | ------ |
| 7-day Gurlitt baseline              | PG-1   |
| real-network read-backs ≥ 150       | LG-V03 |
| ≥ 500 real-network turns            | LG-V09 |
| ≥ 7 consecutive green canary days   | LG-P11 |
| restore drill within RTO in staging | LG-P03 |
| alarms fire-drilled                 | LG-P05 |
| 30-day pilot, ≥ 50 AI calls, 0 S1   | PG-4   |
| ≥ 3 real onboardings                | LG-P15 |
| ≥ 300 AI-handled production calls   | SR-56  |
| 30-day SLO window                   | SR-07  |
| 0 S1 in 30 days                     | SR-57  |
| first settled recurring payment     | SR-60  |
| CASA assessment                     | EXT-14 |

---

## 14. Meetings and Human Coordination

All of these come from PLAN, none are invented.

| Meeting                                                        | Purpose                                                             | Prerequisite                                            | Attendees                       | Decisions / documents                                         | Timing                                         | Output / evidence                     |
| -------------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------- | ------------------------------- | ------------------------------------------------------------- | ---------------------------------------------- | ------------------------------------- |
| **Gurlitt kickoff (P01.02.01)**                                | confirm cooperation; phone setup, counts, systems, top call reasons | — (was planned for 2026-09-28; no evidence it happened) | you, Gurlitt owner              | written observation consent (P01.01.05), observation protocol | **this week**                                  | EV-P01-xxx, `docs/pilot/gurlitt-*.md` |
| Gurlitt daily 5-min check-ins (7 days)                         | baseline tally quality                                              | kickoff                                                 | you, staff                      | —                                                             | the week after kickoff                         | PG-1 completeness                     |
| Gurlitt policy + knowledge review                              | sign off the intent policy draft and knowledge facts                | baseline                                                | you, owner                      | P01.04.04 sign-off, knowledge sources                         | +2 weeks                                       | PG-2 input                            |
| **Data-protection lawyer** (with AI Act + life-safety scripts) | EXT-02 A, EXT-04, EXT-05                                            | legal pack ready (`docs/legal-briefs/`)                 | you, counsel                    | engagement letter; stage A opinion                            | **request this week**; opinion 1–3 weeks later | EXT-02 A record (stored by reference) |
| Telecom lawyer (can be the same firm)                          | number end-user model, forwarding, caller ID                        | —                                                       | you, counsel                    | P04.02.01 decision input                                      | within 2 weeks                                 | EXT-03 note                           |
| Steuerberater                                                  | VAT, Kleinunternehmer, invoice content, GoBD, entity path           | —                                                       | you, adviser                    | written checklist                                             | within 1–2 weeks                               | EXT-08                                |
| Gewerbeamt / Finanzamt (online)                                | registrations                                                       | —                                                       | you                             | confirmations                                                 | this week                                      | EXT-01                                |
| Bank                                                           | business account                                                    | EXT-01                                                  | you                             | —                                                             | after EXT-01                                   | EXT-28                                |
| Insurance broker                                               | cyber + IT liability quotes                                         | product description                                     | you, broker                     | policy                                                        | request this week; 1–3 weeks                   | EXT-06                                |
| Twilio support                                                 | un-suspension; DPA; IE1; written STT/TTS data-flow answers          | business profile                                        | you                             | DPA, written answers                                          | this week                                      | EXT-10, P04.10.02                     |
| OpenAI support / AWS Bedrock                                   | residency eligibility or Bedrock model access                       | —                                                       | you                             | ticket ID / model list                                        | this week                                      | EXT-12, DG-14                         |
| Security vendor                                                | scope + book the scoped test                                        | rough surface list                                      | you, vendor                     | quote, dates                                                  | book by early November                         | EXT-19                                |
| Voice-eval volunteers                                          | consented recording sessions                                        | consent form (EXT-02 view)                              | you + volunteers                | consents                                                      | before P04.05 runs                             | EXT-20                                |
| Founder review blocks (weekly)                                 | QG-09 verdicts, tier verdicts, M0, PR merges                        | —                                                       | you (+ Codex / reviewer agents) | VERIFIED decisions                                            | weekly, starting this week                     | Ledger updates                        |
| Pilot go-live meeting (PG-3)                                   | go/no-go, kill switch, back-to-normal, owner training               | PG-0…PG-3 met                                           | you, owner, staff               | go/no-go record                                               | ~Dec/Jan                                       | EV-P18-006                            |
| Weekly pilot reviews (P19)                                     | 100% interaction review, S1/S2 triage                               | pilot live                                              | you, owner                      | weekly report                                                 | weekly for ≥ 30 days                           | PG-4                                  |
| Conversion discussion                                          | paid continuation                                                   | ~day 21 of the pilot                                    | you, owner                      | offer                                                         | pilot day ~21                                  | EXT-22 path                           |
| SME interviews (P01.06)                                        | 10 interviews (≥ 5 Handwerk); ≥ 2 non-restaurant pilot candidates   | Gurlitt introductions                                   | you, prospects                  | synthesis                                                     | next 3–6 weeks                                 | EXT-18                                |
| Stripe                                                         | live activation                                                     | entity + bank + tax settings                            | you                             | —                                                             | before P26                                     | EXT-13                                |

---

## 15. Repository Cleanup Audit

**Method (VERIFIED).**

- Every one of the 310 registered worktrees was checked for dirty state with `git status --porcelain` (with `GIT_OPTIONAL_LOCKS=0`).
- Each HEAD was compared with **every PR's `headRefOid`** (squash merges mean `git branch --merged` can't be trusted) and with `origin/main` ancestry.
- Each was compared with its remote branch.
- Extra commits on remote branches were checked by **patch-id** against all 247 `main` patches.
- The full per-worktree table is in `docs/audits/2026-10-16-worktrees.tsv`.

**The shared control checkout.** `~/projects/business/moin` _is_ the repository: `.git` lives there, and `.git/worktrees/` holds the metadata of all 309 linked worktrees. **It must not be deleted or replaced** without first migrating:

- 26 stashes;
- the safety ref `backup/p06-10-audit-pre-normalize-20260930`;
- `.git/claude-evidence/`;
- the 302 per-worktree `claude-evidence/` directories.

| Class                                                                 | Count                                                                 | Members                                                                                                         |
| --------------------------------------------------------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| 1. Canonical / control checkout                                       | 1                                                                     | `moin/` (main working tree; branch `feat/p06-13-xsuite`, merged #48)                                            |
| 2. Registered worktree on `main`                                      | 1                                                                     | `moin-main/` (stale: 165 behind)                                                                                |
| 3. Registered worktree, branch already merged (HEAD = merged PR head) | 186                                                                   | incl. all `moin-pr109…226` (their HEAD is the exact head of PR #N) and most named dirs                          |
| 3b. HEAD contained in a merged PR head                                | 117                                                                   | stacked agent worktrees (`.claude/worktrees/feat-p1x-*` …)                                                      |
| 3c. HEAD in `main`                                                    | 5                                                                     | `moin-gates`, `moin-integration`, `moin-maintenance` (#17 closed, content in main), `moin-p04`, `moin-main`     |
| 4. Worktree for an open PR                                            | **0**                                                                 | —                                                                                                               |
| 5. Detached                                                           | **0**                                                                 | —                                                                                                               |
| 6. Unregistered leftovers                                             | 2                                                                     | `moin-sessions/` (root-owned, **only empty dirs**: a Docker bind-mount artefact), `moin-merge-order.md` (notes) |
| 7. Uncommitted changes                                                | 53                                                                    | main checkout (`.omo/`) + 52 linked (below)                                                                     |
| 8. Unique / unmerged commits                                          | **0 unpushed**; 2 pushed docs-only commits not in main                | `feat/p09-09-retrieval` (`f5b1145` BLOCKER row), `fix/qg09-s2-lock-order` (`934691c` EV-P06-079 CI note)        |
| 9. State worth preserving                                             | see below                                                             | evidence JSON, unique notes, stashes, safety ref                                                                |
| 10. Safe cleanup candidates                                           | **309 linked worktrees** (after the preservation steps) + 2 leftovers | everything except `moin/`                                                                                       |
| 11. Unclear — manual review                                           | 1                                                                     | `backup/p06-10-audit-pre-normalize-20260930` (local-only, unmerged safety ref). Keep until you decide           |

**The 52 dirty linked worktrees.**

- **49** contain only the identical control-plane test fix: a modified `.claude/tests/test_control_plane.py` (diff md5 `aef08567…`) and an untracked `.claude/tests/test_fixture_copy.py` (md5 `cb39b62f…`). It is not on `main`. One preserved copy is enough.
- **3** contain unique uncommitted notes:

  | Worktree                                   | Unique content                                                                                                                                                                                                                            |
  | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | `moin-awsorg`                              | PROGRESS.md: 6 BLOCKER rows from 2026-10-15. They hold the Twilio-suspended / OpenAI-no-residency / SES-domain facts, the merge-chain history and the hung run 38681006237. Also `docs/control-plane/patches/0005-merge-grant.md` (draft) |
  | `.claude/worktrees/feat-p07-12-search`     | PROGRESS.md: 1 BLOCKER row (also carries the control-plane fix)                                                                                                                                                                           |
  | `.claude/worktrees/fix+qg09-s2-lock-order` | untracked `docs/phases/P06-s2-lock-order-plan.md` (also carries the control-plane fix)                                                                                                                                                    |

**Must be preserved before any removal:**

1. `.git/worktrees/*/claude-evidence/`: 9,337 gate-run JSON files, 133 MB. EV records and PROGRESS cite 69 distinct runs. `git worktree remove` deletes them.
2. The unique files above, `.omo/`, and `moin-merge-order.md`.
3. The 26 stashes. They survive worktree removal, but export them before any re-clone. Several are labelled "do-not-commit" or "drop:", so review them.
4. The safety ref `backup/p06-10-audit-pre-normalize-20260930`.

**Not to remove now:** the worktree that a running Claude session uses (`.claude/worktrees/feat-p33-sellgate`), or anything else while the tmux agent sessions are alive.

**Remote branches.** 216 non-`main` branches, all merged; 0 have an open PR.

- **214** are safe deletion candidates. Their tips equal a merged PR head or are in `main`, or their extra commits are patch-equivalent to `main` (12 early stacked P02/P03 branches).
- **2** carry one docs-only commit that never reached `main` (`feat/p09-09-retrieval`, `fix/qg09-s2-lock-order`). Delete them only if you accept losing those notes, or cherry-pick them first.
- `main` is protected. Remote deletion is **founder-only**.

**Consolidation choice.** Keep **`~/projects/business/moin/`** as the single directory and check `main` out there. No fresh clone is needed. A re-clone would drop the stashes, the safety ref, the evidence JSON and the hook state unless they were migrated by hand.

Making `moin-main` the only directory instead would require moving `.git` (a fresh clone or a manual worktree migration). Nothing is gained by that.

---

## 16. Safe Cleanup Plan

**Not executed.** The exact commands, generated from the verified classification, are in **`docs/audits/2026-10-16-cleanup-proposed.sh`**:

- The file exits on line 1 if run, so copy one STEP at a time.
- Every removal re-checks the HEAD the audit recorded and skips anything that moved.
- The 49 standard dirty worktrees are only removed if their changes still match the two fingerprints exactly.

| Step | What                                                                                                                                                                                                                                             | Who        | Commands                      |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- | ----------------------------- |
| 0    | Park all agent sessions (tmux `claude`, `codex`, `opencode`, `agy`); confirm no process cwd is inside a worktree                                                                                                                                 | you        | `pgrep` + `/proc/*/cwd` check |
| 1    | **Archive gate evidence**: `tar` of `.git/claude-evidence` + all `.git/worktrees/*/claude-evidence` → `~/archives/moin/2026-10-16/claude-evidence.tgz` + SHA-256                                                                                 | you        | 3 commands                    |
| 2    | **Preserve uncommitted work**: control-plane fix as a patch + the untracked file, the 3 unique notes, `.omo/`, `moin-merge-order.md`, all 26 stashes as patches                                                                                  | you        | ~12 commands                  |
| 3    | **Safe local worktree removals**: 256 clean worktrees with `git worktree remove` (**no `--force`**; git refuses if anything changed)                                                                                                             | you        | 256 lines                     |
| 4    | 49 worktrees whose only change is the preserved control-plane fix: `--force` behind a fingerprint check                                                                                                                                          | you        | 49 lines                      |
| 5    | 3 worktrees with unique notes: `--force` after you check the archive                                                                                                                                                                             | you        | 3 lines                       |
| 6    | Remove `moin-main`; in `moin/`: `git switch main && git pull --ff-only`; `git worktree prune -v`; expect exactly one worktree                                                                                                                    | you        | 4 lines                       |
| 7    | **Local branch deletion candidates**: 336 branches. `git branch -D` is used only because squash merges defeat `-d`, and only while the branch still points at the audited commit. **Kept:** `main`, `backup/p06-10-audit-pre-normalize-20260930` | you        | 336 lines                     |
| 8    | **Remote branch deletion candidates (FOUNDER ONLY)**: 214 `git push origin --delete …` lines + 2 commented-out lines for the branches with unmerged docs commits. Then enable "Automatically delete head branches"                               | you        | 216 lines                     |
| 9    | `sudo rm -rf ~/projects/business/moin-sessions` (empty, root-owned)                                                                                                                                                                              | you (sudo) | 1                             |
| 10   | Optional: remove 11 stale `moin-server:*` images (~4 GB). **Do not** `docker system prune`; the build cache (59 GB) and volumes are shared with other projects                                                                                   | you        | 1                             |

**Items that must be preserved:** `moin/` and its `.git`; the archive from STEPs 1–2; the stashes; the safety ref; `.claude/state/` (hook state); the local Docker volume `moin_postgres-data`, which is your dev database. Reset it only with `pnpm dev:reset`, deliberately.

**Desired final layout:**

```text
~/projects/business/
  moin/                     ← single canonical checkout on `main` (git control dir)
    .claude/worktrees/      ← empty; agents create short-lived worktrees here, one per task, removed at merge
~/archives/moin/2026-10-16/ ← evidence + uncommitted-notes archive (outside the workspace)
```

**Removable after the audit:** **311 of the 312 `moin`-related entries** you can see (309 linked worktrees + `moin-sessions/` + `moin-merge-order.md`). About **18 GB** freed (14 GB agent worktrees + ~4.3 GB `moin-*`).

**Going forward:** an agent removes its worktree when its PR merges. Turn on GitHub's head-branch auto-delete. Never create per-PR merge-fix worktrees in `~/projects/business` (the `moin-pr109…226` pattern).

---

## 17. Repository Hygiene / Technical Debt

| Finding                                                                                                                                                                                                                                                                        | Evidence                                                                                                 | Class                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| 309 linked worktrees, 338 local and 216 remote merged branches                                                                                                                                                                                                                 | §15                                                                                                      | **safe cleanup** (after preservation)                                                      |
| 11 stale `moin-server` Docker images                                                                                                                                                                                                                                           | `docker images`                                                                                          | safe cleanup                                                                               |
| `moin-sessions/` empty root-owned dirs; `moin-merge-order.md`                                                                                                                                                                                                                  | §15                                                                                                      | safe cleanup                                                                               |
| 26 stashes, several marked "drop:" / "do-not-commit"                                                                                                                                                                                                                           | `git stash list`                                                                                         | uncertain (review, then drop)                                                              |
| `backup/p06-10-audit-pre-normalize-20260930`                                                                                                                                                                                                                                   | local-only safety ref                                                                                    | uncertain (keep until reviewed)                                                            |
| `.git/worktrees/*/claude-evidence` (133 MB)                                                                                                                                                                                                                                    | cited by EV records                                                                                      | **retain** (archive)                                                                       |
| `docs/control-plane/patches/*`, `docs/verification/*mutation*`, `docs/evidence/**`                                                                                                                                                                                             | audit trail                                                                                              | **retain**                                                                                 |
| **92 unreachable product source files (6,551 LOC)**: P10 gateway libraries, P11/P12 voice modules, `apps/web/lib/*`, P08 `worker.ts` / `rate-limiter.ts` / `sse-channel.ts`, 26 `packages/db` modules not used by any app, `packages/integrations/*`, `observability` "shapes" | reachability scan from `main-*.ts`, web pages, db CLI, scripts                                           | **technical debt requiring PRs**: wire (Tier 1) or delete; add a no-orphans CI rule (T2-5) |
| Status Ledger P08–P33 `NOT_STARTED` despite merged code; P07 header `NOT_STARTED` vs ledger `IN_PROGRESS`; EXT table all `NOT_STARTED`                                                                                                                                         | `plan_section.py --ledger`                                                                               | debt (docs PR, T2-1)                                                                       |
| PROGRESS.md: 267 `READY_FOR_REVIEW` claims, many for unbuilt deliverables; front matter stale (P09.10, 2026-10-12)                                                                                                                                                             | PROGRESS rows                                                                                            | debt (T2-1)                                                                                |
| Evidence: 264 records without a CI link, 246 without a reviewer, 1 STALE commit (EV-P06-054)                                                                                                                                                                                   | `evidence.py check`                                                                                      | debt (T2-4)                                                                                |
| README says "Greenfield … P02 is the first phase"; `db:seed` doc says 0 rows "until P06"; CLAUDE.md §1 "Greenfield: no application code exists until P02"                                                                                                                      | file contents                                                                                            | debt (docs)                                                                                |
| `@moin/contracts` and `@moin/ui` placeholders; OpenAPI drift CI job is a no-op                                                                                                                                                                                                 | source + `verify.yml`                                                                                    | debt (WP-2)                                                                                |
| xsuite says "every tenant table" but seeds 10 of ≥ 40                                                                                                                                                                                                                          | `xsuite/seed.ts`                                                                                         | **debt, P0** (T2-3)                                                                        |
| Session tokens and CallSid dedup in memory                                                                                                                                                                                                                                     | `voice.module.ts`                                                                                        | debt (WP-1)                                                                                |
| `renovate.json` with no Renovate activity; Dependabot and secret scanning off                                                                                                                                                                                                  | `gh api`, PR list                                                                                        | founder setting                                                                            |
| AWS account IDs, root e-mail aliases and portal URL in a public doc                                                                                                                                                                                                            | `docs/operations/aws-organization-baseline.md`                                                           | founder decision                                                                           |
| Uncommitted control-plane test fix duplicated in 51 worktrees (the test copies 14 GB of worktrees into temp fixtures)                                                                                                                                                          | §15                                                                                                      | debt (founder patch, T2-6)                                                                 |
| TODO/FIXME/HACK markers                                                                                                                                                                                                                                                        | 0 found                                                                                                  | clean                                                                                      |
| Skipped/only tests                                                                                                                                                                                                                                                             | 0 found                                                                                                  | clean                                                                                      |
| `eslint-disable`                                                                                                                                                                                                                                                               | 48 occurrences                                                                                           | review in WP PRs (uncertain)                                                               |
| Migration numbering                                                                                                                                                                                                                                                            | 0001…0076, no duplicates on `main` (the 0062–0070 collisions noted on 10-15 were resolved by the merges) | clean                                                                                      |
| Commented-out code, unused deps                                                                                                                                                                                                                                                | none material (`react-dom` is required by Next; `@moin/contracts` dependency is empty)                   | clean / debt with WP-2                                                                     |
| Stale tags / temp refs                                                                                                                                                                                                                                                         | 0 tags; `tmp/prepared-p06-10-audit` local branch (merged)                                                | safe cleanup                                                                               |

---

## 18. Roadmap A — Maximum Engineering Progress (no waiting for anyone)

**Stopping criterion:** every remaining open item is `WAITING_FOR_EXTERNAL`, founder-only, or Tier 4. Each WP below ends at `READY_FOR_REVIEW` with mutation-proven tests; QG-09 runs where flagged.

| #   | Step                                                                                    | Lane         | Depends on             | Gate to pass                                              |
| --- | --------------------------------------------------------------------------------------- | ------------ | ---------------------- | --------------------------------------------------------- |
| A0  | M0: truth reconciliation, evidence hygiene, control-plane patch draft                   | governance   | your approval          | docs-consistency, `evidence.py check` clean               |
| A1  | Retro QG-09 (T2-2) + xsuite catch-up (T2-3)                                             | security     | —                      | `/gate-ready`; LG-P01 on every tenant table               |
| A2  | M1 vertical slice (WP-1 deterministic + WP-2 minimal + WP-4 Today + WP-9 seed)          | product      | A0                     | simulator E2E, LG-P13 local, QG-09 + INV-rev              |
| A3  | M2 async runtime (WP-3)                                                                 | platform     | A2 can run in parallel | FS-01/10/14/18 report, 20× stress                         |
| A4  | M3 Terraform staging (WP-5)                                                             | infra        | — (parallel)           | validate/tflint/trivy; ready for your `plan`              |
| A5  | M4 owner app + API complete (WP-2, WP-4)                                                | product      | A3                     | Playwright in 3 browsers + mobile, axe                    |
| A6  | M5 AI path + eval datasets (WP-7)                                                       | AI           | A2                     | harness plumbing on the fake provider; datasets at PLAN N |
| A7  | M6 notifications, privacy, pilot tooling (WP-6/8/9)                                     | product      | A3                     | LG-P12 local, LG-P10 local half                           |
| A8  | M7 observability, restore rehearsal, operator identity, latency harness (T2-7…T2-10)    | ops          | A3, A4                 | drill reports                                             |
| A9  | Tier 3 adapters: Bedrock/OpenAI, SES, Twilio SMS/status/reconcile, Cognito              | integrations | A6, A7                 | contract tests; verification marked WAITING_FOR_EXTERNAL  |
| A10 | LAUNCH-tier engineering: P23 usage ledger + Stripe TEST, P22 team, P24 onboarding flows | commercial   | A5                     | INV-20 tests; LG-P08/P09 local                            |

Lanes: **A2 → A5** (product), **A3 → A7** (platform), **A4** (infra) and **A6** (AI) can run as two to three concurrent sessions; at most two engineering sessions at once (CLAUDE.md §11).

**Critical path for A:** A0 → A2 → A5. Roughly 5–7 working weeks of agent time plus your review cadence.

---

## 19. Roadmap B — Fastest Safe Pilot (Gurlitt overflow)

| Order         | Engineering                                                                                                                                   | Founder / external                                                                                                                                                                                                             | Gate           |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------- |
| 1 (week 1)    | A0, A1 start; A2 start                                                                                                                        | **DG-09, DG-14, DG-00, DG-10, DG-12**; engage the lawyer (EXT-02 A/04/05); Gewerbe (EXT-01); Twilio reply (EXT-10); Bedrock access / OpenAI ticket (EXT-12); insurer + Steuerberater + bank requests; Gurlitt kickoff (EXT-16) | —              |
| 2 (weeks 2–3) | A2 done; A3; A4 → **you apply staging**                                                                                                       | Gurlitt 7-day baseline (P01.02) → PG-1; voice volunteers (EXT-20); number end user (P04.02.01) + bundle submission (EXT-11)                                                                                                    | PG-1           |
| 3 (weeks 3–4) | staging walking skeleton; P04.05 measurements on staging + sandbox number                                                                     | **DG-01 GO/NO-GO**                                                                                                                                                                                                             | DG-01          |
| 4 (weeks 4–6) | A5, A6, A7 on staging; Bedrock/OpenAI wired; SES live; canary starts (needs ≥ 7 green days)                                                   | EXT-02 A opinion → must-fix list; EXT-05 restaurant scripts; insurance in force; pilot agreement + AVV                                                                                                                         | PG-0           |
| 5 (weeks 6–8) | eval runs: text sets + real-network (LG-V01…V14); restore drill (LG-P03); alarm drills (LG-P05); runbook tabletop (LG-P14); P18 shadow replay | owner approves knowledge + sample responses; forwarding at Gurlitt (EXT-26); owner training                                                                                                                                    | PG-2           |
| 6 (week 8–10) | every `[G:PILOT]` item **VERIFIED** by you; PG-3 audit                                                                                        | go-live meeting                                                                                                                                                                                                                | **PG-3** → P19 |

**Exact gates:** PG-0, PG-1, PG-2, PG-3 (PLAN §Pilot Gates); LG-V01…V14; LG-P01/P02/P03/P05/P11/P14.

**Stopping criterion:** PG-3 passed with evidence and a recorded go/no-go.

**Estimated critical path:** 8–10 weeks from a start this week. That points to an **early-to-mid December 2026** earliest pilot; January 2027 if any external slips by 2 weeks.

---

## 20. Roadmap C — Fastest Path to P33 FULL SELL-READY

| Stage | Contents                                                                                                                                                                                 | Gates                                             | Earliest (ESTIMATE) |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- | ------------------- |
| C1    | Roadmap B → pilot live                                                                                                                                                                   | PG-3                                              | Dec 2026 – Jan 2027 |
| C2    | 30-day pilot run; S1/S2 handling; weekly reports                                                                                                                                         | **PG-4**, EXT-21                                  | +30–45 days         |
| C3    | In parallel: MT-LIVE (P17.13, EXT-18 two non-restaurant pilots, EXT-05 Handwerk scripts, P21)                                                                                            | MT-LIVE                                           | +4–6 weeks after C1 |
| C4    | LAUNCH tier: P22, P23 (usage ledger, Stripe live EXT-13), P24, P25 (EXT-02 B documents, site), EXT-19 scoped test, EXT-03                                                                | **P26 Early Access** (≤ 5 customers, cap in code) | Feb–Mar 2027        |
| C5    | DG-04 → P27 (Gmail needs EXT-14 CASA 6–12 weeks: **start once the domain + site exist**) → P28 → P29                                                                                     | PG-6, LG-I01…I05                                  | Mar–Apr 2027        |
| C6    | P30 full pentest (EXT-19 full) + remediation; P31 game days, DR, cost; P32 multi-customer validation (≥ 300 AI calls, recurring payment settled EXT-22, 30 days 0 S1, references EXT-23) | SR-01…SR-61                                       | Apr–Jun 2027        |
| C7    | P33 evaluation + declaration or gap list                                                                                                                                                 | FULL SELL-READY                                   | **Q2 2027**         |

**Parallel lanes:** engineering (A), legal (EXT-02 A → B → C, EXT-03/04/05/08), provider (EXT-09…15), customer (EXT-16/18/21/22/23/26), security (EXT-19), commercial (DG-09, EXT-01/13/28, pricing).

**Stopping criterion:** the Ledger shows FULL SELL-READY with a decision record ID, or a published gap list with owners and dates.

---

## 21. Parallel Founder + Engineering Timeline

| Week (Mon)              | Engineering (agents)                                          | You — decisions & reviews                                  | You — external                                                                                    | Unlocks                 |
| ----------------------- | ------------------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ----------------------- |
| **10-12 → 10-18** (now) | M0 reconciliation; retro QG-09 starts; M1 starts              | DG-09, DG-14, DG-00, DG-10, DG-12; approve M0; run cleanup | lawyer request; Gewerbe; Twilio reply; Bedrock access; insurer, Steuerberater, bank; Gurlitt call | everything              |
| 10-19                   | M1 slice; xsuite catch-up                                     | QG-09 §§1–13 verdicts; review M1 PRs                       | Gurlitt kickoff + observation consent; book the security vendor; volunteers                       | PG-1 start; EXT-19 slot |
| 10-26                   | M2 async; M3 Terraform PRs                                    | Terraform plan/apply (bootstrap, staging)                  | number end user + bundle; observation week                                                        | staging                 |
| 11-02                   | M4 owner app; P04.05 measurements on staging                  | **DG-01**                                                  | lawyer stage A in progress; insurance quotes                                                      | P11/P12 confirmed       |
| 11-09                   | M5 AI path + datasets; M6                                     | knowledge review with the owner                            | pilot agreement + AVV draft                                                                       | PG-0 path               |
| 11-16                   | M6/M7; canary on staging; eval runs                           | verify PILOT items in batches                              | EXT-02 A must-fix; EXT-05 scripts; insurance in force                                             | PG-2                    |
| 11-23 → 12-07           | PILOT verification sweep; restore/alarm drills; shadow replay | PILOT VERIFIED verdicts                                    | forwarding at Gurlitt; owner training                                                             | **PG-3**                |
| 12-07 →                 | P19 support; LAUNCH-tier engineering (P23 etc.)               | daily pilot reviews                                        | EXT-18 recruiting; Stripe prep                                                                    | PG-4, MT-LIVE           |

---

## 22. Immediate Next 7 Days

| Day           | You                                                                                                                                                                                                                                                                                                                                              | Engineering                                                     |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------- |
| **Fri 10-16** | (1) Park the 4 autonomous agent sessions. (2) Decide **DG-09** (Gewerbe now, UG later) and **DG-14** (Bedrock eu-central-1), both due today. (3) E-mail a data-protection lawyer with `docs/legal-briefs/` and ask for a quote for EXT-02 A + EXT-04 + EXT-05. (4) Call the Gurlitt owner: is the cooperation still on, and when is the kickoff? | Mission M0 (truth reconciliation, draft PR) once you approve it |
| Sat 10-17     | Run cleanup STEPs 0–6 from `docs/audits/2026-10-16-cleanup-proposed.sh`. Do the DPMA/EUIPO quick search and buy the domain (**DG-00**). Gewerbeanmeldung online if not already done                                                                                                                                                              | M0 finishes; retro QG-09 (T2-2) starts                          |
| Sun 10-18     | Answer Twilio support (EXT-10). Enable Bedrock model access in `moin-staging` and/or file the OpenAI residency ticket (EXT-12). Raise the AWS budget alert to a staging-realistic level                                                                                                                                                          | xsuite catch-up (T2-3)                                          |
| Mon 10-19     | Steuerberater, bank, insurance broker: request appointments and quotes (EXT-08/28/06). Contact security vendors for a scoped-test slot (EXT-19). Review the M0 PR                                                                                                                                                                                | M1 vertical slice starts                                        |
| Tue 10-20     | **DG-12** (due today) and **DG-10** (PLAN defaults are fine). Gurlitt kickoff if possible: written observation consent, protocol                                                                                                                                                                                                                 | M1                                                              |
| Wed 10-21     | Recruit 2+ voice-eval volunteers with consent forms (EXT-20). Get telecom input on the number end user (P04.02.01)                                                                                                                                                                                                                               | M1; T2-6 patch for you to apply                                 |
| Thu 10-22     | Weekly review block: QG-09 §§1–13 verdicts (EV-P06-084), merge M0 + retro-QG-09 fixes, record EXT counterparties/dates in the Ledger                                                                                                                                                                                                             | M1 first PRs ready; plan M2/M3                                  |

---

## 23. Next 30 Days (to ~2026-11-15)

1. **Week 1:**
   - the ledger tells the truth again;
   - cleanup done (one directory, 18 GB freed);
   - every long-lead external request sent, each with a counterparty, request date, expected date and fallback in the Ledger;
   - DG-00/09/10/12/14 decided.
2. **Week 2:**
   - a local vertical-slice demo (simulated call → capture → task on the Today page);
   - xsuite covers every tenant table;
   - retro QG-09 findings fixed;
   - Gewerbe registered;
   - Twilio un-suspended;
   - Bedrock (or OpenAI EU) access in hand.
3. **Week 3:**
   - Terraform staging applied by you;
   - walking skeleton live, private (WAF allowlist + Cognito);
   - Gurlitt 7-day baseline running;
   - lawyer engaged with stage A in progress;
   - number bundle submitted.
4. **Week 4:**
   - P08 runtime + owner app PILOT views on staging;
   - P04.05 measurements → **DG-01** decided;
   - eval datasets drafted;
   - insurance quotes in.
5. **Target at day 30:** engineering for the pilot is **dominated by verification, not construction**, and the remaining blockers are mostly external.

---

## 24. Next Engineering Mission

**Prerequisite (half a day, docs only, needs your approval): Mission 0 — "Truth reconciliation".**
Correct the Status Ledger rows P08–P33, the phase headers, the PROGRESS over-claims, the EXT table (EXT-09 IN_PROGRESS, EXT-24 satisfied, EXT-10/12 facts), the README and CLAUDE.md §1. Back-fill CI links (T2-4). Draft the control-plane patch (T2-6). This can run in parallel with the mission below.

```text
NEXT ENGINEERING MISSION:
M1 — Vertical slice: simulated call → deterministic capture → task → owner "Heute" view (PILOT, local)

WHY THIS IS NEXT:
- Turns the largest block of dead code (P11/P12 voice modules, P13 lib helpers) into the first
  working product path, and exercises INV-03/05/06/19 end to end for the first time.
- Needs no external party: ConversationRelay protocol simulator + deterministic capture (the
  mandatory LLM-free fallback) + local stack. DG-01 risk is contained: the flows sit behind the
  existing transport adapter.
- Produces the first honest demo, and the skeleton every later PILOT item plugs into.

PLAN ITEMS (READY_FOR_REVIEW only where the item's own acceptance text is met):
- P11.05 call session state machine wired into relay-session (replacing the P04 measurement script
  behind a config switch kept only for P04.05 measurements)
- P11.06 finaliser + P07.11 reconciler on real call rows (INV-06/19); P11.04.01 tokens/dedup → Valkey
- P12.01 disclosure-first greeting (INV-03), P12.09 callback capture with read-back,
  P12.12 outcome written exactly once, P12.07 escalation to a task
- P06.03.04 dialled-number → tenant resolution in the voice path
- P13.01 shell + P13.02 Today page (Rückrufe section) via a minimal owner API (WP-2 subset:
  GET today, POST task status) with Zod contracts and OpenAPI drift check activated
- P02.04.02 / P18.03 demo tenants seeded ("Musterrestaurant") with a provisioning CLI

DEPENDENCIES:
- P06 ✓, P07 ✓ (contacts, conversations, calls, outcomes, tasks), P09 approved-retrieval view ✓
- Valkey client dependency (licence check), no new external accounts
- Mission 0 approved (or run in parallel)

EXPECTED PR(S) (stacked, each ≤ one checklist section):
1. feat/p11-05-session-wiring — call machine + finaliser on the relay path; Valkey token/dedup store
2. feat/p12-09-capture-slice — greeting, callback capture with read-back, outcome writer, escalation task
3. feat/p13-02-today-api — contracts package + GET /api/v1/today + task status mutation (idempotent)
4. feat/p13-02-today-view — Today page (Rückrufe) with polling, German copy, a11y floor
5. feat/p18-03-demo-seed — provisioning CLI + seeded demo tenant + demo reset
6. test/p12-slice-e2e — simulator call → task visible on Today < 60 s (LG-P13, local)

GATES:
- gates.py full green per PR; unit + integration + e2e; mutation_check KILLED for each fix/control path
- QG-09 (/gate-ready: security-reviewer + architecture-reviewer) on PRs 1–3; invariant-reviewer on 1–2
- xsuite: new routes at 100% coverage; new tables in the two-tenant DB probes
- 20× stress on the slice E2E; standalone runs on a freshly seeded DB
- Status stays READY_FOR_REVIEW; you decide VERIFIED
```

**Pipeline after M1:**

| Mission | Name                                          | PLAN                                      | Why then                                                                                        |
| ------- | --------------------------------------------- | ----------------------------------------- | ----------------------------------------------------------------------------------------------- |
| **M2**  | Async runtime for real                        | P08.02/.03/.05/.07/.08/.09/.10/.11 (WP-3) | P11 post-call jobs, P13 realtime and P14 all depend on it; control path → INV-rev               |
| **M3**  | Terraform foundation + private staging        | P05.02–.10, P17 IaC (WP-5)                | Longest elapsed-time unlock: staging is needed for P04.05/DG-01, canary days, drills. You apply |
| **M4**  | Owner app + API, all PILOT views              | P13.03–.13, WP-2 complete                 | PG-2 needs owner knowledge approval; LG-P13                                                     |
| **M5**  | AI path + eval datasets (late-bound provider) | P10 wiring, P10.02, P10.13, P12.14 (WP-7) | LG-V gates need datasets ready the day Bedrock/OpenAI access lands                              |
| **M6**  | Notifications, privacy slice, pilot tooling   | P14 (WP-6), P16 PILOT (WP-8), P18 (WP-9)  | Closes the remaining PILOT engineering before the externals finish                              |

---

## 25. Bottom Line

1. **What percentage of engineering is done?**
   - **~30%** of PLAN's engineering items are implemented in some real form (25–38% range); ~21% by PLAN's own effort weights.
   - Only **0.7% is founder-VERIFIED**, and 13% is evidence-ticked.
2. **What percentage of the total project is done?** **~27%** of all P00–P33 work, counting partial implementation; 11.8% by ticked items; 0.6% verified. **0 of 8 readiness states**, 1 of 28 external gates.
3. **What percentage of the journey to P33 is done?** Literal P33: **0%**. Dependency-adjusted: **~27% of the work, ~0.6% of the verified evidence, 0 of 61 SR criteria**.
4. **Is the product demoable?** **No, not as a product.** The engineering can be shown, but the owner app is a placeholder and calls run a measurement script. After M1 (≈ 2 weeks) you'll have an honest local demo.
5. **Is it pilot-ready?** **No.** 0/4 pilot gates, 0/14 voice gates, 1/16 pilot external gates, no infrastructure.
6. **Is it ready for a paying customer?** **No.** Billing is 0%, and the LAUNCH gates and EXT-02B/13/19 have not started.
7. **Top 5 blockers:**
   1. no working call → task → owner path (P11/P12/P13 wiring);
   2. no staging or infrastructure (P05/P17; your Terraform apply);
   3. legal stage A, insurance and entity not started (EXT-02 A, EXT-06, EXT-01);
   4. voice + LLM providers not usable (Twilio suspended, EU LLM residency unresolved → DG-01 and DG-14);
   5. Gurlitt cooperation and observation not evidenced (EXT-16, PG-1), plus your review backlog (QG-09 verdicts, no QG-09 on ~100 sensitive merges).
8. **What should engineering do next?** Mission 0 (truth reconciliation), then **M1: the vertical slice**, then M2 async and M3 Terraform in parallel. **No more shape PRs.**
9. **What should you do next?** Today: park the agents; decide DG-09 and DG-14; e-mail a data-protection lawyer with the legal pack; call Gurlitt. This weekend: run the cleanup, pick and buy the domain (DG-00), Gewerbeanmeldung, answer Twilio, get Bedrock access.
10. **Can we safely clean the hundreds of moin directories now, and how many?**
    - **Yes, once the agents are parked and the evidence and five unique items are archived (STEPs 0–2).**
    - About **311 of 312** moin-related entries can go: all 309 linked worktrees, `moin-sessions/` and `moin-merge-order.md`. That frees ~18 GB and leaves one directory, `~/projects/business/moin` on `main`.
    - No unpushed commit exists anywhere. 214 of 216 remote branches are safe to delete (founder-only).

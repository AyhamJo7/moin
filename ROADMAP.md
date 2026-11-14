# ROADMAP

The single source of truth for status and order of work. `NEXT.md` is the 15-line view of this
file. `PLAN.md` stays as the reference for item IDs, invariants and gate definitions; its Status
Ledger and `PROGRESS.md` are frozen as of 2026-11-14 and are no longer updated. How work flows:
`OPERATING.md`. Audit behind this file: `docs/audits/2026-11-14-owner-audit/`.

## 1. Finish line

The AI's job is finished at **F2**. F1 is the part that needs nobody but the AI.

**F1: pilot-complete on the local stack and in CI (no external account).** On a fresh clone,
`pnpm dev:up` plus one seed command gives a demo restaurant tenant where all of this works and is
covered by a browser or integration test that runs in CI on every PR:

1. A simulated inbound call (signed webhook plus relay session, no provider account) is answered
   with the tenant's own German AI disclosure, and the call, the disclosure and the outcome are
   stored.
2. The caller gets an answer from an approved knowledge card, or leaves a callback request, a
   lead or an appointment request; a life-safety phrase gets the deterministic script; a dropped
   session still ends in an outcome or an open task (INV-06, INV-19).
3. The owner signs in, sees the result on Heute within seconds (SSE), gets a notification
   (in-app and email through the local SMTP sink), and works the task (complete, assign, snooze,
   reopen) and the contact.
4. The owner maintains knowledge (cards, hours, approval) and settings, invites a team member,
   and the member accepts and signs in.
5. Background work runs in the worker role: outbox dispatch, timers, finaliser and reconciler
   sweeps, retention. Every job is idempotent and audited.
6. A model-backed turn runs through the gateway port, policy engine and tool guard against a
   recorded fake provider, with the eval set in CI. Usage is written to the usage ledger.
7. The server image boots all four roles in CI. Terraform for the dev and prod environments is
   written and passes `terraform validate` and `tflint`; a deploy workflow exists and requires
   environment approval.

**F2: staging runs a real call.** After the human queue items H2 to H4: Terraform applied to the
dev account by the founder, the image deployed by the workflow, one real phone call to the Twilio
number is answered through an EU-hosted model and appears on Heute in the deployed web app, and
the P04 latency measurement is recorded. Everything after F2 (Gurlitt pilot, lawyer sign-off,
billing, launch) is human-led; the AI supports on request.

Not part of the finish line: P20 to P33 (booking, email inbox, billing, commercial, pentest, scale).
They stay in `PLAN.md` and get a queue here once a paying pilot exists.

## 2. Current state

Audited on `main` @ `0e020d2` (2026-11-14); the table below comes from reading code and CI at
that SHA, not from `PROGRESS.md`. Since then: C2 merged as `7a7201d` (#272, `apt` 2.6.2 in the
runtime image; all PR checks including `container-scan` passed on head `4cf8b6b`), and C1 (this
file, `OPERATING.md`, the lean control plane, installed by the founder on 2026-11-14) with #271.

| Area                                                              | Truth                                                                                                                                                                                                                                                                                 |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Runs end to end                                                   | Keycloak sign-in, Heute (`GET /api/today`, 15 s poll), Erledigt (`POST /api/tasks/:id/complete`); a dev-only simulated call that writes call, outcome, task and audit in one transaction. Browser E2E in CI.                                                                          |
| Voice                                                             | `/voice/inbound` returns disclosure TwiML and opens a relay session that runs the P04 measurement script. It writes nothing to the database. The spoken business name comes from one env value, not from the tenant.                                                                  |
| Worker                                                            | Starts a real consumer (#245), but the handler registry is empty and nothing publishes. Outbox, timers, inbox, idempotency keys, flags, finaliser and reconciler exist as tested DB code with no runtime caller.                                                                      |
| Tenancy and identity (P06)                                        | The strongest area: FORCE RLS, catalog check, sessions, CSRF, step-up, RBAC, audit chain are wired and CI-tested. 13 fix PRs are open against it. No login page in the web app, no invitation accept route, `provision_tenant` has no caller outside tests, `db:seed` applies 0 rows. |
| Business model (P07)                                              | Contacts, leads, requests, notes, search, merge: DB functions with tests, no API route. Only "complete task" is exposed.                                                                                                                                                              |
| Knowledge (P09)                                                   | Real, CI-tested DB code (cards, approval, staleness, retrieval view). No runtime consumer, no owner UI.                                                                                                                                                                               |
| AI (P10)                                                          | `@moin/ai` has zero importers. `templates/` and `evals/` are empty. No `usage_ledger` table.                                                                                                                                                                                          |
| Conversation (P12), notifications (P14), ops (P15), privacy (P16) | Unit-tested helpers; almost nothing imported by a runtime. P16 files in `packages/db` contain no SQL.                                                                                                                                                                                 |
| Infrastructure (P05, P17)                                         | 0 Terraform files, no deploy workflow, no environment. The Dockerfile runtime stage omits `@moin/telephony` and `@moin/integrations`, so the voice and worker roles cannot start from the image (#270 fixes it; blocked on a shellcheck finding).                                     |
| Plan bookkeeping                                                  | 1,204 checklist items, 117 ticked, 7 verified, no tier verified. 410 evidence records, about a third are reruns or bookkeeping.                                                                                                                                                       |
| Repository                                                        | 13 open draft PRs (12 green, #270 red), 260 remote branches (247 merged), 7 worktrees, 26 stashes.                                                                                                                                                                                    |

Status per plan section: `audit-A-p02-p08.md` and `audit-B-p09-p16.md` in the audit folder.

## 3. AI queue

Order is top to bottom. Items with the same letter in **Par** can run in parallel, each in its own
worktree. Size: S under half a day, M up to two days, L more. An item is finished when its
done-criterion holds on `main` with CI green on the merge SHA.

| ID  | Item                            | Done when                                                                                                                                                                                                                                                                                  | Depends on     | Size | Par |
| --- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------- | ---- | --- |
| C3  | Repository settings             | auto-merge on, delete-branch-on-merge on, squash only, up-to-date rule off, after H9: `container-scan` only when the image inputs change, and the empty `openapi-drift` job removed                                                                                                        |                | S    | a   |
| C4  | Land the open code PRs          | merged in the order in `audit-E-hygiene.md`, each through `/ship`; #270 after its shellcheck fix; stacks #264 and #268 retargeted; #257 and #261 closed unmerged (D9)                                                                                                                      | C3             | M    |     |
| C5  | Prune                           | merged remote and local branches deleted, worktrees removed, stashes dropped; the three unmerged local branches and all stashes are in the 2026-11-13 bundle                                                                                                                               | C4             | S    |     |
| C6  | Delete dead code                | shape helpers that implement no plan item removed (`packages/observability/src` P05/P17/P18/P30 to P33 shapes, `platform/worker.ts`, `apps/web/lib/realtime.ts` if still unused); build and tests pass                                                                                     | C4             | S    | a   |
| S1  | Call persistence and disclosure | `/voice/inbound` stores the call and a disclosure record (the version as issued; playback evidence is separate, with tests for interrupted and absent playback); the spoken name comes from the tenant; voice role has a tenant-scoped pool; dedup in the database; mutation-checked tests | C4             | M    |     |
| S2  | Demo tenant seed                | `pnpm db:seed` creates the demo tenant, owner, hours and approved FAQ cards through `provision_tenant`; idempotent; test asserts row counts                                                                                                                                                | C4             | S    | b   |
| S3  | Deterministic turn loop         | relay session answers from an approved card verbatim, detects callback, lead and appointment intents, reads the number back, handles silence and barge-in, routes life-safety phrases to the script                                                                                        | S1, S2         | L    |     |
| S4  | Capture and finalise            | session end writes outcome and task through the P07 services; the finaliser closes dropped sessions; a confirmed callback that arrives after finalisation adopts the fallback task (either order converges); no interaction without outcome or open task (test kills the session mid-call) | S3             | M    |     |
| S5  | Local call driver and slice E2E | script sends a signed webhook, speaks over WSS, ends the session; one browser test: call, Heute shows the task, owner completes it                                                                                                                                                         | S4             | M    |     |
| A1  | Background runtime              | worker handlers registered for outbox dispatch, timers, finaliser and reconciler sweeps; publisher wired; Idempotency-Key middleware on mutating routes; chaos test kills a worker mid-job                                                                                                 | C4             | L    | b   |
| A2  | SSE                             | `GET /api/v1/events` with replay; Heute uses it with a stale indicator and falls back to polling                                                                                                                                                                                           | A1             | M    |     |
| N1  | Notifications                   | call outcome triggers a notification row and an email through the SMTP port (Mailpit locally); escalation timer fires through A1; in-app list on Heute. Channels per DG-12 default                                                                                                         | A1, S4         | M    |     |
| O1  | Sign-in and onboarding          | login page, invitation accept route with email, operator command that provisions a tenant; E2E: invite, accept, sign in                                                                                                                                                                    | C4             | M    | b   |
| B1  | Business API                    | routes for task assign, snooze, reopen; contacts; leads; requests; notes; search; all through tenant context with the cross-tenant suite extended                                                                                                                                          | C4             | L    | b   |
| W1  | Owner views                     | Heute counts, inbox, customer page, knowledge editor with approval, settings, team; axe checks pass                                                                                                                                                                                        | B1, O1         | L    |     |
| G1  | Gateway in the call path        | turn loop can call the gateway port through policy engine and tool guard behind a flag; recorded fake provider; restaurant template and eval set in `templates/` and `evals/`; eval job in CI                                                                                              | S4             | L    | c   |
| G2  | Usage ledger                    | append-only `usage_ledger` written per call and per model turn; reconciliation query; INV-20 test                                                                                                                                                                                          | S4             | M    | c   |
| P1  | Retention, export, erasure      | retention job, tenant export and erasure run on the real tables through A1; deletion ledger; E2E for one erasure                                                                                                                                                                           | A1, B1         | L    | c   |
| T1  | Observability                   | metrics and traces emitted from server, voice and worker; PII log scanner in CI; alarm definitions as code                                                                                                                                                                                 | A1             | M    | c   |
| I1  | Image and roles                 | CI boots web, api, voice and worker from the one image and probes health                                                                                                                                                                                                                   | C4 (#270)      | S    | a   |
| I2  | Terraform                       | bootstrap, network, data services, compute, secrets, WAF, backups for dev and prod; `validate` and `tflint` in CI; founder runbook for apply                                                                                                                                               |                | L    | b   |
| I3  | Deploy workflow                 | build once, push digest, deploy to dev on merge, prod behind environment approval                                                                                                                                                                                                          | I1, I2         | M    |     |
| F2a | Staging smoke                   | after H2 to H4: deployed stack answers a real call; latency measurement recorded                                                                                                                                                                                                           | I3, H2, H3, H4 | M    |     |

Rules for the queue: a new item gets an ID and a done-criterion before work starts; nothing from
P20 to P33 enters before F1; anything on a control path (auth, sessions, RLS, tool guard,
idempotency, usage ledger, state machines) needs a mutation-checked test.

## 4. Human queue

| ID  | Item                                                                 | Why only you                 | Exact steps                                                                                                                                                                                                 | Unblocks                                                         | Urgency                |
| --- | -------------------------------------------------------------------- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ---------------------- |
| H2  | AWS remainder and domain (EXT-09, DG-00, EXT-07)                     | accounts, money, brand       | 1. one-hour trademark search for KlarDesk; 2. buy the domain; 3. request SES production access for it; 4. when I2 is merged, run the apply runbook for the dev account                                      | F2, real email, P05                                              | this month             |
| H3  | Twilio (EXT-10, EXT-01, EXT-11)                                      | account, identity documents  | 1. answer the identity request on the suspended account or open a new one in IE1; 2. sign the DPA; 3. order the German number bundle with the business documents; 4. put the credentials in Secrets Manager | F2, P04 measurement, DG-01                                       | this month             |
| H4  | EU model access (EXT-12, DG-14)                                      | account, contract            | request Bedrock model access in eu-central-1 in the existing AWS org (default), or open the OpenAI EU-residency project                                                                                     | F2, live evals                                                   | this month             |
| H5  | Counsel (EXT-02, EXT-04, EXT-05)                                     | contract, legal judgement    | engage a data-protection lawyer; send the pack in `docs/legal-briefs/` once the AI has closed its open document fixes                                                                                       | disclosure wording, pilot agreement                              | before any real caller |
| H6  | Gurlitt (EXT-16)                                                     | relationship                 | confirm the cooperation and a kickoff date; the 2026-09-28 kickoff has no recorded outcome                                                                                                                  | the pilot itself                                                 | before H5 costs money  |
| H7  | Owner usability test (DG-10)                                         | talking to a user            | run the prototype from #244 with one owner; write down what confused them                                                                                                                                   | W1 visual decisions                                              | before W1 ends         |
| H8  | Entity, bank, tax, insurance (EXT-01, EXT-06, EXT-08, EXT-28, DG-09) | legal and money              | as in `PLAN.md` external table                                                                                                                                                                              | invoicing, pilot gate                                            | after H6               |
| H9  | Trim the expected-check list of the CI verifier                      | it gates the AI's own merges | in `~/.claude/kit/verify-head.d/AyhamJo7__moin.json` delete the entries `OpenAPI and client drift (activated in P06/P07)`, `container-scan` and `hadolint, build, trivy image`                              | dropping the empty CI job; the `container-scan` path filter (D8) | any time               |

Prepared for you by the AI is marked in `NEXT.md` when it exists (drafts, runbooks, emails).

## 5. Decisions for you

The AI proceeds on the default without waiting. Say so if you want another option. Decided by
the founder on 2026-11-14: D1 (a), D2 (a), D9 as recommended, and D3 (a) with one exception:
a migration that alters or drops existing data, and an identity or Keycloak change that could
lock the owner out, merge only after a tested rollback path, with one line each in `NEXT.md`.

| ID  | Decision                             | Options                                                                                                                                                                | Recommendation and default                                                                                                                        |
| --- | ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Finish line                          | (a) F1 then F2 as above; (b) all 214 PILOT sections of `PLAN.md` verified first                                                                                        | (a). The plan's gate asks a single-restaurant pilot to clear production DR and powered voice evals before the product answers one call.           |
| D2  | Status bookkeeping                   | (a) `ROADMAP.md` plus git and CI; (b) keep the Status Ledger, `PROGRESS.md`, evidence records                                                                          | (a). Existing records stay in the tree as history; no new `EV-` records, no per-item ticks. Mutation reports for control-path fixes go in the PR. |
| D3  | Who merges                           | (a) the AI through `/ship` (CI green on the head SHA plus independent review), including identity and migration PRs; (b) keep founder-merge for those until 2026-11-29 | (a), as you delegated on 2026-11-13. The independent review and exact-SHA check stay.                                                             |
| D4  | Dead and premature code              | (a) delete shape helpers that implement nothing (C6), freeze P20 to P29 libraries untouched; (b) delete P20 to P29 code too; (c) keep everything                       | (a).                                                                                                                                              |
| D5  | Model provider for F2 (DG-14)        | Bedrock eu-central-1, Azure OpenAI EU, Mistral, OpenAI EU                                                                                                              | Bedrock eu-central-1: it sits in the AWS org you already have and needs no new vendor. G1 builds against the port, so this can change.            |
| D6  | Notification channels (DG-12)        | plan default: email plus capped SMS at pilot, web push later                                                                                                           | plan default; SMS stays behind the port until H3.                                                                                                 |
| D7  | Turn log (DG-13)                     | plan default: no caller text stored; redacted 7-day log only after counsel approves                                                                                    | plan default.                                                                                                                                     |
| D8  | `container-scan` as a required check | (a) required only when Dockerfile, lockfile or server sources change, nightly run alerts; (b) always required                                                          | (a). A new CVE in the base image should not block an unrelated docs PR.                                                                           |
| D9  | The 13 open PRs                      | (a) land all after review; (b) close the docs-only ledger PRs #257 and #261 because the ledger is frozen                                                               | (a) for the code PRs; #257 and #261 are closed unmerged under D2 unless they contain non-ledger content.                                          |

Not defaulted, yours alone: DG-00 brand and domain, DG-03 positioning, DG-05, DG-09 entity, DG-11
support hours.

## 6. Risks and assumptions

- **No external account is usable today.** Twilio is reported suspended, no EU model access
  exists, AWS has no workload. F1 is designed to need none of them; F2 cannot start before H2 to
  H4.
- **Voice quality is unproven.** The stack decision (DG-01) depends on a latency measurement that
  needs F2. The turn loop is built behind ports so the provider can change.
- **Legal wording is provisional.** The disclosure uses the conservative blueprint wording until
  counsel answers (H5). No real caller before that.
- **The pilot partner is unconfirmed** (H6). F1 uses a synthetic restaurant tenant.
- **Review is automated.** The independent reviewer shares no context with the implementer but
  is still a model. Control paths keep mutation-checked tests and the invariant review.
- **Assumption:** the 2026-11-13 bundle in `~/backups/` and the tag `pre-owner-overhaul` are
  kept until F1.
- **Assumption:** cloud sessions are not in use; the control plane is tuned for local sessions.

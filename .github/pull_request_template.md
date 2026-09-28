<!--
  Conventional Commit title: type(scope): subject
  No AI-tool mentions anywhere in this PR (A-22) — see CONTRIBUTING.md.
  Every field is filled. A field that does not apply says `n/a` and why.
-->

## What and why

<!-- What changed, and the reason it needed to change. The diff shows what; this says why. -->

**Phase / checklist items:**  <!-- e.g. P02.03.03, P02.03.04 -->

## Risk

<!-- What could break, blast radius, and what you did to bound it. -->

## Tests

<!--
  What proves this works. For a bug fix, name the regression test and paste the
  `mutation_check.py --test "..."` result — it must report KILLED.
-->

## Evidence

<!-- EV-Pxx-nnn IDs produced or updated by this PR, with a link to each record. -->

## Docs

<!-- ADR, runbook, help article or claims matrix updated (QG-10), or `n/a` and why. -->

## Migration / rollback

<!--
  Schema changes: expand/contract compliance, lock behaviour, backfill as a job, rehearsal (QG-08).
  Every PR: how to roll this back, and whether rollback is safe once it has run in production.
-->

## Privacy impact

<!--
  New or changed personal data (QG-12): which field, retention category, erasure handler,
  export coverage, subprocessor register. Confirm no personal data reaches logs, metrics,
  traces or analytics (INV-12), and that no secret is logged or stored outside Secrets Manager
  (INV-15). Or `n/a` and why.
-->

## Checklist

- [ ] Title is a Conventional Commit and contains no AI-tool mention
- [ ] Scoped to one checklist section or smaller
- [ ] `python3 .claude/bin/gates.py full` passes on this branch
- [ ] Implementation and verification are separate checklist items, ticked only with evidence IDs
- [ ] No invariant weakened; no gate or threshold loosened
- [ ] QG-09 review requested if this touches auth, sessions, RLS/roles, `SECURITY DEFINER`, the tool guard, webhooks, integrations, billing or privacy handlers

# Founder merge queue — the P02 + P03 stack

**Written:** 2026-09-29 · **Applies to:** pull requests #3 – #15 · **Owner:** founder (merges are founder-only, CLAUDE.md §8)

`main` is still at `e6b72eb` — the pre-P02 control-plane commit. Every implemented P02 and P03
item exists only as a thirteen-deep stack of draft pull requests, each based on the one below it.
This file is the order they must land in, and the one merge method that lands them without manual
conflict resolution.

## The queue

Merge strictly top to bottom. Each pull request's base is the previous branch, so merging out of
order retargets the rest onto a `main` that does not yet contain what they build on.

| #   | PR  | branch                       | head         | base   | what it adds                                                              | required checks     | conflicts |
| --- | --- | ---------------------------- | ------------ | ------ | ------------------------------------------------------------------------- | ------------------- | --------- |
| 1   | #3  | `chore/p02-01-governance`    | `d1557e81cc` | `main` | contribution, evidence and progress scaffolding; the conventions workflow | conventions         | none      |
| 2   | #4  | `chore/p02-02-toolchain`     | `f306592857` | #3     | Node 24 / pnpm 10 / Turborepo pins, the lint and boundary baseline        | conventions         | none      |
| 3   | #5  | `feat/p02-03-skeleton`       | `0eea92f8d3` | #4     | monorepo skeleton, four role entrypoints, config, logging, Dockerfile     | conventions         | none      |
| 4   | #6  | `chore/p02-04-local-stack`   | `dc58a03e29` | #5     | six-service local stack, migrations, seeds, doctor                        | conventions         | none      |
| 5   | #7  | `test/p02-05-harness`        | `e7bddc75dd` | #6     | Vitest projects, the PostgreSQL harness, German factories                 | conventions         | none      |
| 6   | #8  | `chore/p02-06-ci`            | `dd0485e5dd` | #7     | verify, security-scan and container-scan workflows                        | **all 5 workflows** | none      |
| 7   | #9  | `docs/p02-07-developer-docs` | `90b3b4158b` | #8     | developer guides + the nine walkthrough fixes                             | all 5               | none      |
| 8   | #10 | `docs/p03-01-adrs`           | `906b56850b` | #9     | the ADR process and fourteen ADRs                                         | all 5               | none      |
| 9   | #11 | `docs/p03-02-domain-model`   | `66270cbaae` | #10    | glossary, entity model, intents, events, state machines                   | all 5               | none      |
| 10  | #12 | `docs/p03-06-data-inventory` | `b9f29969dc` | #11    | field-level personal-data inventory and retention matrix                  | all 5               | none      |
| 11  | #13 | `docs/p03-04-diagrams`       | `07ab552346` | #12    | C4 context and container diagrams, the data-flow diagram                  | all 5               | none      |
| 12  | #14 | `docs/p03-05-threat-model`   | `4beb298149` | #13    | STRIDE threat model, legal briefing pack, invariant register              | all 5               | none      |
| 13  | #15 | `chore/p02-02-qg01-gates`    | `96a70c2aa0` | #14    | replaces the always-failing gate stub with the fourteen real gates        | all 5               | none      |

Why the order is forced, in one line each: **#4 needs #3's** conventions workflow and the Node pin
it reads; **#5 needs #4's** TypeScript, lint and boundary configuration to compile and pass;
**#6 needs #5's** packages to migrate and seed against; **#7 needs #6's** running services;
**#8 needs #7's** test projects to run in CI; **#9 documents #8's** pipeline; **#10–#14** each cite
the documents below them and are checked by scripts that resolve those citations; **#15 must be
last**, because every command its gates run is added by a pull request above it.

## Merge method: create a merge commit — _not_ squash, _not_ rebase

This was simulated against the real branches before being recommended.

| method           | result                                                                                                          |
| ---------------- | --------------------------------------------------------------------------------------------------------------- |
| **merge commit** | **13 / 13 merge cleanly**, and `main`'s tree afterwards is byte-identical to `96a70c2`'s tree (`9335d953ae09…`) |
| squash           | conflicts at step 2 and at every step after it                                                                  |
| rebase           | clean through step 6, conflicts at #9                                                                           |

The reason is structural, not incidental. A squash of #3 puts _new_ commits on `main` that are not
ancestors of #4's branch, so the merge base for #4 falls back to `e6b72eb` — before either side
existed — and every file both sides contain becomes an add/add conflict with no common version to
merge against. The deeper the stack, the worse it gets. Rebase fails for a different reason: three
of these branches carry merge commits from keeping the stack current, and flattening them drops the
resolution that was recorded in them.

**This does not weaken the branching model.** PLAN L1692 specifies linear history and squash-merged
pull requests on a protected `main`. That ruleset is EXT-24 and is applied _after_ this stack lands
(founder action F2, which PLAN gates on P02.06 reaching `main`). History that predates a
linear-history rule does not violate it; the rule blocks new merge commits from the moment it is
enabled. Every pull request opened after this stack is a single short-lived branch off `main` and
squashes cleanly, which is the case the convention was written for.

### Verifying the result

After #15 is merged, `main`'s tree must equal the tree of `96a70c2`:

```sh
git fetch origin
test "$(git rev-parse origin/main^{tree})" = "9335d953ae09a22aca3d9b36e71fbf3d5024d2e9" \
  && echo "main matches the verified integrated state"
```

If it does not match, something was merged out of order or a conflict was resolved by hand; stop
before merging anything else.

## After the queue

1. **F2 — apply the ruleset (EXT-24).** Required checks `verify`, `security-scan`, `container-scan`;
   linear history; no force-push; no deletion. This is P02.01.01, still unticked.
2. **P02.06.07** — the four negative-control pull requests, which can only prove the pipeline
   rejects bad changes once the pipeline is the thing guarding `main`.
3. Delete the thirteen merged branches. The two worktrees (`moin-gates`, `moin-p04`) must be removed
   with `git worktree remove` first, or their branches cannot be deleted.

## What this queue is not

It is not a claim that P02 and P03 are complete. All currently internally executable P02 and P03
work has been implemented and individually verified; the external items — EXT-24 (the ruleset,
which blocks P02.01.01, P02.01.07 and P02.06.07) and EXT-02 (external counsel, which blocks
P03.07.03 and P03.07.04) — remain open and are unaffected by merging.

# P06.13 CI wiring — founder patch (control plane is founder-owned)

The cross-tenant suite (`apps/server/src/modules/xsuite/`) runs inside the existing
`integration` vitest project, so it already executes wherever `pnpm test:integration`
runs. What makes it RELEASE-BLOCKING (P06.13.05, LG-P01) is the coverage report as
evidence plus an explicit CI step that fails the pipeline when the suite fails.

## Patch 1 — `package.json`: coverage report script

Add alongside `test:integration`:

```json
"xsuite:report": "node --env-file-if-exists=.env ./node_modules/vitest/vitest.mjs run --project integration apps/server/src/modules/xsuite/ --reporter=json --outputFile=test-results/xsuite.json"
```

The JSON report lands at `test-results/xsuite.json` next to the existing junit
output. The evidence record (EV-P06-059) links the CI run artifact.

## Patch 2 — `.github/workflows/verify.yml`: blocking step

In the job that runs `pnpm test:integration`, add AFTER it:

```yaml
- run: pnpm xsuite:report
- uses: actions/upload-artifact@v4
  with:
    name: xsuite-coverage
    path: test-results/xsuite.json
```

No new job, no new workflow: the suite blocks the same `verify` gate every other
integration test blocks. LG-P01 reads the artifact, not a badge.

## Why a patch, not a commit

`.claude/gates.json`, `.github/workflows/` and `package.json` scripts that define
gates are founder-owned control plane (protected-paths). Sessions may not edit
them; the founder applies this patch with an editor outside the session.

## Status

- Suite: `apps/server/src/modules/xsuite/cross-tenant.integration.test.ts`
  (10 tests) + `routes.test.ts` (1 test) — green locally, full gates 14/14.
- Patch: NOT YET APPLIED — P06.13.05 stays READY_FOR_REVIEW until the founder
  applies it and CI shows the `xsuite-coverage` artifact on a green run.

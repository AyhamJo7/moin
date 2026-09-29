# EV-P02-045: The container-scan workflow is green: hadolint, arm64 build, image assertions, Trivy

| Field | Value |
|---|---|
| Evidence ID | EV-P02-045 |
| Item | P02.06.03 |
| Date (UTC) | 2026-09-28 17:07 UTC |
| Commit | `aa643ef093e3a1d26e7647789bf8509d4281d40e` |
| Environment | GitHub Actions, ubuntu-24.04 |
| Command / procedure | Run https://github.com/AyhamJo7/moin/actions/runs/36455052856 at commit aa643ef, conclusion success, job "hadolint, build, trivy image" 4m29s. hadolint at --failure-threshold warning; buildx build for linux/arm64; then the assertion step, which is the part worth having: it checks Architecture is arm64, Config.User is node, and that none of npm, npx, corepack, yarn or pnpm survives into the runtime layer — the build fails rather than the claim drifting. Then a Trivy image scan at HIGH,CRITICAL with ignore-unfixed. |
| Result | PASS. The first attempt failed on hadolint DL3065: setting the platform on each FROM is redundant because it is what buildx already does. Removed; what actually selects the architecture is --platform on the build command, and the assertion proves the result. RECORDED COST: the arm64 build runs under emulation on an x86 runner and takes ~4.5 minutes, and two earlier runs were cancelled by the concurrency group before finishing. That is tolerable now and will not stay tolerable as the image grows; a native arm64 runner is the obvious remedy and is recorded as a follow-up rather than left to be rediscovered. |
| CI run / artifact | https://github.com/AyhamJo7/moin/actions/runs/36455052856 |
| Reviewer | pending |

Sensitive material is stored by reference only (PLAN.md evidence rules).

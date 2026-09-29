# EV-P02-038: pnpm onlyBuiltDependencies allowlist; no unreviewed install scripts

| Field | Value |
|---|---|
| Evidence ID | EV-P02-038 |
| Item | P02.08.03 |
| Date (UTC) | 2026-09-28 16:47 UTC |
| Commit | `4e723368a81551da43ec157e866362437f25b22f` (working tree had uncommitted changes) |
| Environment | local |
| Command / procedure | pnpm-workspace.yaml lists onlyBuiltDependencies with a reason beside each entry: esbuild (platform binary for vite/vitest) and the sharp/libvips platform packages (Next.js image optimisation). pnpm 10 blocks lifecycle scripts by default, so anything not listed cannot execute code at install time — an unreviewed postinstall is arbitrary code execution on every developer machine and every CI runner. The Dockerfile additionally passes --ignore-scripts in both the dependency and production-dependency stages, so the control survives a change to the pnpm configuration rather than depending on its default. Verified: pnpm install --frozen-lockfile reports no ignored build scripts. |
| Result | PASS — the allowlist is explicit, justified per entry and enforced at two independent layers. |
| CI run / artifact | pending |
| Reviewer | pending |

Sensitive material is stored by reference only (PLAN.md evidence rules).

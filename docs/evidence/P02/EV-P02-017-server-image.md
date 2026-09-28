# EV-P02-017: Multi-stage ARM64 image: non-root, read-only-FS compatible, no package manager at runtime

| Field | Value |
|---|---|
| Evidence ID | EV-P02-017 |
| Item | P02.03.06 |
| Date (UTC) | 2026-09-28 12:29 UTC |
| Commit | `f3065928572a2c60d699f2fb26e1e60dec550be3` (working tree had uncommitted changes) |
| Environment | local (docker buildx 0.37.1, BuildKit, linux/arm64 via emulation) |
| Command / procedure | apps/server/Dockerfile: base pinned by digest (node@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6), four stages (deps, build, prod-deps, runtime). Built: docker buildx build --platform linux/arm64 -f apps/server/Dockerfile -t moin-server:p02-arm64 --load . -> exit 0. Inspected: Architecture arm64, USER node (uid=1000(node) gid=1000(node) confirmed with docker exec id). Ran with --read-only --tmpfs /tmp --security-opt no-new-privileges: all roles serve normally. Runtime layer contains no package manager (command -v pnpm corepack -> none) and zero dev toolchain packages (grep for typescript@\|eslint@\|prettier@\|vitest@\|turbo in node_modules/.pnpm -> 0). |
| Result | PASS. Image size 84.9 MB. The first version was 589 MB: it ran `pnpm install --prod` layered on the development install, which prunes nothing because the packages are already unpacked in the store, and shipped turbo, typescript, eslint, prettier and vitest into the runtime layer. A separate prod-deps stage built from the base image fixed it — a 7x reduction and the removal of a build toolchain from the running container. |
| CI run / artifact | pending |
| Reviewer | pending |

Sensitive material is stored by reference only (PLAN.md evidence rules).

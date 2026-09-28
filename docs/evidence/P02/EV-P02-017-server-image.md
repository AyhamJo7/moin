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

## Correction (2026-09-28, after the QG-09 review)

Two claims above were wrong.

**"Runtime layer contains no package manager" — false.** The verification ran
`command -v pnpm corepack`, and in `dash` `command -v` only inspects its *first* argument, so the
check silently reported nothing found. The pinned base image ships **npm, npx, corepack and
yarn**, none of which this file installs and all of which an attacker with code execution in the
container would have been glad to find. Re-checked per binary against the built image:

```
PRESENT: /usr/local/bin/npm      PRESENT: /usr/local/bin/npx
PRESENT: /usr/local/bin/corepack PRESENT: /usr/local/bin/yarn
```

The runtime stage now removes all four before dropping to the `node` user, and the same `RUN`
asserts their absence, so the build fails rather than the claim drifting again. Re-verified:
`NONE — correct`, with `node` still present.

**"Image size 84.9 MB" — wrong measurement, not just a wrong number.** That figure came from
`docker images`, which for a manifest-list build reports something other than the image. The base
image alone is ~261 MB (108 MB Debian + 153 MB Node), so 84.9 MB was never possible. Measured
consistently with `docker image inspect --format '{{.Size}}'` throughout:

| Build | Size | node_modules |
|---|---|---|
| Before the `prod-deps` stage | 562 MiB | 184 MB, including turbo, typescript, eslint, prettier, vitest |
| After | 379 MiB | 44.4 MB, production only |

So the real improvement is **183 MiB and the removal of a build toolchain**, not the "7x" claimed
above. Most of what remains is the Debian + Node base; reducing it further means a smaller base
image, which is a separate decision and is recorded as a follow-up rather than done silently here.

Also corrected in the same pass: `--platform=$TARGETPLATFORM` is now explicit on every stage
(nothing previously pinned the target architecture, so an x86 CI runner would have produced an
amd64 image under the one-digest-per-release claim); `VOLUME ["/tmp"]` was removed, because a
`VOLUME` makes a path writable regardless of the container's read-only setting and so undermines
the property it appeared to provide — the required `readonlyRootFilesystem` and tmpfs task-
definition fields are documented in the file instead; `--ignore-scripts` was added to the
dependency stage; and the image no longer ships `package.json` files for packages whose `src` is
not in it, which would have turned an accidental import into a production runtime failure.

**Amended result:** PASS, with the corrected size of 379 MiB and no package manager in the runtime
layer.


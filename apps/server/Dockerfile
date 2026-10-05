# syntax=docker/dockerfile:1.19
#
# One image per release; the role is chosen by the start command (INV-17). Building four images
# would make "which code is in production" four questions instead of one, and would let the voice
# role drift from the API role between deploys.
#
# The base is pinned by digest, not by tag: `node:24.21.0-bookworm-slim` is mutable and a
# rebuild months later would silently produce a different image for the same source commit.

# The target architecture is selected by `docker buildx build --platform linux/arm64`, not here:
# `FROM --platform=$TARGETPLATFORM` is what buildx already does, so stating it is redundant
# (hadolint DL3065). The container-scan job asserts the built image really is arm64, because a
# digest alone does not guarantee the platform that was built.
ARG NODE_IMAGE=node@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6

# ---------------------------------------------------------------- dependencies
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
ENV CI=true PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable

# Only the manifests, so this layer is reused on every build that does not change a dependency.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc* ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/ai/package.json packages/ai/
COPY packages/config/package.json packages/config/
COPY packages/contracts/package.json packages/contracts/
COPY packages/db/package.json packages/db/
COPY packages/integrations/package.json packages/integrations/
COPY packages/kernel/package.json packages/kernel/
COPY packages/observability/package.json packages/observability/
COPY packages/telephony/package.json packages/telephony/
COPY packages/testing/package.json packages/testing/
COPY packages/ui/package.json packages/ui/

# --frozen-lockfile so a build can never silently resolve a different dependency tree than the
# one that was reviewed and scanned.
# --ignore-scripts here too, not only in prod-deps: pnpm 10 plus onlyBuiltDependencies already
# blocks unreviewed lifecycle scripts, but stating it means the control survives a pnpm config
# change rather than depending on a default.
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --ignore-scripts --filter @moin/server... --filter .

# ---------------------------------------------------------------- build
FROM deps AS build
WORKDIR /app
COPY . .
RUN pnpm --filter @moin/server... build

# ---------------------------------------------------------------- production dependencies
#
# A separate stage from the base image, not `--prod` layered on top of `deps`.
#
# Running `pnpm install --prod` over an existing development install prunes nothing: the packages
# are already unpacked in the store and stay on disk. The first version of this file did exactly
# that and shipped turbo, typescript, eslint, prettier and vitest into the runtime image — 589 MB,
# most of it a build toolchain that an attacker in the container would have been delighted to find.
FROM ${NODE_IMAGE} AS prod-deps
WORKDIR /app
ENV CI=true PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc* ./
# Only the four packages @moin/server actually depends on. Shipping a package.json whose `src`
# is not in the image turns an accidental import into a runtime failure in production rather
# than a build failure here.
COPY apps/server/package.json apps/server/
COPY packages/contracts/package.json packages/contracts/
COPY packages/db/package.json packages/db/
COPY packages/kernel/package.json packages/kernel/
COPY packages/observability/package.json packages/observability/

RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --prod --ignore-scripts --filter @moin/server...

# ---------------------------------------------------------------- runtime
FROM ${NODE_IMAGE} AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    NODE_OPTIONS=--enable-source-maps \
    PORT=3000

# Security updates from bookworm-security (fixed versions available upstream).
# CVE-2026-103111 (libpcre2-8-0) was fixed the same way before; the perl-base CVEs below
# (CVE-2026-13221, CVE-2026-42496, CVE-2026-8376 et al.) gained fixed versions since the base
# image was cut. Pins exact Debian security package versions (hadolint DL3008).
RUN apt-get update -qq \
 && apt-get install -y --no-install-recommends libpcre2-8-0=10.42-1+deb12u2 perl-base=5.36.0-7+deb12u4 \
 && rm -rf /var/lib/apt/lists/*

# The base image ships npm, npx, corepack and yarn. A review caught the earlier claim that this
# layer had "no package manager": it had four, because they come from the base rather than from
# anything this file installs. An attacker with code execution in the container otherwise has a
# working installer and network fetcher. Removed before the user is dropped.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
    /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
    /usr/local/bin/yarn /usr/local/bin/yarnpkg /opt/yarn-v* \
 && ! command -v npm && ! command -v npx && ! command -v corepack && ! command -v yarn

COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=prod-deps --chown=node:node /app/apps/server/node_modules ./apps/server/node_modules
COPY --from=build --chown=node:node /app/apps/server/dist ./apps/server/dist
COPY --from=build --chown=node:node /app/apps/server/package.json ./apps/server/

# Each workspace package's own node_modules is a symlink farm into the store, and it is how
# `@moin/observability` resolves `pino` at runtime. Copying only `src` and `package.json` left
# those links behind and the container died on its first import.
COPY --from=prod-deps --chown=node:node /app/packages ./packages

# The workspace packages ship as TypeScript sources and are type-stripped by Node 24 at runtime
# (ADR-0002). Only `src` is added on top — no tests, no fixtures, no build config.
COPY --from=build --chown=node:node /app/packages/contracts/src ./packages/contracts/src
COPY --from=build --chown=node:node /app/packages/db/src ./packages/db/src
COPY --from=build --chown=node:node /app/packages/kernel/src ./packages/kernel/src
COPY --from=build --chown=node:node /app/packages/observability/src ./packages/observability/src

# `node` (uid 10xx) ships with the base image. Running as root would mean a process escape starts
# with root in the container's namespace.
USER node

# Deliberately NO `VOLUME ["/tmp"]`. A VOLUME instruction creates an anonymous volume on every
# `docker run` and makes the path writable regardless of the container's read-only setting, so it
# undermines the property it looks like it is providing. Scratch space is declared where it is
# actually enforced and bounded:
#   ECS task definition: readonlyRootFilesystem: true, plus
#                        { "name": "tmp", "host": {} } mounted at /tmp (or a tmpfs entry)
#   docker run / compose: --read-only --tmpfs /tmp
# Verified: the image runs correctly under `--read-only --tmpfs /tmp`.

EXPOSE 3000

# No HEALTHCHECK: the orchestrator (ECS) polls /healthz and /readyz itself, and a container-level
# health check would duplicate that with different semantics and no visibility.

# Overridden per role: main-api.js · main-voice.js · main-worker.js · main-migrate.js
CMD ["node", "apps/server/dist/main-api.js"]

# syntax=docker/dockerfile:1.19
#
# One image per release; the role is chosen by the start command (INV-17). Building four images
# would make "which code is in production" four questions instead of one, and would let the voice
# role drift from the API role between deploys.
#
# The base is pinned by digest, not by tag: `node:24.21.0-bookworm-slim` is mutable and a
# rebuild months later would silently produce a different image for the same source commit.

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
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter @moin/server... --filter .

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
COPY apps/server/package.json apps/server/
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

RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --prod --ignore-scripts --filter @moin/server...

# ---------------------------------------------------------------- runtime
FROM ${NODE_IMAGE} AS runtime
WORKDIR /app

# No corepack, no pnpm, no build toolchain in the runtime layer: a package manager in a running
# container is an installer an attacker can use, and it is never needed after the build.
ENV NODE_ENV=production \
    NODE_OPTIONS=--enable-source-maps \
    PORT=3000

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

# Read-only-root-filesystem compatible: nothing is written under /app at runtime. Anything that
# genuinely needs scratch space gets a tmpfs mount, declared here so it is visible.
VOLUME ["/tmp"]

EXPOSE 3000

# No HEALTHCHECK: the orchestrator (ECS) polls /healthz and /readyz itself, and a container-level
# health check would duplicate that with different semantics and no visibility.

# Overridden per role: main-api.js · main-voice.js · main-worker.js · main-migrate.js
CMD ["node", "apps/server/dist/main-api.js"]

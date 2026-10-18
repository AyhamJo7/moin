# syntax=docker/dockerfile:1.19
#
# The owner app (ADR-0001 role `web`), built from the same repository and pinned the same way as
# the server image. Next's `standalone` output is a self-contained server; the two things it does
# NOT include are `.next/static` (every script and stylesheet the browser loads) and `public/`.
# Both are copied below, and the container-scan job fetches a real asset from a running container,
# because an image that starts and renders HTML but serves 404 for its scripts passes `next build`
# and looks fine until a browser hydrates it.
#
# No `OWNER_API_PROXY_ORIGIN`: that is the local-development proxy and next.config.ts refuses a
# non-loopback value. Deployed, a load balancer sends `/api/*` to the API and everything else here.
ARG NODE_IMAGE=node@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6

# ---------------------------------------------------------------- dependencies
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
ENV CI=true PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc* ./
COPY apps/web/package.json apps/web/
COPY packages/contracts/package.json packages/contracts/

RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --ignore-scripts --filter @moin/web...

# ---------------------------------------------------------------- build
FROM deps AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY packages/config packages/config
COPY packages/contracts packages/contracts
COPY apps/web apps/web
RUN pnpm --filter @moin/web build

# ---------------------------------------------------------------- runtime
FROM ${NODE_IMAGE} AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# Same hardening as the server image: no package manager in the layer an attacker lands in.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
    /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
    /usr/local/bin/yarn /usr/local/bin/yarnpkg /opt/yarn-v* \
 && ! command -v npm && ! command -v npx && ! command -v corepack && ! command -v yarn

COPY --from=build --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /app/apps/web/public ./apps/web/public

USER node

EXPOSE 3000

# Configuration arrives at run time: OWNER_API_ORIGIN (where the server render reads Today).
CMD ["node", "apps/web/server.js"]

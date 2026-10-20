# ADR-0025 — Owner web app: frontend architecture and design system

- **Status:** PROPOSED (pending founder acceptance; UX-01 Gate 0). Documented, not implemented: no dependency named here is installed yet. Accepting this ADR doesn't take DG-10 or unblock P13.01; see the [DG-10 record](../decisions/DG-10-owner-app-visual-language.md).
- **Deciders:** founder
- **Phase:** P13
- **Related:** DG-10, ADR-0001, ADR-0034, INV-02, INV-12, INV-17, QG-03, QG-09

## Context

PLAN's ADR register names this record "Frontend architecture": "Next.js App Router, same-origin API, TanStack Query + SSE, next-intl (de default), headless accessible UI, CSP nonces". P13 adds "headless accessible primitives + Tailwind".

The owner app was built correctness-first (M1/M2):

- Heute is a server component that reads `GET /api/today`, forwarding only the session cookie. The tenant comes from the session (INV-02).
- A callback is completed through a version-guarded `POST /api/tasks/:id/complete` carrying the CSRF synchronizer header.
- An open page stays current by bounded polling and `router.refresh()`.
- The app has no stylesheet beyond an inline `<style>` in `app/layout.tsx`, no tokens and no components. `@moin/ui` is a placeholder. DG-10 is provisional ([record](../decisions/DG-10-owner-app-visual-language.md)).

Of the register's parts:

- **already built:** App Router server rendering, the same-origin API, CSP nonces;
- **without a consumer:** TanStack Query with SSE (the API has no event stream), next-intl (the app uses a typed German catalogue), and a headless primitive library (no dialog, menu or overlay exists).

Adopting those now adds dependencies with nothing to use them. Not recording them would leave the register and the code silently apart.

**Constraints:**

- one release image whose `web` role is Next's standalone server, with `.next/static` and `public/` copied next to it and fetched by `scripts/check-web-image.sh` (INV-17, ADR-0001);
- the CSP with a per-request nonce (`apps/web/middleware.ts`, P13.13);
- the production licence allowlist (`scripts/check-licences.ts`);
- `pnpm install --frozen-lockfile --ignore-scripts`, with install scripts allowed only for esbuild and sharp (`pnpm-workspace.yaml`);
- WCAG 2.2 AA (P13.12);
- German first (BR-060).

## Decision

**D1 — Recorded as built.**

- Next.js App Router with server-rendered pages.
- The owner app calls only the same-origin `/api/*`, typed by `@moin/contracts`.
- Server code forwards only the session cookie; the browser never sends a tenant (INV-02).
- Mutations carry the CSRF header.
- `middleware.ts` sets a per-request CSP nonce.
- Client components exist only for interaction: `CompleteAction` with `ActionNotice`, and `LiveToday`. The redesign adds no client-side authenticated request.

**D2 — Styling pipeline.**

- Tailwind CSS **4.3.3** with `@tailwindcss/postcss` **4.3.3** and `postcss`, pinned exactly, as **devDependencies of `apps/web`**.
- `next build` compiles the CSS into a hashed file under `.next/static`, which the image already copies. Nothing is added to the runtime image beyond that stylesheet.
- Design tokens live as CSS custom properties in `packages/ui/src/tokens.css` under `@theme` ([DESIGN.md](../design/DESIGN.md) §3).
- No CSS-in-JS runtime, no inline `style` props in components, no web fonts (the system UI stack).

**D2 wiring.** These are planned changes, written against the repository as it stands at Gate 0:

- `@moin/web` doesn't yet depend on `@moin/ui`.
- `@moin/ui` exports only `.` (`./src/index.ts`).
- `next.config.ts` transpiles only `@moin/contracts`.
- The root `.gitignore` ignores `dist/`, `.next/` and `node_modules/`.
- `.dockerignore` excludes `docs`.

None of the following has been built or run, and the output paths and resolution details below are unverified until the gate that adds the dependencies proves them.

1. **Stylesheet entry point:** a new `apps/web/app/globals.css`, imported once from `apps/web/app/layout.tsx` (`import './globals.css';`). It replaces that layout's inline `<style>` block.

   ```css
   @import 'tailwindcss' source('..');
   @import '@moin/ui/tokens.css';
   @source '../../../packages/ui/src';
   @source not '../../../packages/ui/src/**/*.test.*';
   ```

2. **PostCSS:** `apps/web/postcss.config.mjs` registers `@tailwindcss/postcss`. Its default export is framework-required (A-22).
3. **Tokens export:** `packages/ui/package.json` gains `"./tokens.css": "./src/tokens.css"` in `exports`, so the second `@import` resolves through the workspace link. The gate confirms that Tailwind's resolver honours that export. If it doesn't, the import becomes the relative path `../../../packages/ui/src/tokens.css`, and the gate records which form is used.
4. **Workspace link:** `@moin/web` adds `"@moin/ui": "workspace:*"`, and `transpilePackages` becomes `['@moin/contracts', '@moin/ui']`, because `@moin/ui`, like `@moin/contracts`, ships TypeScript source.
5. **Source scanning.**
   - **Base path:** `source('..')` pins Tailwind's automatic detection to `apps/web`, relative to the stylesheet, so the result doesn't depend on the directory the build runs from (pnpm filter, turbo or the image).
   - **What automatic detection skips:** files ignored by `.gitignore` (so `.next/` and `packages/ui/dist/`), everything under `node_modules` (so the `@moin/ui` workspace symlink in `apps/web/node_modules`), CSS files and lock files.
   - **Registering `@moin/ui`:** its sources lie outside the base path and would also be reached only through `node_modules`, so they are **not** found automatically. The explicit `@source` registers `packages/ui/src`, and `@source not` keeps its test files out.
   - **Mock-ups:** `docs/design/review/mockups/` is outside every registered path and excluded from the image build context, so its classes never reach the bundle.
6. **Build and image output:**
   - `next build` emits the compiled stylesheet as a hashed file under `.next/static/`, which the image already copies next to the standalone server (`apps/server/Dockerfile`).
   - The deps stage already copies `packages/ui/package.json`, and `--filter @moin/web...` installs `@moin/ui`'s dependencies once the workspace link exists. No Dockerfile change is expected; the gate shows whether one is needed.

**Proof required at adoption, on the production standalone image, not on `next dev`:**

- the built CSS contains a token from `tokens.css` and a utility used only inside `packages/ui/src`, which proves the explicit source registration;
- `scripts/check-web-image.sh`, extended to require at least one `.css` asset with `text/css`, passes against the built image (amd64 and arm64);
- the vertical-slice spec reads a computed token value on Heute from the standalone server (for example, the body background `rgb(246, 245, 242)`), and no `securitypolicyviolation` fires;
- `check-licences.ts` and `pnpm audit --prod` pass with the new dependencies.

**D3 — Shared UI components.**

- `@moin/ui` holds presentational, data-agnostic components written and reviewed in this repository. They may follow the source conventions of shadcn/ui, but its CLI and registry are not a dependency.
- Runtime dependencies of `@moin/ui`, pinned exactly at adoption: `class-variance-authority`, `clsx`, `tailwind-merge`, `lucide-react`.
- **Boundary:** `@moin/ui` imports nothing from `@moin/contracts`, `next/headers`, `fetch` or `apps/web`. Data mapping stays in `apps/web`.

**D4 — Deferred, with the trigger that revives each.**

| Technology                                         | Trigger                                                            |
| -------------------------------------------------- | ------------------------------------------------------------------ |
| Headless primitives (Base UI, Radix or React Aria) | the first dialog, menu, popover or drawer the product needs        |
| TanStack Query with an SSE subscription            | P13.10.01: the API ships an authenticated event stream             |
| next-intl                                          | P13.01.03: a second locale or ICU message formatting is needed     |
| Dark mode                                          | after the light design ships and passes an owner usability session |
| A web font                                         | a founder decision to add its licence to the allowlist             |

**D5 — Accessibility standard.** WCAG 2.2 AA:

- zero axe violations in every UX-01 state and viewport;
- contrast pairs from DESIGN.md asserted in a unit test;
- 44 px targets;
- visible focus;
- reflow at 320 px;
- reduced motion honoured;
- a manual NVDA and VoiceOver pass per release (P13.12.02, QG-03).

**D6 — Visual regression.**

- Playwright's built-in `toHaveScreenshot`, with deterministic synthetic data, in a pinned browser environment.
- Baselines are committed and reviewed as images in a PR. On CI `updateSnapshots` is `none`, so CI never writes a baseline.
- A changed baseline enters only through a human-reviewed commit.
- Screenshots supplement, never replace, functional and accessibility assertions ([visual-regression-plan.md](../design/visual-regression-plan.md)).

## Alternatives considered

| Option                                                                          | Why not                                                                                                                                            |
| ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Adopt the whole register entry now (TanStack Query, SSE, next-intl, primitives) | no consumer; adds dependencies, supply-chain surface and review load for features that don't exist                                                 |
| CSS Modules or plain global CSS                                                 | workable; P13 names Tailwind, and tokens as utilities keep many small components consistent                                                        |
| Runtime component library (MUI, Chakra, Mantine)                                | imposes its own look and theming runtime, conflicts with DG-10 and with tightening `style-src` later, and the app ends up looking like the library |
| shadcn/ui through its CLI and registry                                          | fetches remote registry content and writes files when run; useful as a pattern source, not as a generator merged unreviewed                        |
| A web font (for example, Inter)                                                 | OFL-1.1 isn't on the allowlist; `next/font/google` downloads at build time, which a reproducible arm64 image build shouldn't depend on             |
| Hosted visual testing (Chromatic, Percy, Argos)                                 | needs an account and token, sends screenshots off our infrastructure, and costs money                                                              |

## Consequences

**Single image.** Unchanged: one image and one standalone `web` role. The only new runtime artefact is a static CSS file under `.next/static`, served by the same server and allowed by `style-src 'self'`. Tailwind's native compilers (`@tailwindcss/oxide`, `lightningcss`) are build-time only and come as per-platform optional packages with no install script, including linux-arm64. The arm64 image build and `check-web-image.sh` must prove this when the dependencies are added.

**Security.**

- No new network path, runtime role or environment variable.
- The CSP stays as is. Removing `'unsafe-inline'` from `style-src` becomes possible because components take no inline styles, but it is a separate hardening step.
- New runtime dependencies (`clsx`, `tailwind-merge`, `class-variance-authority`, `lucide-react`) are MIT, Apache-2.0 or ISC, which the allowlist already permits. They join the existing `pnpm audit --prod` and licence gates.

**Maintenance.** Renovate batches minor updates. Tailwind major versions are read on their own.

**Rollback.** Each UX-01 gate lands as its own squash-merged PR that adds its dependencies, tokens, components and baselines together. Reverting that PR removes all of them with no data or API migration, because the redesign changes no contract.

**Becomes harder.** Adding a dependency to `@moin/ui` needs an amendment here. Overlay work must first settle D4's primitive library.

**Wrong call if** the product needed runtime per-tenant theming beyond the brand name. Tokens would then need a runtime layer.

## Verification

| Enforcement                                                             | Where                                                                                          |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Stylesheet served from the image as `text/css`, at least one referenced | `scripts/check-web-image.sh` (the at-least-one assertion is added with the dependencies)       |
| CSP with nonce present, no blocked script or style on Heute             | vertical-slice Playwright spec (console-error check plus a `securitypolicyviolation` listener) |
| `@moin/ui` imports no contracts, Next server modules or app code        | `.dependency-cruiser.cjs` rule, added with the first component                                 |
| Token contrast pairs meet WCAG thresholds                               | `packages/ui/src/tokens.test.ts` (P13.01.05)                                                   |
| Zero axe WCAG 2.2 AA violations per state and viewport                  | vertical-slice accessibility spec                                                              |
| No horizontal overflow from 320 to 1920 px                              | vertical-slice responsive spec                                                                 |
| Baselines change only through a reviewed commit                         | `toHaveScreenshot` with `updateSnapshots: 'none'` on CI                                        |
| Production licences stay on the allowlist                               | `scripts/check-licences.ts` (security-scan workflow)                                           |
| Exact dependency versions                                               | exact specifiers and `pnpm-lock.yaml`                                                          |

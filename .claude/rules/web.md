---
paths:
  - "apps/web/**"
  - "packages/ui/**"
---

# Owner web app and UI

Read first: `python3 .claude/bin/plan_section.py --id QG-02` and `--section "Authentication and sessions (ADR-0005)"`.

- QG-02: Playwright smoke (Chromium), axe on changed routes, i18n missing-key check on every PR here.
- Named exports only, except Next.js route files where the framework requires default exports (A-22).
- No `dangerouslySetInnerHTML`; no `console.*` in production code; strict TypeScript, no `any`.
- Tenant identity never comes from the browser (INV-02); screenshots and fixtures use the demo tenant
  only (no personal data).

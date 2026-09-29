# EV-P02-002: ADR-0002 (toolchain and runtime baseline) and ADR-0034 (naming and brand decoupling) accepted

| Field | Value |
|---|---|
| Evidence ID | EV-P02-002 |
| Item | P02.02.09 |
| Date (UTC) | 2026-09-28 11:39 UTC |
| Commit | `766f53e2804a53cf0930e0047669c1cd8abb66e8` (working tree had uncommitted changes) |
| Environment | local (WSL2 Ubuntu) |
| Command / procedure | docs/adr/0002-toolchain-and-runtime-baseline.md and docs/adr/0034-naming-and-brand-decoupling.md written with Status: Accepted (P02.02.09, 2026-09-28). Pins recorded and verified against the installed toolchain: node -v -> v24.21.0 (.nvmrc 24.21.0); pnpm -v -> 10.34.5 (packageManager pnpm@10.34.5, resolved by corepack); typescript 6.0.3; eslint 10.11.0; typescript-eslint 8.70.1; prettier 3.9.9; dependency-cruiser 18.4.0; turbo 2.11.5; vitest 5.0.2; vite 8.3.1; terraform version -> v1.16.4 (.terraform-version 1.16.4); tflint --version -> 0.64.0; trivy --version -> 0.74.0; gitleaks version -> 8.30.1. |
| Result | PASS — both ADRs accepted and every pin matches the installed toolchain. ADR-0002 records one open item: TypeScript 6.0.3 was chosen over 7.0.2 because typescript-eslint@8.70.1 declares typescript >=4.8.4 <6.1.0, and TS 6 is marked VALIDATION REQUIRED against Next.js and NestJS, which arrive in P02.03. |
| CI run / artifact | pending |
| Reviewer | pending |

Sensitive material is stored by reference only (PLAN.md evidence rules).

# EV-P02-035: Licence allowlist for production dependencies, with a real finding resolved

| Field | Value |
|---|---|
| Evidence ID | EV-P02-035 |
| Item | P02.08.02 |
| Date (UTC) | 2026-09-28 16:47 UTC |
| Commit | `4e723368a81551da43ec157e866362437f25b22f` (working tree had uncommitted changes) |
| Environment | local |
| Command / procedure | scripts/check-licences.ts evaluates pnpm licenses list --prod --recursive against an SPDX allowlist, handling disjunctions (any allowed term suffices) and conjunctions (every term must be allowed). Undetermined licences fail rather than warn. Run over the real tree, it found exactly one violation: @img/sharp-libvips-linux-x64 is LGPL-3.0-or-later, reached through sharp, reached through Next.js image optimisation. 7 unit tests plus four executable negative controls (--fixture agpl\|sspl\|gpl\|unknown, each exit 1). |
| Result | PASS after a documented decision. LGPL is allowed for this product and AGPL is not, and the distinction is the point: LGPL obligations attach on DISTRIBUTION of the work, and running software on our own servers is not distribution — LGPL carries no network clause. AGPL section 13 exists precisely to close that gap and reaches users who interact over a network, which is every caller and every owner here. Recorded in docs/development/licence-policy.md with the reasoning, and FLAGGED FOR THE EXTERNAL LEGAL REVIEW (EXT-02) rather than treated as settled, because it is a legal reading. If that review disagrees the remedy is small and known: disable Next.js image optimisation, the only thing pulling libvips in. |
| CI run / artifact | pending |
| Reviewer | pending; licence reading to be confirmed under EXT-02 |

Sensitive material is stored by reference only (PLAN.md evidence rules).

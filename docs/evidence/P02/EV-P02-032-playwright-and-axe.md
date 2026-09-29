# EV-P02-032: Playwright projects for Chromium, Firefox, WebKit and phone viewports, with axe

| Field | Value |
|---|---|
| Evidence ID | EV-P02-032 |
| Item | P02.05.04 |
| Date (UTC) | 2026-09-28 16:36 UTC |
| Commit | `6f79b0ec3c236853dc3021d5ad9a4eab7ae9612a` (working tree had uncommitted changes) |
| Environment | local (playwright 1.63.0, @axe-core/playwright 4.13.0, chromium installed) |
| Command / procedure | playwright.config.ts declares chromium always, plus firefox, webkit, mobile-chrome (Pixel 7) and mobile-safari (iPhone 14) when PLAYWRIGHT_FULL_MATRIX=true. The matrix is asymmetric on purpose: Chromium on every pull request is the fastest signal, and the other four run nightly under QG-03, because three extra browser runs on every push buys little and slows the loop everyone uses. The browser context is locale de-DE and timezone Europe/Berlin, so a browser negotiating en-US cannot hide a localisation bug. forbidOnly is set in CI, because a stray test.only merged to main would silently skip the rest of the suite. webServer runs the standalone server the container actually runs, not `next start`, which does not support output: standalone and warns about it. Four example tests run against the real app: the home route returns 200; the document declares lang="de" (a screen reader picks its pronunciation from that attribute); the three baseline security headers are present; and an axe scan against wcag2a/2aa/21a/21aa/22aa reports zero violations. |
| Result | PASS — 4/4 in chromium, both in-suite and standalone. RECORDED LIMITATION: only Chromium is installed on this machine. `playwright install --with-deps` requires sudo, which sessions never use, so Firefox and WebKit are downloaded and exercised on the CI runner (P02.06) rather than here. The projects are declared and the matrix switch works; the other four browsers are UNVERIFIED locally and are not claimed as passing. The axe assertion is a floor, not a certificate: automated checks catch roughly a third of real accessibility problems, and the manual keyboard and screen-reader pass per release covers the rest. |
| CI run / artifact | pending |
| Reviewer | pending |

Sensitive material is stored by reference only (PLAN.md evidence rules).

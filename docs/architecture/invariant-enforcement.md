# Invariant enforcement register

Every invariant in `PLAN.md`, and the automated thing that holds it true (P03.08.01).

An invariant with no enforcement is a hope. This register exists so that gap is visible rather than
discovered by an auditor, and `scripts/check-adr-coverage.ts` reads it: an invariant may only be
without an ADR if this file says which phase writes one.

| Column          | Meaning                                                                                                                                                                   |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Enforcement** | The lint rule, CI check, runtime assertion, test or alarm                                                                                                                 |
| **Phase**       | Where that enforcement lands. A future phase means it is not enforced yet — stated, not implied                                                                           |
| **Owner**       | Who answers for it. Today that is the founder for every row; the column exists because it will not stay that way, and an invariant whose owner is "the team" has no owner |

| INV    | What it requires                                           | Enforcement                                                                                                                                                                                            | ADR                          | Phase                             | Owner   |
| ------ | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------- | --------------------------------- | ------- |
| INV-01 | FORCE RLS on every tenant row; runtime role NOBYPASSRLS    | `scripts/check-rls-catalog.ts` in CI; adversarial cross-tenant suite; harness asserts the connecting role is not superuser and not BYPASSRLS                                                           | ADR-0003                     | P06.02                            | founder |
| INV-02 | Tenant context derived server-side only                    | Lint bans session-level `SET`; `withTenant` is the only path; no route reads an organisation id from a request body                                                                                    | ADR-0003, ADR-0005           | P06.03                            | founder |
| INV-03 | Full German AI disclosure before any AI voice session      | Voice-flow test asserting the disclosure precedes the first model turn                                                                                                                                 | ADR-0011                     | P12                               | founder |
| INV-04 | Models hold no credentials and execute nothing             | Tool guard validates every call; model gateway has no credential access; QG-09 review                                                                                                                  | ADR-0011                     | P10                               | founder |
| INV-05 | No commitment without verified tool success                | Eval suite + integration test with an injected tool timeout                                                                                                                                            | ADR-0011                     | P12                               | founder |
| INV-06 | No lost interaction                                        | Reconciler asserting every finalised conversation has an outcome or an open task                                                                                                                       | ADR-0015, ADR-0007           | P07                               | founder |
| INV-07 | No raw call audio persisted                                | Storage assertion in the voice path; test that no object is written during a call                                                                                                                      | ADR-0019                     | P11                               | founder |
| INV-08 | Answers only from approved, valid knowledge                | Retrieval restricted to approved, unexpired items; adversarial evals                                                                                                                                   | ADR-0014                     | P09                               | founder |
| INV-09 | Identity merges deterministic or human-approved            | Merge requires either an exact normalised match or a recorded human approval; merge records are reversible                                                                                             | **ADR-0016 (P07)**           | P07                               | founder |
| INV-10 | Every business mutation writes an append-only audit event  | Trigger-guarded append-only table; revoked UPDATE/DELETE privileges; per-tenant hash chain                                                                                                             | ADR-0017                     | P06                               | founder |
| INV-11 | Every external or retried side effect is idempotent        | Idempotency key per effect; concurrency suite asserts one effect for a repeated delivery                                                                                                               | ADR-0006, ADR-0007           | P08                               | founder |
| INV-12 | No personal data in logs, metrics, traces, analytics, push | Allowlist redactor asserted on the serialised line; `console.*` banned in production code; event payloads are id-only                                                                                  | ADR-0023, ADR-0007           | **P02 (live)**                    | founder |
| INV-13 | Life-safety cases get the reviewed deterministic script    | Deterministic detection path test; emergency eval suite must show zero failures                                                                                                                        | ADR-0039, ADR-0011           | P10                               | founder |
| INV-14 | Excluded sensitive uses do not exist                       | **No automated check is possible**: this is a product-scope constraint. Manual control — the deferred-products list in PLAN.md, and a scope question in the phase-plan template. Reviewed at each gate | — (product scope)            | manual, permanent                 | founder |
| INV-15 | Secrets only in AWS Secrets Manager by ARN                 | No credential column (schema check); gitleaks over full history; configuration errors are shape-only for secret-bearing variables                                                                      | ADR-0020, ADR-0033           | **P02 (partial)**, P05            | founder |
| INV-16 | Production data never leaves production                    | Synthetic factories only; no production credential in any non-production environment; separate AWS accounts                                                                                            | ADR-0021                     | P05                               | founder |
| INV-17 | One image digest per release; expand/contract migrations   | Build once, promote by digest; `scripts/check-migrations.ts`; the image assertion in `container-scan`                                                                                                  | ADR-0001, ADR-0004, ADR-0022 | **P02 (live)**                    | founder |
| INV-18 | No tenant-specific code paths                              | `moin/no-tenant-conditional` lint rule with fixtures                                                                                                                                                   | ADR-0003                     | P02 authored, **P06.03 enforced** | founder |
| INV-19 | A call is never dropped silently                           | Voice failure layers; drain before listener close; failure-injection test asserting a task exists after a killed session                                                                               | ADR-0010, ADR-0001           | P11                               | founder |
| INV-20 | Billing derives from our own immutable usage ledger        | Usage ledger is append-only and is the billing source; reconciliation against the provider is a scheduled job that alarms on divergence                                                                | **ADR-0029 (P23)**           | P23                               | founder |

## Invariants whose ADR is in a later phase

Three invariants have no ADR yet, and each is recorded here rather than left as a gap in the
coverage check:

- **INV-09** — ADR-0016 (customer identity resolution) is written in **P07**, with the code it
  describes. Writing it now would be speculation about a matching algorithm that has not met real
  German names and numbers.
- **INV-20** — ADR-0029 (billing, metering, entitlements) is written in **P23**. The usage ledger's
  shape depends on what is actually metered, which P11 and P12 determine.
- **INV-14** — has no ADR by design. It is a scope constraint, not an architecture decision, and it
  is enforced by the deferred-products list and by review at each gate. An automated check would be
  theatre: no linter can tell whether a feature constitutes an excluded sensitive use.

## What this register is for

When a change is proposed, this is the table that answers "what would have to be true for this to
be safe". When an invariant is weakened — which requires founder approval — this is where the
weakening is visible.

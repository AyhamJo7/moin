// @moin/testing — factories, tenant fixtures, the cross-tenant harness, provider fakes, fault
// injection and clock control.
//
// P02.05 adds the real-Postgres harness, the German synthetic factories, fault injection and the
// controllable clock. The cross-tenant harness and provider fakes arrive with the code they test
// (P06 and P10/P11 respectively).

export { createTestDatabase, TEMPLATE_DATABASE } from './pg/template.ts';
export type { TestDatabase } from './pg/template.ts';

export {
  Seeded,
  germanPerson,
  testPhoneNumber,
  testLandlineNumber,
  asciiFold,
} from './factories/german.ts';
export type { GermanPerson } from './factories/german.ts';

export { withFault, neverSettles, slow, InjectedFault } from './fault/inject.ts';
export type { FaultKind, FaultPlan } from './fault/inject.ts';

// The controllable clock lives in @moin/kernel, because production code depends on the Clock
// interface and a test package must never be a production dependency.
export { fixedClock, systemClock } from '@moin/kernel';
export type { Clock } from '@moin/kernel';

// The mutation-evidence wrapper (P06.10.07). It lives here rather than in `scripts/` because the
// killing tests that use it are spread across packages, and a package's tests already depend on
// this one — `createTestDatabase` arrives the same way. `scripts/mutation-evidence-probe.ts` is the
// Vitest setup file that drives it, and stays with the rest of the harness.
//
// Registration only. The capabilities behind it — opening eligibility, confirming a terminal value,
// recording matcher failures, opening and closing invocation windows — are not exported here or
// from any subpath: a plain test that could reach them could make itself evidence. The probe takes
// its share once, by relative import (`installProbe`). `scripts/testing-export-surface.test.ts`.
export { evidenceTest, concurrentEvidenceTest } from './mutation/evidence-test.ts';
export type { EvidenceTestOptions } from './mutation/evidence-test.ts';
// The probe/reporter contract: inert constants and types, which the reporter and the harness tests
// read. None of them is callable, so none of them can open eligibility or vouch for a value.
export {
  MATCHER_IDENTITY_CONFIRMED,
  NON_EVIDENCE,
  PROBE_META_KEY,
  PROBE_VERSION,
} from './mutation/probe-contract.ts';
export type { AssertionProbe, ProbeEvent } from './mutation/probe-contract.ts';

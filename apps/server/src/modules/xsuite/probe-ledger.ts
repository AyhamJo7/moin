/**
 * What the cross-tenant suite actually called (P06.13.02, P06.13.05, LG-P01).
 *
 * "100 % route coverage" used to mean "every served route has an inventory row". A row says a
 * probe should exist; it does not say one ran. A route added to the inventory with no probe call
 * (mutation C2 of the G12 review) kept the figure green. Each probe now notes the call as soon as
 * the answer arrives and records what it asserted once its assertions held, and the suite fails
 * unless every inventoried route has a passed record. There is no exemption: 100 % means every
 * route. The same ledger is the per-route report stored as the CI artifact.
 */

import type { InventoriedRoute, RouteClass } from './inventory.ts';

export interface ProbeRecord {
  /** HTTP status of the call that was made. */
  readonly status: number;
  /** What was asserted about the answer, in a few words. */
  readonly check: string;
}

interface LedgerEntry {
  readonly status: number;
  readonly check: string | null;
  readonly passed: boolean;
}

export interface CoverageRow {
  readonly route: string;
  /** Null for a route the production roots serve that has no inventory row. */
  readonly class: RouteClass | null;
  /** A production root serves the route. */
  readonly served: boolean;
  /** The inventory lists the route. */
  readonly inventoried: boolean;
  /** The route was called. */
  readonly probed: boolean;
  /** The assertions about the answer held. */
  readonly passed: boolean;
  readonly status: number | null;
  readonly check: string | null;
}

export interface CoverageReport {
  readonly rows: readonly CoverageRow[];
  readonly inventoried: number;
  readonly required: number;
  readonly executed: number;
  readonly summary: string;
  readonly unprobed: readonly string[];
  readonly failed: readonly string[];
  readonly unknownProbes: readonly string[];
  /** Served by a production root, missing from the inventory. */
  readonly notInventoried: readonly string[];
  /** In the inventory, served by no production root. */
  readonly notServed: readonly string[];
}

export class ProbeLedger {
  readonly #entries = new Map<string, LedgerEntry>();

  /**
   * Notes the call before its assertions run, so a probe that then fails (a 500, foreign data in
   * the body) still shows its status in the stored report instead of looking uncalled.
   */
  called(route: string, status: number): void {
    this.#entries.set(route, { status, check: null, passed: false });
  }

  /** Records a call whose assertions held. */
  record(route: string, record: ProbeRecord): void {
    this.#entries.set(route, { ...record, passed: true });
  }

  get(route: string): LedgerEntry | undefined {
    return this.#entries.get(route);
  }

  routes(): string[] {
    return [...this.#entries.keys()];
  }
}

export const key = (route: Pick<InventoriedRoute, 'method' | 'path'>): string =>
  `${route.method} ${route.path}`;

/**
 * The denominator is every route the inventory lists or a production root serves (`served`, read
 * from the roots by `routesServedBy`), so a route discovered on a root but missing from the
 * inventory lowers the figure instead of staying outside it. Only a route that is both served and
 * inventoried, and whose probe passed, counts as executed.
 */
export function buildCoverageReport(
  inventory: readonly InventoriedRoute[],
  ledger: ProbeLedger,
  served: ReadonlySet<string>,
): CoverageReport {
  const inventoried = new Map(inventory.map((route) => [key(route), route]));
  const all = [...inventoried.keys(), ...[...served].filter((id) => !inventoried.has(id)).sort()];
  const rows: CoverageRow[] = all.map((id) => {
    const entry = ledger.get(id);
    return {
      route: id,
      class: inventoried.get(id)?.class ?? null,
      served: served.has(id),
      inventoried: inventoried.has(id),
      probed: entry !== undefined,
      passed: entry?.passed ?? false,
      status: entry?.status ?? null,
      check: entry?.check ?? null,
    };
  });
  const executed = rows.filter((row) => row.passed && row.served && row.inventoried);
  return {
    rows,
    inventoried: inventory.length,
    required: rows.length,
    executed: executed.length,
    summary: `${String(executed.length)} of ${String(rows.length)} probed`,
    unprobed: rows.filter((row) => !row.probed).map((row) => row.route),
    failed: rows.filter((row) => row.probed && !row.passed).map((row) => row.route),
    unknownProbes: ledger.routes().filter((route) => !inventoried.has(route)),
    notInventoried: rows.filter((row) => !row.inventoried).map((row) => row.route),
    notServed: rows.filter((row) => !row.served).map((row) => row.route),
  };
}

/**
 * Throws unless the inventory equals the served routes and every one was called and its
 * assertions held.
 */
export function assertFullyProbed(report: CoverageReport): void {
  const problems: string[] = [];
  if (report.notInventoried.length > 0) {
    problems.push(`served but not inventoried: ${report.notInventoried.join(', ')}`);
  }
  if (report.notServed.length > 0) {
    problems.push(`inventoried but served by no production root: ${report.notServed.join(', ')}`);
  }
  if (report.unprobed.length > 0) problems.push(`not called: ${report.unprobed.join(', ')}`);
  if (report.failed.length > 0) {
    problems.push(`called but its assertions did not hold: ${report.failed.join(', ')}`);
  }
  if (report.unknownProbes.length > 0) {
    problems.push(`called but not inventoried: ${report.unknownProbes.join(', ')}`);
  }
  if (report.required === 0) problems.push('the inventory is empty');
  if (report.executed < report.required) {
    problems.push(`executed ${String(report.executed)} < required ${String(report.required)}`);
  }
  if (problems.length > 0)
    throw new Error(`cross-tenant probes incomplete: ${problems.join('; ')}`);
}

/** The stored report: the figure, the inventory and the outcome of every route. */
export function coverageArtifact(
  report: CoverageReport,
  meta: {
    readonly commit: string | null;
    readonly generatedAt: string;
  },
): Record<string, unknown> {
  return {
    commit: meta.commit,
    generatedAt: meta.generatedAt,
    coverage: report.summary,
    inventoried: report.inventoried,
    executed: report.executed,
    unprobed: report.unprobed,
    failed: report.failed,
    notInventoried: report.notInventoried,
    notServed: report.notServed,
    rows: report.rows,
  };
}

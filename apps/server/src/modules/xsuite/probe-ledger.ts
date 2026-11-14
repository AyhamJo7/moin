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
  readonly class: RouteClass;
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

export function buildCoverageReport(
  inventory: readonly InventoriedRoute[],
  ledger: ProbeLedger,
): CoverageReport {
  const inventoried = new Set(inventory.map(key));
  const rows: CoverageRow[] = inventory.map((route) => {
    const id = key(route);
    const entry = ledger.get(id);
    return {
      route: id,
      class: route.class,
      probed: entry !== undefined,
      passed: entry?.passed ?? false,
      status: entry?.status ?? null,
      check: entry?.check ?? null,
    };
  });
  const executed = rows.filter((row) => row.passed);
  return {
    rows,
    inventoried: inventory.length,
    required: inventory.length,
    executed: executed.length,
    summary: `${String(executed.length)} of ${String(inventory.length)} probed`,
    unprobed: rows.filter((row) => !row.probed).map((row) => row.route),
    failed: rows.filter((row) => row.probed && !row.passed).map((row) => row.route),
    unknownProbes: ledger.routes().filter((route) => !inventoried.has(route)),
  };
}

/** Throws unless every inventoried route was called and its assertions held. */
export function assertFullyProbed(report: CoverageReport): void {
  const problems: string[] = [];
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
    rows: report.rows,
  };
}

/**
 * What the cross-tenant suite actually called (P06.13.02, P06.13.05, LG-P01).
 *
 * "100 % route coverage" used to mean "every served route has an inventory row". A row says a
 * probe should exist; it does not say one ran. A route added to the inventory with no probe call
 * (mutation C2 of the G12 review) kept the figure green. Each probe now records the route it
 * called and what it asserted, and the suite fails unless every inventoried route has a record or
 * a named exemption. The same ledger is the per-route report stored as the CI artifact.
 */

import type { InventoriedRoute, RouteClass } from './inventory.ts';

export interface ProbeRecord {
  /** HTTP status of the call that was made. */
  readonly status: number;
  /** What was asserted about the answer, in a few words. */
  readonly check: string;
}

export interface CoverageRow {
  readonly route: string;
  readonly class: RouteClass;
  readonly probed: boolean;
  readonly status: number | null;
  readonly check: string | null;
  readonly exemptReason: string | null;
}

export interface CoverageReport {
  readonly rows: readonly CoverageRow[];
  readonly inventoried: number;
  readonly exempt: number;
  readonly required: number;
  readonly executed: number;
  readonly summary: string;
  readonly unprobed: readonly string[];
  readonly unknownProbes: readonly string[];
  readonly staleExemptions: readonly string[];
}

export class ProbeLedger {
  readonly #records = new Map<string, ProbeRecord>();

  record(route: string, record: ProbeRecord): void {
    this.#records.set(route, record);
  }

  get(route: string): ProbeRecord | undefined {
    return this.#records.get(route);
  }

  routes(): string[] {
    return [...this.#records.keys()];
  }
}

export const key = (route: Pick<InventoriedRoute, 'method' | 'path'>): string =>
  `${route.method} ${route.path}`;

/**
 * Routes that are inventoried but deliberately not called as tenant A, each with its reason.
 * Empty today: public, health, auth and signed routes are all called (unauthenticated or with a
 * forged credential) and recorded like the rest. An entry here must name a route that is in the
 * inventory and give a reason, or the report fails.
 */
export const EXEMPT_FROM_PROBES: Readonly<Record<string, string>> = {};

export function buildCoverageReport(
  inventory: readonly InventoriedRoute[],
  ledger: ProbeLedger,
  exempt: Readonly<Record<string, string>> = EXEMPT_FROM_PROBES,
): CoverageReport {
  const inventoried = new Set(inventory.map(key));
  const rows: CoverageRow[] = inventory.map((route) => {
    const id = key(route);
    const record = ledger.get(id);
    const exemptReason = exempt[id] ?? null;
    return {
      route: id,
      class: route.class,
      probed: record !== undefined,
      status: record?.status ?? null,
      check: record?.check ?? null,
      exemptReason,
    };
  });
  const required = rows.filter((row) => row.exemptReason === null);
  const executed = required.filter((row) => row.probed);
  return {
    rows,
    inventoried: inventory.length,
    exempt: rows.length - required.length,
    required: required.length,
    executed: executed.length,
    summary: `${String(executed.length)} of ${String(required.length)} probed`,
    unprobed: required.filter((row) => !row.probed).map((row) => row.route),
    unknownProbes: ledger.routes().filter((route) => !inventoried.has(route)),
    staleExemptions: Object.entries(exempt)
      .filter(([route, reason]) => !inventoried.has(route) || reason.trim() === '')
      .map(([route]) => route),
  };
}

/** Throws unless every inventoried route was called or exempted with a reason. */
export function assertFullyProbed(report: CoverageReport): void {
  const problems: string[] = [];
  if (report.unprobed.length > 0) problems.push(`not called: ${report.unprobed.join(', ')}`);
  if (report.unknownProbes.length > 0) {
    problems.push(`called but not inventoried: ${report.unknownProbes.join(', ')}`);
  }
  if (report.staleExemptions.length > 0) {
    problems.push(`exemption without a route or a reason: ${report.staleExemptions.join(', ')}`);
  }
  if (report.executed < report.required) {
    problems.push(`executed ${String(report.executed)} < required ${String(report.required)}`);
  }
  if (problems.length > 0)
    throw new Error(`cross-tenant probes incomplete: ${problems.join('; ')}`);
}

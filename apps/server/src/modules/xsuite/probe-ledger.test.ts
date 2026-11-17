import { describe, expect } from 'vitest';
import { evidenceTest } from '@moin/testing';
import { INVENTORY, type InventoriedRoute } from './inventory.ts';
import { assertFullyProbed, buildCoverageReport, key, ProbeLedger } from './probe-ledger.ts';

const SERVED: ReadonlySet<string> = new Set(INVENTORY.map(key));

function ledgerFor(routes: readonly InventoriedRoute[]): ProbeLedger {
  const ledger = new ProbeLedger();
  for (const route of routes) ledger.record(key(route), { status: 200, check: 'probed' });
  return ledger;
}

describe('the probe ledger counts calls, not inventory rows', () => {
  evidenceTest('every inventoried route called: N of N probed', () => {
    const report = buildCoverageReport(INVENTORY, ledgerFor(INVENTORY), SERVED);
    expect(report.summary).toBe(
      `${String(INVENTORY.length)} of ${String(INVENTORY.length)} probed`,
    );
    expect(() => {
      assertFullyProbed(report);
    }).not.toThrow();
  });

  evidenceTest('a list route with an inventory row and no probe call fails (mutation C2)', () => {
    // The G12 review added `GET /api/support/zzlist` plus a tenant-list row. The row satisfied
    // the old coverage assertion and nothing ever called the route.
    const added: InventoriedRoute = {
      method: 'GET',
      path: '/api/support/zzlist',
      class: 'tenant-list',
    };
    const report = buildCoverageReport(
      [...INVENTORY, added],
      ledgerFor(INVENTORY),
      new Set([...SERVED, key(added)]),
    );
    expect(report.unprobed).toStrictEqual(['GET /api/support/zzlist']);
    expect(report.summary).toBe(
      `${String(INVENTORY.length)} of ${String(INVENTORY.length + 1)} probed`,
    );
    expect(() => {
      assertFullyProbed(report);
    }).toThrow(/not called: GET \/api\/support\/zzlist/);
  });

  evidenceTest('a call to a route that is not inventoried fails', () => {
    const ledger = ledgerFor(INVENTORY);
    ledger.record('GET /api/elsewhere', { status: 200, check: 'x' });
    expect(() => {
      assertFullyProbed(buildCoverageReport(INVENTORY, ledger, SERVED));
    }).toThrow(/called but not inventoried: GET \/api\/elsewhere/);
  });

  evidenceTest('nothing lowers the requirement: one uncalled route fails, and so does none', () => {
    // LG-P01 is 100 %: no route can be excused from the denominator.
    const [first, ...rest] = INVENTORY;
    expect(first).toBeDefined();
    const report = buildCoverageReport(INVENTORY, ledgerFor(rest), SERVED);
    expect(report.required).toBe(INVENTORY.length);
    expect(() => {
      assertFullyProbed(report);
    }).toThrow(`not called: ${key(first!)}`);
    expect(() => {
      assertFullyProbed(buildCoverageReport([], new ProbeLedger(), new Set()));
    }).toThrow(/the inventory is empty/);
  });

  evidenceTest('a call whose assertions did not hold is reported with its status and fails', () => {
    const [first, ...rest] = INVENTORY;
    expect(first).toBeDefined();
    const ledger = ledgerFor(rest);
    ledger.called(key(first!), 500);
    const report = buildCoverageReport(INVENTORY, ledger, SERVED);
    expect(report.rows[0]).toMatchObject({ probed: true, passed: false, status: 500, check: null });
    expect(report.failed).toStrictEqual([key(first!)]);
    expect(report.unprobed).toStrictEqual([]);
    expect(() => {
      assertFullyProbed(report);
    }).toThrow(/called but its assertions did not hold/);
  });

  evidenceTest('the report carries one row per inventoried route with its outcome', () => {
    const report = buildCoverageReport(INVENTORY, ledgerFor(INVENTORY.slice(1)), SERVED);
    expect(report.rows).toHaveLength(INVENTORY.length);
    expect(report.rows[0]).toMatchObject({ probed: false, status: null, check: null });
    expect(report.rows[1]).toMatchObject({
      probed: true,
      passed: true,
      status: 200,
      check: 'probed',
    });
  });

  evidenceTest('a served route missing from the inventory is in the denominator and fails', () => {
    // A route a production root serves counts against the figure even though no row names it.
    const report = buildCoverageReport(
      INVENTORY,
      ledgerFor(INVENTORY),
      new Set([...SERVED, 'GET /api/new']),
    );
    expect(report.summary).toBe(
      `${String(INVENTORY.length)} of ${String(INVENTORY.length + 1)} probed`,
    );
    expect(report.required).toBe(INVENTORY.length + 1);
    expect(report.notInventoried).toStrictEqual(['GET /api/new']);
    expect(report.rows.at(-1)).toMatchObject({
      route: 'GET /api/new',
      class: null,
      served: true,
      inventoried: false,
      probed: false,
    });
    expect(() => {
      assertFullyProbed(report);
    }).toThrow(/served but not inventoried: GET \/api\/new/);
  });

  evidenceTest('an inventoried route no production root serves fails, even when probed', () => {
    const stale: InventoriedRoute = { method: 'GET', path: '/api/gone', class: 'tenant-list' };
    const report = buildCoverageReport(
      [...INVENTORY, stale],
      ledgerFor([...INVENTORY, stale]),
      SERVED,
    );
    expect(report.notServed).toStrictEqual(['GET /api/gone']);
    expect(report.executed).toBe(INVENTORY.length);
    expect(() => {
      assertFullyProbed(report);
    }).toThrow(/inventoried but served by no production root: GET \/api\/gone/);
  });
});

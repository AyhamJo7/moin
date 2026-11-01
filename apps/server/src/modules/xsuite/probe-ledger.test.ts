import { describe, expect } from 'vitest';
import { evidenceTest } from '@moin/testing';
import { INVENTORY, type InventoriedRoute } from './inventory.ts';
import { assertFullyProbed, buildCoverageReport, key, ProbeLedger } from './probe-ledger.ts';

function ledgerFor(routes: readonly InventoriedRoute[]): ProbeLedger {
  const ledger = new ProbeLedger();
  for (const route of routes) ledger.record(key(route), { status: 200, check: 'probed' });
  return ledger;
}

describe('the probe ledger counts calls, not inventory rows', () => {
  evidenceTest('every inventoried route called: N of N probed', () => {
    const report = buildCoverageReport(INVENTORY, ledgerFor(INVENTORY));
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
    const report = buildCoverageReport([...INVENTORY, added], ledgerFor(INVENTORY));
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
      assertFullyProbed(buildCoverageReport(INVENTORY, ledger));
    }).toThrow(/called but not inventoried: GET \/api\/elsewhere/);
  });

  evidenceTest('an exemption with a reason lowers the requirement; without one it fails', () => {
    const [first, ...rest] = INVENTORY;
    expect(first).toBeDefined();
    const id = key(first!);
    const reported = buildCoverageReport(INVENTORY, ledgerFor(rest), { [id]: 'public handshake' });
    expect(reported.exempt).toBe(1);
    expect(reported.summary).toBe(
      `${String(INVENTORY.length - 1)} of ${String(INVENTORY.length - 1)} probed`,
    );
    expect(() => {
      assertFullyProbed(reported);
    }).not.toThrow();
    const blank = buildCoverageReport(INVENTORY, ledgerFor(rest), { [id]: ' ' });
    expect(() => {
      assertFullyProbed(blank);
    }).toThrow(/exemption without a route or a reason/);
    const stale = buildCoverageReport(INVENTORY, ledgerFor(INVENTORY), { 'GET /gone': 'reason' });
    expect(() => {
      assertFullyProbed(stale);
    }).toThrow(/GET \/gone/);
  });

  evidenceTest('the report carries one row per inventoried route with its outcome', () => {
    const report = buildCoverageReport(INVENTORY, ledgerFor(INVENTORY.slice(1)));
    expect(report.rows).toHaveLength(INVENTORY.length);
    expect(report.rows[0]).toMatchObject({ probed: false, status: null, check: null });
    expect(report.rows[1]).toMatchObject({ probed: true, status: 200, check: 'probed' });
  });
});

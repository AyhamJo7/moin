/**
 * The population snapshot (P06.10.05, INV-10) — the property that replaced UUID-cursor paging.
 *
 * ## What was wrong, measured
 *
 * The register was paged by `tenant_id`, a random UUID. With the register holding `bbbb…`, a sweep
 * that had claimed it, and `aaaa…` registered concurrently: the next page returned 0 rows, the
 * count after the cursor returned 0, and the unregistered-tenant check returned 0 — because `aaaa…`
 * *is* registered. The sweep reported complete coverage over one tenant while a second had been
 * registered and never verified.
 *
 * UUID order does not encode registration order, so no cursor over it can tell "nothing left" from
 * "something arrived behind me". These tests are written so that **every** late registration sorts
 * lexically *behind* the cursor, which is precisely the case the old design could not see.
 *
 * ## What is claimed now
 *
 * Sound **for the register population captured at sweep start**. A registration at or below the
 * captured high-water mark must be verified or counted as unreached; one above it belongs to the
 * next sweep and must not make this one look incomplete. That boundary is the subject of every case
 * below.
 */
import { randomUUID } from 'node:crypto';
import { evidenceTest, createTestDatabase, type TestDatabase } from '@moin/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPool, type Pool } from './pool.ts';
import { appendAuditEvent } from './audit.ts';
import { isSound, verifyAuditChains } from './audit-verification.ts';
import { withTenant } from './tenant.ts';

/** `aaaa…` sorts before `bbbb…`, so a late `aaaa…` lands behind a cursor that passed `bbbb…`. */
const EARLY_UUID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const LATE_UUID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const THIRD_UUID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

let database: TestDatabase;
let privileged: Pool;
let app: Pool;

async function register(id: string, slug: string): Promise<void> {
  await privileged.query('insert into organisations(id, slug, name) values ($1, $2, $3)', [
    id,
    slug,
    slug,
  ]);
}

async function event(organisationId: string): Promise<void> {
  await withTenant(app, organisationId, (client) =>
    appendAuditEvent(client, {
      source: 'api',
      operation: 'test.checked',
      targetKind: 'organisation',
      result: 'succeeded',
    }),
  );
}

async function highWater(): Promise<string> {
  const result = await app.query<{ n: string }>('select app.audit_chain_high_water()::text as n');
  return result.rows[0]?.n ?? '0';
}

async function sequences(): Promise<readonly { tenant: string; seq: string }[]> {
  const rows = await privileged.query<{ tenant_id: string; registration_seq: string }>(
    'select tenant_id::text, registration_seq::text from audit_chain_registry order by registration_seq',
  );
  return rows.rows.map((row) => ({ tenant: row.tenant_id, seq: row.registration_seq }));
}

beforeEach(async () => {
  // A database per test: these cases are about what the register contained at a moment in time, so
  // sharing one would make each test depend on the order of the others.
  database = await createTestDatabase('audit-population');
  privileged = createPool({ connectionString: database.migrationUrl, max: 2 });
  app = database.pool();
}, 90_000);

afterEach(async () => {
  await privileged.end();
  await database.drop();
});

describe('the registration sequence', () => {
  it('advances strictly, and records order rather than UUID', async () => {
    // Registered late but sorts first: under the old cursor this was the invisible case.
    await register(LATE_UUID, 'first-registered');
    await register(EARLY_UUID, 'second-registered');

    const registry = await sequences();
    expect(registry.map((row) => row.tenant)).toEqual([LATE_UUID, EARLY_UUID]);
    expect(BigInt(registry[1]?.seq ?? '0')).toBeGreaterThan(BigInt(registry[0]?.seq ?? '0'));
  });

  evidenceTest('cannot be rewritten by the application role or by the table owner', async () => {
    await register(EARLY_UUID, 'immutable');
    // No grant at all for the runtime role.
    await expect(
      app.query('update audit_chain_registry set registration_seq = 99'),
    ).rejects.toThrow(/permission denied/u);
    // And the append-only guard binds the owner too, which is what makes the sequence immutable
    // once assigned rather than merely inconvenient to change.
    await expect(
      privileged.query('update audit_chain_registry set registration_seq = 99'),
    ).rejects.toThrow(/append-only/u);
  });

  evidenceTest('refuses two registrations sharing a position', async () => {
    await register(EARLY_UUID, 'one');
    await expect(
      privileged.query(
        `insert into audit_chain_registry(tenant_id, registration_seq)
         values ($1, (select min(registration_seq) from audit_chain_registry))`,
        [LATE_UUID],
      ),
    ).rejects.toThrow(/registration_seq/u);
  });
});

describe('CASE 1 — a registration behind the former UUID cursor', () => {
  it('is excluded from the captured population and included by the next sweep', async () => {
    await register(LATE_UUID, 'in-population');
    await event(LATE_UUID);

    const captured = await highWater();

    // The exact reproduction, and the registration happens *inside* the running sweep so the
    // snapshot is the sweep's own rather than one a test handed it: registered after the mark was
    // read, and sorting lexically *behind* the cursor the sweep has advanced to.
    let late = false;
    const first = await verifyAuditChains(app, {
      pageSize: 1,
      onPageComplete: async () => {
        if (late) return;
        late = true;
        await register(EARLY_UUID, 'after-snapshot');
        await event(EARLY_UUID);
      },
    });

    expect(late).toBe(true);
    expect(first.populationHighWater).toBe(captured);
    expect(first.tenants).toBe(1);
    expect(first.sound).toBe(1);
    expect(first.unreached).toBe(0);
    expect(first.coverageComplete).toBe(true);
    expect(isSound(first)).toBe(true);

    // The next sweep captures its own mark and must include the late tenant. Under the old design
    // this is the tenant that was never verified by any sweep at all.
    const second = await verifyAuditChains(app, { pageSize: 1 });
    expect(BigInt(second.populationHighWater)).toBeGreaterThan(BigInt(captured));
    expect(second.tenants).toBe(2);
    expect(second.sound).toBe(2);
    expect(isSound(second)).toBe(true);
  });
});

describe('CASE 2 — a member that existed at snapshot start', () => {
  evidenceTest(
    'is verified before coverage is complete, whatever its UUID sorts like',
    async () => {
      // Registration order is the reverse of UUID order, so a UUID cursor would have skipped one.
      await register(LATE_UUID, 'reg-one');
      await register(EARLY_UUID, 'reg-two');
      await event(LATE_UUID);
      await event(EARLY_UUID);

      const report = await verifyAuditChains(app, { pageSize: 1 });
      expect(report.tenants).toBe(2);
      expect(report.sound).toBe(2);
      expect(report.unreached).toBe(0);
      expect(report.coverageComplete).toBe(true);
      expect(isSound(report)).toBe(true);
    },
  );
});

describe('CASE 3 — a registration between pages', () => {
  it('is excluded by the high-water bound, not by UUID ordering', async () => {
    await register(LATE_UUID, 'page-one');
    await register(THIRD_UUID, 'page-two');
    await event(LATE_UUID);
    await event(THIRD_UUID);

    const captured = await highWater();
    let registeredMidSweep = false;

    const report = await verifyAuditChains(app, {
      pageSize: 1,
      // After the first page is processed: a real registration, committed, sorting behind the
      // cursor. The sweep's own captured bound is what excludes it.
      onPageComplete: async () => {
        if (registeredMidSweep) return;
        registeredMidSweep = true;
        await register(EARLY_UUID, 'mid-sweep');
        await event(EARLY_UUID);
      },
    });

    expect(registeredMidSweep).toBe(true);
    expect(report.populationHighWater).toBe(captured);
    expect(report.tenants).toBe(2);
    expect(report.sound).toBe(2);
    expect(report.coverageComplete).toBe(true);
    expect(isSound(report)).toBe(true);

    // And it is genuinely only deferred: the next sweep picks it up.
    const next = await verifyAuditChains(app, { pageSize: 1 });
    expect(next.tenants).toBe(3);
    expect(isSound(next)).toBe(true);
  });
});

describe('CASE 4 — a deadline inside the captured population', () => {
  evidenceTest('reports the snapshot shortfall and is not sound', async () => {
    for (const [id, slug] of [
      [LATE_UUID, 'd-one'],
      [EARLY_UUID, 'd-two'],
      [THIRD_UUID, 'd-three'],
    ] as const) {
      await register(id, slug);
      await event(id);
    }

    let ticks = 0;
    const report = await verifyAuditChains(app, {
      pageSize: 1,
      deadlineMs: 1_000,
      now: () => {
        ticks += 1;
        return ticks <= 1 ? 0 : 10_000;
      },
    });

    expect(report.tenants).toBe(1);
    // Two of the three captured members were never reached, counted inside the snapshot range.
    expect(report.unreached).toBe(2);
    expect(report.unchecked).toBe(2);
    expect(report.coverageComplete).toBe(false);
    expect(isSound(report)).toBe(false);
  });
});

describe('CASE 6 — the exact snapshot boundary', () => {
  evidenceTest('leaves no registration outside both of two consecutive sweeps', async () => {
    // The question: can a registration land between two sweeps and be covered by neither? It
    // cannot, and the reason is that a sweep's cursor starts at 0 rather than at the previous
    // sweep's mark — so every member at or below the *current* mark is in the current population,
    // whenever it was registered.
    await register(LATE_UUID, 'boundary-one');
    await event(LATE_UUID);

    const first = await verifyAuditChains(app, { pageSize: 10 });
    const firstMark = first.populationHighWater;
    expect(first.tenants).toBe(1);
    expect(isSound(first)).toBe(true);

    // Registered strictly after the first sweep's population was fixed, and sorting behind it.
    await register(EARLY_UUID, 'boundary-two');
    await event(EARLY_UUID);

    const registry = await sequences();
    expect(registry).toHaveLength(2);
    const boundarySeq = registry[1]?.seq ?? '0';
    // It really is above the first sweep's mark, so the first sweep was right to exclude it.
    expect(BigInt(boundarySeq)).toBeGreaterThan(BigInt(firstMark));

    const second = await verifyAuditChains(app, { pageSize: 10 });
    // And inside the second sweep's, so it is covered rather than orphaned between the two.
    expect(BigInt(second.populationHighWater)).toBeGreaterThanOrEqual(BigInt(boundarySeq));
    expect(second.tenants).toBe(2);
    expect(second.sound).toBe(2);
    expect(isSound(second)).toBe(true);
  });

  it('a sweep over an empty register is bounded at zero and covers nobody', async () => {
    const report = await verifyAuditChains(app);
    expect(report.populationHighWater).toBe('0');
    expect(report.tenants).toBe(0);
    expect(report.coverageComplete).toBe(true);
    // Zero tenants is still not a clean day — the CLI turns this into a failed run.
    expect(report.unregistered).toBe(0);
  });
});

describe('the sweep does not widen its own population', () => {
  evidenceTest('reads the high-water mark once, not once per page', async () => {
    await register(LATE_UUID, 'w-one');
    await register(THIRD_UUID, 'w-two');
    await event(LATE_UUID);
    await event(THIRD_UUID);

    // Registering one new tenant per page: if the bound were recomputed, the sweep would chase its
    // own tail and never terminate on a busy estate.
    let added = 0;
    const report = await verifyAuditChains(app, {
      pageSize: 1,
      onPageComplete: async () => {
        if (added >= 2) return;
        added += 1;
        const id = randomUUID();
        await register(id, `chaser-${String(added)}`);
        await event(id);
      },
    });

    expect(added).toBeGreaterThan(0);
    // Exactly the two members captured at the start, no more.
    expect(report.tenants).toBe(2);
    expect(report.coverageComplete).toBe(true);
    expect(isSound(report)).toBe(true);
  });
});

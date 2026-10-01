/**
 * Registration epochs are serialized by commit, not by allocation (P06.10.05, INV-10).
 *
 * ## The defect this file exists to make impossible
 *
 * The first implementation allocated epochs from a PostgreSQL sequence. `nextval()` is deliberately
 * outside transaction control — it does not lock and does not roll back — so allocation order is
 * not commit order. Measured against that schema:
 *
 *   Tx A inserts a tenant, takes epoch 1, stays open
 *   Tx B inserts a tenant, takes epoch 2, commits
 *   a sweep reads max(registration_seq) -> 2, and sees ONE row at or below 2
 *   Tx A commits
 *   that same population "<= 2" now has TWO members
 *
 * The sweep had reported complete coverage of a population it had half covered. Every test below
 * attacks that shape directly, with a bounded `lock_timeout` so a hang fails rather than hangs.
 */
import { randomUUID } from 'node:crypto';
import { createTestDatabase, type TestDatabase } from '@moin/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPool, type Pool } from './pool.ts';

/** Long enough for a real lock wait to be a real wait, short enough that a deadlock fails fast. */
const LOCK_TIMEOUT_MS = 2_000;

let database: TestDatabase;
let pool: Pool;

/** Anything that can run a query: a pool or a checked-out client. */
interface Queryable {
  query(sql: string, params?: readonly unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

/** Narrow a row's field to a string at the one place it is read. */
function text(rows: readonly Record<string, unknown>[], field: string): string {
  const value = rows[0]?.[field];
  return typeof value === 'string' ? value : 'none';
}

async function register(client: Queryable, slug: string): Promise<string> {
  const id = randomUUID();
  await client.query('insert into organisations(id, slug, name) values ($1, $2, $3)', [
    id,
    slug,
    slug,
  ]);
  return id;
}

async function epochOf(client: Queryable, tenant: string): Promise<string> {
  const result = await client.query(
    'select registration_seq::text as n from audit_chain_registry where tenant_id = $1',
    [tenant],
  );
  return text(result.rows, 'n');
}

beforeEach(async () => {
  database = await createTestDatabase('audit-epoch');
  // Several independent connections, because the whole subject is what one transaction can see
  // and do while another is open.
  pool = createPool({ connectionString: database.migrationUrl, max: 6 });
}, 90_000);

afterEach(async () => {
  await pool.end();
  await database.drop();
});

describe('the allocator is a row lock, not a sequence', () => {
  it('blocks a second registration while the first is uncommitted', async () => {
    const a = await pool.connect();
    const b = await pool.connect();
    try {
      await a.query('begin');
      const tenantA = await register(a, 'epoch-a');
      const epochA = await epochOf(a, tenantA);
      expect(epochA).toBe('1');

      // B cannot allocate while A holds the state row. A bounded `lock_timeout` turns the wait
      // into a deterministic error instead of a hanging test.
      await b.query('begin');
      await b.query(`set local lock_timeout = '${String(LOCK_TIMEOUT_MS)}ms'`);
      await expect(register(b, 'epoch-b')).rejects.toThrow(/lock timeout|canceling statement/iu);
      await b.query('rollback');
    } finally {
      try {
        await a.query('rollback');
      } catch {
        /* the connection is discarded below either way */
      }
      a.release();
      b.release();
    }
  }, 60_000);

  it('COMMIT CASE: B proceeds after A commits, and takes a strictly higher epoch', async () => {
    const a = await pool.connect();
    const b = await pool.connect();
    try {
      await a.query('begin');
      const tenantA = await register(a, 'commit-a');
      const epochA = await epochOf(a, tenantA);

      await a.query('commit');

      await b.query('begin');
      const tenantB = await register(b, 'commit-b');
      const epochB = await epochOf(b, tenantB);
      await b.query('commit');

      expect(BigInt(epochA)).toBeLessThan(BigInt(epochB));
    } finally {
      a.release();
      b.release();
    }
  }, 60_000);

  it('ROLLBACK CASE: a rolled-back registration leaves no epoch behind it', async () => {
    const a = await pool.connect();
    const b = await pool.connect();
    const observer = await pool.connect();
    try {
      await a.query('begin');
      const tenantA = await register(a, 'rollback-a');
      expect(await epochOf(a, tenantA)).toBe('1');
      await a.query('rollback');

      // B now allocates. The epoch A had taken is released with its transaction, so B gets it —
      // and crucially no committed member can ever appear *behind* B afterwards, because the only
      // claim on a lower epoch has been abandoned.
      await b.query('begin');
      const tenantB = await register(b, 'rollback-b');
      const epochB = await epochOf(b, tenantB);
      await b.query('commit');

      const committed = await observer.query<{ tenant_id: string; n: string }>(
        'select tenant_id::text, registration_seq::text as n from audit_chain_registry order by registration_seq',
      );
      expect(committed.rows).toHaveLength(1);
      expect(committed.rows[0]?.tenant_id).toBe(tenantB);
      // Nothing is below B, and nothing ever can be: epochs only move forward.
      const below = await observer.query<{ n: string }>(
        'select count(*)::text as n from audit_chain_registry where registration_seq < $1::bigint',
        [epochB],
      );
      expect(below.rows[0]?.n).toBe('0');
      const state = await observer.query<{ n: string }>(
        'select last_registration_epoch::text as n from audit_chain_population_state',
      );
      expect(state.rows[0]?.n).toBe(epochB);
    } finally {
      a.release();
      b.release();
      observer.release();
    }
  }, 60_000);
});

describe('the old exploit, attempted against the new design', () => {
  it('cannot produce a committed epoch above an uncommitted lower one', async () => {
    // This is the central acceptance criterion. Under the sequence design this interleaving was
    // reproducible; here the attempt is structurally impossible, and the test shows why.
    const a = await pool.connect();
    const b = await pool.connect();
    const sweep = await pool.connect();
    try {
      // A takes the lower epoch and stays open.
      await a.query('begin');
      const tenantA = await register(a, 'exploit-a');
      const epochA = await epochOf(a, tenantA);
      expect(epochA).toBe('1');

      // The high-water mark a sweep would capture right now. It is the last *committed* epoch, so
      // A's in-flight registration is not in the population — which is the point.
      const captured = (
        await sweep.query<{ n: string }>('select app.audit_chain_high_water()::text as n')
      ).rows[0]?.n;
      expect(captured).toBe('0');

      // B tries to commit a HIGHER epoch while A is still open. It cannot even allocate one.
      await b.query('begin');
      await b.query(`set local lock_timeout = '${String(LOCK_TIMEOUT_MS)}ms'`);
      await expect(register(b, 'exploit-b')).rejects.toThrow(/lock timeout|canceling statement/iu);
      await b.query('rollback');

      // So no epoch above A's exists, committed or otherwise, while A is in flight.
      const above = await sweep.query<{ n: string }>(
        'select count(*)::text as n from audit_chain_registry where registration_seq > $1::bigint',
        [epochA],
      );
      expect(above.rows[0]?.n).toBe('0');
      const stateWhileOpen = (
        await sweep.query<{ n: string }>(
          'select last_registration_epoch::text as n from audit_chain_population_state',
        )
      ).rows[0]?.n;
      expect(stateWhileOpen).toBe('0');

      // A commits. Its epoch is now the high-water mark, so the next sweep's population includes
      // it; the sweep that captured 0 never claimed to cover it.
      await a.query('commit');
      const afterCommit = (
        await sweep.query<{ n: string }>('select app.audit_chain_high_water()::text as n')
      ).rows[0]?.n;
      expect(afterCommit).toBe('1');
    } finally {
      a.release();
      b.release();
      sweep.release();
    }
  }, 60_000);

  it('a population captured at sweep start never gains a member afterwards', async () => {
    // The direct statement of the broken property, as an invariant rather than an interleaving:
    // whatever a sweep captures, the count of register rows at or below it is fixed for ever.
    //
    // Note what this test deliberately does *not* attempt. Committing a registration while another
    // holds the state lock is impossible by construction — that is the previous test — so trying it
    // here would simply block. Instead: a registration in flight, then committed, then a further
    // one committed outright. None of the three can enter the captured population.
    const a = await pool.connect();
    const sweep = await pool.connect();
    try {
      await register(pool, 'settled-one');
      await register(pool, 'settled-two');

      const captured = (
        await sweep.query<{ n: string }>('select app.audit_chain_high_water()::text as n')
      ).rows[0]?.n;
      expect(captured).toBe('2');
      const within = async (): Promise<string> =>
        (
          await sweep.query<{ n: string }>(
            'select count(*)::text as n from audit_chain_registry where registration_seq <= $1::bigint',
            [captured],
          )
        ).rows[0]?.n ?? 'none';

      expect(await within()).toBe('2');

      // In flight: invisible, and its epoch is above the mark in any case.
      await a.query('begin');
      await register(a, 'late-open');
      expect(await within()).toBe('2');

      // Committed: still above the mark.
      await a.query('commit');
      expect(await within()).toBe('2');

      // And one more, committed outright after the sweep's mark was taken.
      await register(pool, 'late-committed');
      expect(await within()).toBe('2');

      // The register really did grow; it is the captured population that did not.
      const total = (
        await sweep.query<{ n: string }>('select count(*)::text as n from audit_chain_registry')
      ).rows[0]?.n;
      expect(total).toBe('4');
    } finally {
      a.release();
      sweep.release();
    }
  }, 60_000);
});

describe('lock order and deadlock', () => {
  it('concurrent provisioning does not deadlock', async () => {
    // Every path that registers a tenant takes the same locks in the same order — organisations
    // row, then the population singleton, then the register row — so there is no cycle to find.
    // A bounded `lock_timeout` on every connection makes a deadlock or a wedge fail rather than
    // hang, which is the only way this test can be trusted.
    const connections = await Promise.all([1, 2, 3, 4, 5, 6].map(() => pool.connect()));
    try {
      const results = await Promise.all(
        connections.map(async (client, index) => {
          await client.query(`set lock_timeout = '${String(LOCK_TIMEOUT_MS * 5)}ms'`);
          await client.query('begin');
          const id = await register(client, `concurrent-${String(index)}`);
          await client.query('commit');
          return epochOf(client, id);
        }),
      );
      // Six registrations, six distinct epochs, contiguous from 1.
      const epochs = results.map((value) => Number(value)).sort((left, right) => left - right);
      expect(epochs).toStrictEqual([1, 2, 3, 4, 5, 6]);
    } finally {
      for (const client of connections) client.release();
    }
  }, 120_000);

  it('the verification sweep does not hold the population lock', async () => {
    // If a sweep held the singleton for its duration, provisioning would block behind every daily
    // run. It reads the value and lets go, so a registration can proceed while a sweep is working.
    await register(pool, 'sweeping');
    const reader = await pool.connect();
    const writer = await pool.connect();
    try {
      await reader.query('begin');
      await reader.query('select app.audit_chain_high_water()');
      // The reader's transaction is still open. A registration must not be blocked by it.
      await writer.query('begin');
      await writer.query(`set local lock_timeout = '${String(LOCK_TIMEOUT_MS)}ms'`);
      const id = await register(writer, 'during-sweep');
      await writer.query('commit');
      expect(await epochOf(writer, id)).toBe('2');
      await reader.query('rollback');
    } finally {
      reader.release();
      writer.release();
    }
  }, 60_000);
});

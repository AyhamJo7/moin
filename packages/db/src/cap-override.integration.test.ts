/**
 * Every change to the Early Access cap is an audited override (P06.04.03, migration 0082).
 *
 * The independent acceptance read showed the gap: a migration that ran
 * `UPDATE provisioning_limits SET early_access_cap = 6` raised the cap with no audit row, and a
 * sixth paid tenant then provisioned. These tests act as `moin_migrator`, the role that applies
 * migrations (NOSUPERUSER, NOBYPASSRLS), and as the runtime roles for what must stay refused.
 */
import { randomUUID } from 'node:crypto';
import { createTestDatabase, evidenceTest, type TestDatabase } from '@moin/testing';
import { afterEach, beforeEach, describe, expect } from 'vitest';
import { createPool, type Pool } from './pool.ts';

let database: TestDatabase;
let migrator: Pool;
let provisioner: Pool;

const APPROVAL = 'founder approval 2026-11-15, PR #999, ADR-0099';
const REASON = 'raise the cap for the sixth pilot customer';

function migratorUrl(): string {
  const base = process.env['TEST_DATABASE_MIGRATOR_URL'];
  if (base === undefined) throw new Error('TEST_DATABASE_MIGRATOR_URL is required');
  const url = new URL(base);
  url.pathname = `/${database.name}`;
  return url.toString();
}

function provisionerUrl(): string {
  const base = process.env['TEST_DATABASE_PROVISIONER_URL'];
  if (base === undefined) throw new Error('TEST_DATABASE_PROVISIONER_URL is required');
  const url = new URL(base);
  url.pathname = `/${database.name}`;
  return url.toString();
}

async function paidTenant(): Promise<void> {
  await provisioner.query(
    'select app.provision_tenant($1::uuid, $2::citext, $3::text, $4::text, $5::text, $6::text, $7::text, $8::boolean, $9::text)',
    [
      randomUUID(),
      `tenant-${randomUUID().slice(0, 12)}`,
      'Test Betrieb',
      'Hamburg',
      'owner@example.test',
      'restaurant@1.0',
      'reception',
      true,
      'Europe/Berlin',
    ],
  );
}

const limits = async (): Promise<{ cap: number; counter: number }> => {
  const row = (
    await migrator.query<{ cap: number; counter: number }>(
      'select early_access_cap as cap, accepted_paid_early_access as counter from provisioning_limits',
    )
  ).rows[0];
  if (row === undefined) throw new Error('no limits row');
  return row;
};

const overrides = async (): Promise<number> =>
  Number(
    (
      await migrator.query<{ n: string }>(
        'select count(*)::text as n from provisioning_limit_overrides',
      )
    ).rows[0]?.n,
  );

async function override(newCap: number, newCounter: number | null = null): Promise<void> {
  await migrator.query('select app.override_early_access_cap($1, $2, $3, $4, $5)', [
    newCap,
    newCounter,
    REASON,
    'founder',
    APPROVAL,
  ]);
}

beforeEach(async () => {
  database = await createTestDatabase('cap-override');
  // The real migration role on the cloned database, not the harness's admin connection: the
  // claims below are about what `moin_migrator` may do.
  migrator = createPool({ connectionString: migratorUrl(), max: 2 });
  const role = await migrator.query<{ name: string; super: boolean; bypass: boolean }>(
    'select current_user::text as name, rolsuper as super, rolbypassrls as bypass from pg_roles where rolname = current_user',
  );
  expect(role.rows[0]).toEqual({ name: 'moin_migrator', super: false, bypass: false });
  provisioner = createPool({ connectionString: provisionerUrl(), max: 2 });
});

afterEach(async () => {
  await migrator.end();
  await provisioner.end();
  await database.drop();
});

describe('a cap change without its audit record is refused', () => {
  evidenceTest('a migration that raises the cap by plain UPDATE leaves it unchanged', async () => {
    await expect(
      migrator.query('update provisioning_limits set early_access_cap = 6'),
    ).rejects.toMatchObject({ code: '23000' });
    expect(await limits()).toStrictEqual({ cap: 5, counter: 0 });
    expect(await overrides()).toBe(0);
  });

  evidenceTest('the sixth paid tenant is still refused after the refused change', async () => {
    for (let i = 0; i < 5; i += 1) await paidTenant();
    await expect(
      migrator.query('update provisioning_limits set early_access_cap = 6'),
    ).rejects.toMatchObject({ code: '23000' });
    await expect(paidTenant()).rejects.toMatchObject({ code: '23514' });
  });

  evidenceTest(
    'resetting the counter by plain UPDATE is the same bypass and is refused',
    async () => {
      for (let i = 0; i < 5; i += 1) await paidTenant();
      await expect(
        migrator.query('update provisioning_limits set accepted_paid_early_access = 0'),
      ).rejects.toMatchObject({ code: '23000' });
      expect((await limits()).counter).toBe(5);
    },
  );

  evidenceTest('an override record from an earlier transaction authorises nothing', async () => {
    // Two audited changes in their own transactions, 5 to 6 and back, leave a record that matches
    // a later plain 5 to 6 exactly. It must not be replayable.
    await override(6);
    await override(5);
    expect(await overrides()).toBe(2);
    await expect(
      migrator.query('update provisioning_limits set early_access_cap = 6'),
    ).rejects.toMatchObject({ code: '23000' });
    expect((await limits()).cap).toBe(5);
  });

  evidenceTest('an override record for a different change authorises nothing', async () => {
    const client = await migrator.connect();
    try {
      await client.query('begin');
      await client.query('select app.override_early_access_cap($1, null, $2, $3, $4)', [
        7,
        REASON,
        'founder',
        APPROVAL,
      ]);
      // The record says 5 to 7; this statement tries 7 to 9 in the same transaction.
      await expect(
        client.query('update provisioning_limits set early_access_cap = 9'),
      ).rejects.toMatchObject({ code: '23000' });
    } finally {
      await client.query('rollback');
      client.release();
    }
    expect(await limits()).toStrictEqual({ cap: 5, counter: 0 });
  });
});

describe('the limits row cannot be replaced and a record is single-use', () => {
  evidenceTest('delete and truncate of the limits row are refused', async () => {
    await expect(migrator.query('delete from provisioning_limits')).rejects.toMatchObject({
      code: '23000',
    });
    await expect(migrator.query('truncate provisioning_limits')).rejects.toMatchObject({
      code: '23000',
    });
    expect(await limits()).toEqual({ cap: 5, counter: 0 });
    expect(await overrides()).toBe(0);
  });

  evidenceTest(
    'one record authorises one change: a second reset in the same transaction is refused',
    async () => {
      for (let i = 0; i < 5; i += 1) await paidTenant();
      const client = await migrator.connect();
      try {
        await client.query('begin');
        await client.query('select app.override_early_access_cap($1, $2, $3, $4, $5)', [
          5,
          4,
          REASON,
          'founder',
          APPROVAL,
        ]);
        // Put the counter back to 5, as a provisioning would, then replay the same reset.
        await client.query(
          'update provisioning_limits set accepted_paid_early_access = accepted_paid_early_access + 1',
        );
        await expect(
          client.query('update provisioning_limits set accepted_paid_early_access = 4'),
        ).rejects.toMatchObject({ code: '23000' });
      } finally {
        await client.query('rollback');
        client.release();
      }
      expect(await limits()).toEqual({ cap: 5, counter: 5 });
      expect(await overrides()).toBe(0);
    },
  );

  evidenceTest('a back-dated stray record cannot make a used record count again', async () => {
    for (let i = 0; i < 5; i += 1) await paidTenant();
    const client = await migrator.connect();
    try {
      await client.query('begin');
      await client.query('select app.override_early_access_cap($1, $2, $3, $4, $5)', [
        5,
        4,
        REASON,
        'founder',
        APPROVAL,
      ]);
      await client.query(
        'update provisioning_limits set accepted_paid_early_access = accepted_paid_early_access + 1',
      );
      // An unrelated record, written directly and dated before everything: the table stamps
      // its own order, so it becomes the newest record and matches nothing.
      await client.query(
        `insert into provisioning_limit_overrides
             (seq, old_cap, new_cap, old_counter, new_counter, reason, actor, approval_ref, created_at)
           values (0, 9, 9, 9, 9, $1, 'someone', $2, '-infinity')`,
        [REASON, APPROVAL],
      );
      const stamped = await client.query<{ seq: string; dated: boolean }>(
        "select seq::text, created_at > now() - interval '1 minute' as dated from provisioning_limit_overrides order by seq desc limit 1",
      );
      expect(stamped.rows[0]).toEqual({ seq: '2', dated: true });
      await expect(
        client.query('update provisioning_limits set accepted_paid_early_access = 4'),
      ).rejects.toMatchObject({ code: '23000' });
    } finally {
      await client.query('rollback');
      client.release();
    }
    expect(await limits()).toEqual({ cap: 5, counter: 5 });
  });

  evidenceTest('the consumed-record counter cannot be set by hand', async () => {
    await expect(
      migrator.query('update provisioning_limits set overrides_applied = 0 - 1'),
    ).rejects.toMatchObject({ code: '23000' });
  });
});

describe('an approved, audited override works', () => {
  evidenceTest(
    'it records old and new limit, reason, actor and approval, and lifts the cap',
    async () => {
      for (let i = 0; i < 5; i += 1) await paidTenant();
      await override(6);
      expect(await limits()).toStrictEqual({ cap: 6, counter: 5 });
      const rows = await migrator.query(
        `select old_cap, new_cap, old_counter, new_counter, reason, actor, approval_ref
         from provisioning_limit_overrides`,
      );
      expect(rows.rows).toStrictEqual([
        {
          old_cap: 5,
          new_cap: 6,
          old_counter: 5,
          new_counter: 5,
          reason: REASON,
          actor: 'founder',
          approval_ref: APPROVAL,
        },
      ]);
      await paidTenant(); // the sixth now provisions, with the override on record
      expect((await limits()).counter).toBe(6);
    },
  );

  evidenceTest('a counter reset goes through the same record', async () => {
    for (let i = 0; i < 5; i += 1) await paidTenant();
    await override(5, 4);
    expect(await limits()).toStrictEqual({ cap: 5, counter: 4 });
    const row = (
      await migrator.query<{ old_counter: number; new_counter: number }>(
        'select old_counter, new_counter from provisioning_limit_overrides',
      )
    ).rows[0];
    expect(row).toStrictEqual({ old_counter: 5, new_counter: 4 });
  });

  evidenceTest('a refused override leaves no record and no change', async () => {
    for (const [reason, actor, approval] of [
      ['short', 'founder', APPROVAL],
      [REASON, '', APPROVAL],
      [REASON, 'founder', 'none'],
    ] as const) {
      await expect(
        migrator.query('select app.override_early_access_cap(9, null, $1, $2, $3)', [
          reason,
          actor,
          approval,
        ]),
      ).rejects.toMatchObject({ code: '23514' });
    }
    await expect(
      migrator.query('select app.override_early_access_cap(-1, null, $1, $2, $3)', [
        REASON,
        'founder',
        APPROVAL,
      ]),
    ).rejects.toMatchObject({ code: '22023' });
    expect(await limits()).toStrictEqual({ cap: 5, counter: 0 });
    expect(await overrides()).toBe(0);
  });

  evidenceTest('provisioning still increments the counter without any record', async () => {
    await paidTenant();
    expect(await limits()).toStrictEqual({ cap: 5, counter: 1 });
    expect(await overrides()).toBe(0);
  });
});

describe('the record is append-only and the runtime privileges are unchanged', () => {
  evidenceTest('update, delete and truncate of an override row are refused', async () => {
    await override(6);
    await expect(
      migrator.query("update provisioning_limit_overrides set actor = 'someone else'"),
    ).rejects.toMatchObject({ code: '23000' });
    await expect(migrator.query('delete from provisioning_limit_overrides')).rejects.toMatchObject({
      code: '23000',
    });
    await expect(migrator.query('truncate provisioning_limit_overrides')).rejects.toMatchObject({
      code: '23000',
    });
    expect(await overrides()).toBe(1);
  });

  evidenceTest(
    'the guard also fires when the session asks for replica trigger semantics',
    async () => {
      const client = await migrator.connect();
      try {
        let allowed = true;
        try {
          await client.query("set session_replication_role = 'replica'");
        } catch (error) {
          // Where the role may not set it at all, there is nothing to skip the guard with.
          expect((error as { code?: string }).code).toBe('42501');
          allowed = false;
        }
        if (allowed) {
          await expect(
            client.query('update provisioning_limits set early_access_cap = 6'),
          ).rejects.toMatchObject({ code: '23000' });
        }
      } finally {
        // A session-level setting must not return to the pool.
        client.release(true);
      }
      expect(await limits()).toStrictEqual({ cap: 5, counter: 0 });
    },
  );

  evidenceTest('runtime roles still cannot change the limits or touch the record', async () => {
    const app = database.pool();
    for (const pool of [provisioner, app]) {
      await expect(
        pool.query('update provisioning_limits set early_access_cap = 999'),
      ).rejects.toMatchObject({ code: '42501' });
      await expect(
        pool.query('select app.override_early_access_cap(999, null, $1, $2, $3)', [
          REASON,
          'founder',
          APPROVAL,
        ]),
      ).rejects.toMatchObject({ code: '42501' });
      await expect(pool.query('select * from provisioning_limit_overrides')).rejects.toMatchObject({
        code: '42501',
      });
      await expect(
        pool.query(
          "insert into provisioning_limit_overrides (old_cap, new_cap, old_counter, new_counter, reason, actor, approval_ref) values (5, 999, 0, 0, 'forged by hand', 'x', 'forged approval')",
        ),
      ).rejects.toMatchObject({ code: '42501' });
    }
  });
});

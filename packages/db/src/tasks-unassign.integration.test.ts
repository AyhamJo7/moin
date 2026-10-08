/**
 * Task return-to-unassigned (P06.08.03, INV-01, INV-02).
 *
 * The `memberships_unassign_tasks` trigger (0025) returns a departing member's work:
 * DELETE of a membership, or UPDATE leaving `active`, sets their tasks' assignee to
 * NULL in the same commit. Runs as the application role (NOBYPASSRLS, owns nothing),
 * exactly as traffic does — a superuser would bypass the policies under test.
 *
 * Synthetic data only (INV-16).
 */
import { randomUUID } from 'node:crypto';
import { createTestDatabase, evidenceTest, type TestDatabase } from '@moin/testing';
import { withTenant } from './tenant.ts';
import { afterAll, beforeAll, describe, expect } from 'vitest';

let database: TestDatabase;
let admin: ReturnType<TestDatabase['fixturePool']>;

beforeAll(async () => {
  database = await createTestDatabase('tasks-unassign');
  admin = database.fixturePool();
}, 60_000);

afterAll(async () => {
  await database.drop();
});

async function org(slug: string): Promise<string> {
  const id = randomUUID();
  await admin.query('insert into organisations (id, slug, name) values ($1, $2, $3)', [
    id,
    slug,
    'Unassign Org',
  ]);
  return id;
}

async function person(): Promise<string> {
  const id = randomUUID();
  const sub = randomUUID();
  await admin.query('insert into users (id, cognito_sub, email, status) values ($1, $2, $3, $4)', [
    id,
    sub,
    `${sub.slice(0, 8)}@example.test`,
    'active',
  ]);
  return id;
}

async function member(organisationId: string, userId: string, role = 'staff'): Promise<void> {
  await admin.query(
    'insert into memberships (organisation_id, id, user_id, role, status) values ($1, $2, $3, $4, $5)',
    [organisationId, randomUUID(), userId, role, 'active'],
  );
}

async function task(
  organisationId: string,
  title: string,
  assignee: string | null,
): Promise<string> {
  const id = randomUUID();
  await withTenant(database.pool(), organisationId, async (gate) => {
    await gate.query(
      'insert into tasks (organisation_id, id, title, assignee_user_id) values ($1, $2, $3, $4)',
      [organisationId, id, title, assignee],
    );
  });
  return id;
}

async function assigneeOf(organisationId: string, taskId: string): Promise<string | null> {
  const rows = await withTenant(database.pool(), organisationId, async (gate) =>
    gate.query<{ assignee_user_id: string | null }>(
      'select assignee_user_id from tasks where id = $1',
      [taskId],
    ),
  );
  return rows.rows[0]?.assignee_user_id ?? null;
}

describe('return-to-unassigned on membership change (P06.08.03)', () => {
  evidenceTest('disable returns their tasks, keeps others assigned', async () => {
    const orgId = await org(`u-${randomUUID().slice(0, 8)}`);
    const leaver = await person();
    const keeper = await person();
    await member(orgId, leaver);
    await member(orgId, keeper);
    const keeperOwner = await person();
    await member(orgId, keeperOwner, 'owner');
    const freed = await task(orgId, 'Rückruf Frau Berger', leaver);
    const kept = await task(orgId, 'Angebot schreiben', keeper);
    await withTenant(database.pool(), orgId, async (gate) => {
      await gate.query("update memberships set status = 'disabled' where user_id = $1", [leaver]);
    });
    expect(await assigneeOf(orgId, freed)).toBeNull();
    expect(await assigneeOf(orgId, kept)).toBe(keeper);
  });

  evidenceTest('remove returns their tasks', async () => {
    const orgId = await org(`u-${randomUUID().slice(0, 8)}`);
    const leaver = await person();
    await member(orgId, leaver);
    const keeperOwner = await person();
    await member(orgId, keeperOwner, 'owner');
    const freed = await task(orgId, 'Rückruf Herr Demir', leaver);
    await withTenant(database.pool(), orgId, async (gate) => {
      await gate.query('delete from memberships where user_id = $1', [leaver]);
    });
    expect(await assigneeOf(orgId, freed)).toBeNull();
  });

  evidenceTest('demote-to-admin (still active) keeps their tasks', async () => {
    const orgId = await org(`u-${randomUUID().slice(0, 8)}`);
    const admin = await person();
    await member(orgId, admin, 'admin');
    const keeperOwner = await person();
    await member(orgId, keeperOwner, 'owner');
    const held = await task(orgId, 'Rechnung prüfen', admin);
    await withTenant(database.pool(), orgId, async (gate) => {
      // eslint-disable-next-line no-restricted-syntax -- membership write through the tenant wrapper; the SET-session rule matches UPDATE ... SET verb text.
      await gate.query("update memberships set role = 'staff' where user_id = $1", [admin]);
    });
    expect(await assigneeOf(orgId, held)).toBe(admin);
  });

  evidenceTest('same user in another tenant keeps their tasks (RLS)', async () => {
    const orgA = await org(`a-${randomUUID().slice(0, 8)}`);
    const orgB = await org(`b-${randomUUID().slice(0, 8)}`);
    const personId = await person();
    await member(orgA, personId);
    await member(orgB, personId);
    const ownerA = await person();
    await member(orgA, ownerA, 'owner');
    const taskB = await task(orgB, 'B-Tenant Aufgabe', personId);
    await withTenant(database.pool(), orgA, async (gate) => {
      await gate.query('delete from memberships where user_id = $1', [personId]);
    });
    expect(await assigneeOf(orgB, taskB)).toBe(personId);
  });

  evidenceTest('titles over 72 chars are rejected', async () => {
    const orgId = await org(`b-${randomUUID().slice(0, 8)}`);
    const who = await person();
    await member(orgId, who);
    await expect(task(orgId, 'x'.repeat(73), who)).rejects.toMatchObject({ code: '23514' });
    // The boundary itself stays writable: exactly 72 chars lands.
    expect(await task(orgId, 'y'.repeat(72), who)).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  evidenceTest('tasks carry FORCE RLS: owner sees rows only with tenant set', async () => {
    const orgId = await org(`r-${randomUUID().slice(0, 8)}`);
    const who = await person();
    await member(orgId, who);
    await task(orgId, 'Sichtbarkeitsprobe', who);
    // No tenant: empty, not everything (fail-closed read path, INV-02).
    const bare = await database
      .pool()
      .query<{ n: string }>('select count(*)::text as n from tasks');
    expect(bare.rows[0]?.n).toBe('0');
    const scoped = await withTenant(database.pool(), orgId, async (gate) =>
      gate.query<{ n: string }>('select count(*)::text as n from tasks'),
    );
    expect(scoped.rows[0]?.n).toBe('1');
  });
});

/**
 * Leads (P07.07.03): machine, linkage invariant, tenant isolation.
 */
import { createTestDatabase, evidenceTest, type TestDatabase } from '@moin/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { listAuditEvents } from './audit.ts';
import { createLead, getLead, listLeads, setLeadStatus, VersionConflictError } from './leads.ts';
import { createPool, type Pool } from './pool.ts';
import { withTenant } from './tenant.ts';

const ORG_A = '11111111-1111-4111-8111-111111111111';
const ORG_B = '22222222-2222-4222-8222-222222222222';

let database: TestDatabase;
let app: Pool;
let admin: Pool;

beforeAll(async () => {
  database = await createTestDatabase('leads');
  app = database.pool();
  admin = createPool({ connectionString: database.migrationUrl, max: 1 });
  await admin.query(
    `insert into organisations (id, slug, name) values ($1, 'alpha', 'Alpha GmbH'), ($2, 'beta', 'Beta GmbH')`,
    [ORG_A, ORG_B],
  );
});

afterAll(async () => {
  await admin.end();
  await database.drop();
});

describe('leads', () => {
  evidenceTest('walks the BR-008 machine with versions', async () => {
    const lead = await withTenant(app, ORG_A, (client) => createLead(client, { title: 'Neuer' }));
    expect(lead.status).toBe('new');
    const needs = await withTenant(app, ORG_A, (client) =>
      setLeadStatus(client, lead.id, 'needs_action', lead.version),
    );
    expect(needs.status).toBe('needs_action');
    expect(needs.taskId).not.toBeNull();
    const contacted = await withTenant(app, ORG_A, (client) =>
      setLeadStatus(client, lead.id, 'contacted', needs.version),
    );
    const waiting = await withTenant(app, ORG_A, (client) =>
      setLeadStatus(client, contacted.id, 'waiting', contacted.version),
    );
    const done = await withTenant(app, ORG_A, (client) =>
      setLeadStatus(client, waiting.id, 'done', waiting.version),
    );
    expect(done.status).toBe('done');
  });

  evidenceTest('illegal jumps and stale versions are 409', async () => {
    const lead = await withTenant(app, ORG_A, (client) => createLead(client, { title: 'Jump' }));
    await expect(
      withTenant(app, ORG_A, (client) => setLeadStatus(client, lead.id, 'done', lead.version)),
    ).rejects.toBeInstanceOf(VersionConflictError);
    const moved = await withTenant(app, ORG_A, (client) =>
      setLeadStatus(client, lead.id, 'needs_action', lead.version),
    );
    await expect(
      withTenant(app, ORG_A, (client) => setLeadStatus(client, lead.id, 'contacted', lead.version)),
    ).rejects.toBeInstanceOf(VersionConflictError);
    expect(moved.taskId).not.toBeNull();
  });

  evidenceTest('lost needs a reason, and only lost carries one', async () => {
    const lead = await withTenant(app, ORG_A, (client) => createLead(client, { title: 'Lost' }));
    await expect(
      withTenant(app, ORG_A, (client) => setLeadStatus(client, lead.id, 'lost', lead.version)),
    ).rejects.toBeInstanceOf(RangeError);
    await expect(
      withTenant(app, ORG_A, (client) =>
        setLeadStatus(client, lead.id, 'needs_action', lead.version, 'no_interest'),
      ),
    ).rejects.toBeInstanceOf(RangeError);
    const lost = await withTenant(app, ORG_A, (client) =>
      setLeadStatus(client, lead.id, 'lost', lead.version, 'no_budget'),
    );
    expect(lost).toMatchObject({ status: 'lost', lostReason: 'no_budget' });
    // DB CHECK mirrors the service: hand-written reasonless lost row is rejected (23514).
    await expect(
      withTenant(app, ORG_A, (client) =>
        client.query(
          `insert into leads (organisation_id, id, title, status)
           values (app.current_org(), gen_random_uuid(), 'Hand', 'lost')`,
        ),
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });

  evidenceTest('needs_action always has an open task, even under concurrency', async () => {
    const lead = await withTenant(app, ORG_A, (client) => createLead(client, { title: 'Race' }));
    // Both racers use the same version: exactly one wins the guarded UPDATE, the other 409s —
    // and whichever state the lead ends in, the linkage invariant holds.
    const outcomes = await Promise.allSettled([
      withTenant(app, ORG_A, (client) =>
        setLeadStatus(client, lead.id, 'needs_action', lead.version),
      ),
      withTenant(app, ORG_A, (client) =>
        setLeadStatus(client, lead.id, 'needs_action', lead.version),
      ),
    ]);
    const won = outcomes.filter((r) => r.status === 'fulfilled');
    expect(won.length).toBe(1);
    const rows = await withTenant(app, ORG_A, (client) =>
      client.query<{ task_id: string | null; n: string }>(
        `select task_id::text, (select count(*)::text from tasks t
          join lead_tasks lt on lt.task_id = t.id where lt.lead_id = $1) as n
         from leads where id = $1`,
        [lead.id],
      ),
    );
    expect(rows.rows[0]?.task_id).not.toBeNull();
    expect(Number(rows.rows[0]?.n)).toBeGreaterThanOrEqual(1);
  });

  evidenceTest('cross-tenant leads are invisible', async () => {
    await withTenant(app, ORG_A, (client) => createLead(client, { title: 'Private lead' }));
    const foreign = await withTenant(app, ORG_B, (client) => listLeads(client));
    expect(foreign.map((l) => l.title)).not.toContain('Private lead');
  });

  evidenceTest('mutations audit with opaque markers, no titles', async () => {
    const lead = await withTenant(app, ORG_A, (client) =>
      createLead(client, { title: 'Geheiminteressent' }),
    );
    await withTenant(app, ORG_A, (client) =>
      setLeadStatus(client, lead.id, 'lost', lead.version, 'other'),
    );
    await withTenant(app, ORG_A, async (client) => {
      const events = await listAuditEvents(client, { targetId: lead.id });
      expect(events.map((e) => e.operation).sort()).toStrictEqual(['lead.create', 'lead.status']);
      for (const event of events) {
        expect(JSON.stringify(event.args_sanitized)).not.toContain('Geheiminteressent');
      }
    });
  });

  it('lists by status with capped pagination', async () => {
    const lead = await withTenant(app, ORG_B, (client) => createLead(client, { title: 'Filter' }));
    await withTenant(app, ORG_B, (client) =>
      setLeadStatus(client, lead.id, 'lost', lead.version, 'duplicate'),
    );
    const lost = await withTenant(app, ORG_B, (client) => listLeads(client, { status: 'lost' }));
    expect(lost.map((l) => l.id)).toContain(lead.id);
    const fresh = await withTenant(app, ORG_B, (client) => listLeads(client, { status: 'new' }));
    expect(fresh.map((l) => l.id)).not.toContain(lead.id);
  });

  evidenceTest('getLead heals a dead link: completed task and deleted task', async () => {
    // Close the linked task through the legal tasks.ts walk (open→in_progress→waiting→done).
    const lead = await withTenant(app, ORG_A, (client) => createLead(client, { title: 'Heal' }));
    const moved = await withTenant(app, ORG_A, (client) =>
      setLeadStatus(client, lead.id, 'needs_action', lead.version),
    );
    const firstTask = moved.taskId;
    if (firstTask === null) throw new Error('no task linked');
    const { setTaskStatus, completeTask } = await import('./tasks.ts');
    const step1 = await withTenant(app, ORG_A, async (client) => {
      const t = await client.query<{ id: string; version: string }>(
        `select id::text, version::text from tasks where id = $1`,
        [firstTask],
      );
      return t.rows[0];
    });
    await withTenant(app, ORG_A, (client) =>
      setTaskStatus(client, firstTask, 'in_progress', Number(step1?.version ?? '1')),
    );
    const step2 = await withTenant(app, ORG_A, async (client) => {
      const t = await client.query<{ id: string; version: string }>(
        `select id::text, version::text from tasks where id = $1`,
        [firstTask],
      );
      return t.rows[0];
    });
    await withTenant(app, ORG_A, (client) =>
      setTaskStatus(client, firstTask, 'waiting', Number(step2?.version ?? '1')),
    );
    const step3 = await withTenant(app, ORG_A, async (client) => {
      const t = await client.query<{ id: string; version: string }>(
        `select id::text, version::text from tasks where id = $1`,
        [firstTask],
      );
      return t.rows[0];
    });
    await withTenant(app, ORG_A, (client) =>
      completeTask(client, firstTask, Number(step3?.version ?? '1')),
    );
    // getLead repairs: fresh open task, different id, history now has 2 rows.
    const healed = await withTenant(app, ORG_A, (client) => getLead(client, lead.id));
    expect(healed.status).toBe('needs_action');
    expect(healed.taskId).not.toBeNull();
    expect(healed.taskId).not.toBe(firstTask);
    const history = await withTenant(app, ORG_A, (client) =>
      client.query<{ n: string }>(`select count(*)::text as n from lead_tasks where lead_id = $1`, [
        lead.id,
      ]),
    );
    expect(history.rows[0]?.n).toBe('2');
    // Delete the fresh task privileged; getLead heals again.
    await admin.query(`delete from tasks where id = $1`, [healed.taskId]);
    const healed2 = await withTenant(app, ORG_A, (client) => getLead(client, lead.id));
    expect(healed2.taskId).not.toBeNull();
    expect(healed2.taskId).not.toBe(healed.taskId);
    expect(healed2.version).toBe(healed.version);
  });

  evidenceTest('concurrent heals converge on one fresh task', async () => {
    const lead = await withTenant(app, ORG_A, (client) =>
      createLead(client, { title: 'HealRace' }),
    );
    const moved = await withTenant(app, ORG_A, (client) =>
      setLeadStatus(client, lead.id, 'needs_action', lead.version),
    );
    const deadTask = moved.taskId;
    if (deadTask === null) throw new Error('no task linked');
    // Kill the link privileged so both healers see a dead link.
    await admin.query(`delete from tasks where id = $1`, [deadTask]);
    const tasksBefore = await withTenant(app, ORG_A, (client) =>
      client.query<{ n: string }>(`select count(*)::text as n from tasks`),
    );
    const [one, two] = await Promise.all([
      withTenant(app, ORG_A, (client) => getLead(client, lead.id)),
      withTenant(app, ORG_A, (client) => getLead(client, lead.id)),
    ]);
    expect(one.taskId).not.toBeNull();
    expect(two.taskId).toBe(one.taskId);
    const tasksAfter = await withTenant(app, ORG_A, (client) =>
      client.query<{ n: string }>(`select count(*)::text as n from tasks`),
    );
    // Exactly one fresh task: the loser re-checked under the row lock and took the winner.
    expect(Number(tasksAfter.rows[0]?.n) - Number(tasksBefore.rows[0]?.n)).toBe(1);
    const history = await withTenant(app, ORG_A, (client) =>
      client.query<{ n: string }>(`select count(*)::text as n from lead_tasks where lead_id = $1`, [
        lead.id,
      ]),
    );
    // History: entry task + exactly one heal row (the loser wrote no history).
    expect(history.rows[0]?.n).toBe('1');
  });

  evidenceTest('no heal outside needs_action: moved-on lead stays untouched', async () => {
    const lead = await withTenant(app, ORG_A, (client) => createLead(client, { title: 'MovedOn' }));
    const moved = await withTenant(app, ORG_A, (client) =>
      setLeadStatus(client, lead.id, 'needs_action', lead.version),
    );
    const linkedTask = moved.taskId;
    if (linkedTask === null) throw new Error('no task linked');
    // Legal exit keeps the (open) task; then kill it privileged — the lead is contacted with a
    // dead link, the exact state the lock-race would produce.
    const contacted = await withTenant(app, ORG_A, (client) =>
      setLeadStatus(client, lead.id, 'contacted', moved.version),
    );
    await admin.query(`delete from tasks where id = $1`, [linkedTask]);
    const tasksBefore = await withTenant(app, ORG_A, (client) =>
      client.query<{ n: string }>(`select count(*)::text as n from tasks`),
    );
    const historyBefore = await withTenant(app, ORG_A, (client) =>
      client.query<{ n: string }>(`select count(*)::text as n from lead_tasks where lead_id = $1`, [
        lead.id,
      ]),
    );
    const read = await withTenant(app, ORG_A, (client) => getLead(client, lead.id));
    expect(read.status).toBe('contacted');
    // The privileged delete nulled the link via the column-list SET NULL; getLead must NOT
    // re-heal outside needs_action: no new task, no history row, taskId stays NULL.
    expect(read.taskId).toBeNull();
    const tasksAfter = await withTenant(app, ORG_A, (client) =>
      client.query<{ n: string }>(`select count(*)::text as n from tasks`),
    );
    expect(tasksAfter.rows[0]?.n).toBe(tasksBefore.rows[0]?.n);
    const historyAfter = await withTenant(app, ORG_A, (client) =>
      client.query<{ n: string }>(`select count(*)::text as n from lead_tasks where lead_id = $1`, [
        lead.id,
      ]),
    );
    expect(historyAfter.rows[0]?.n).toBe(historyBefore.rows[0]?.n);
    expect(contacted.version).toBeDefined();
  });
});

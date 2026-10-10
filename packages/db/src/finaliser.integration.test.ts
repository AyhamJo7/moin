/**
 * No-lost-interaction invariant (P07.11.04): the finaliser converges, the reconciler catches
 * what a killed process left behind, and a double run never duplicates.
 */
import { createTestDatabase, evidenceTest, type TestDatabase } from '@moin/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { listAuditEvents } from './audit.ts';
import { ingestCall, recordOutcome, startConversation } from './conversations.ts';
import { finaliseInteraction, orphanSeverity, reconcileOrphans } from './finaliser.ts';
import { createPool, type Pool } from './pool.ts';
import { listOpenTasks } from './tasks.ts';
import { withTenant } from './tenant.ts';

const ORG_A = '11111111-1111-4111-8111-111111111111';
const ORG_B = '22222222-2222-4222-8222-222222222222';

let database: TestDatabase;
let app: Pool;
let admin: Pool;

beforeAll(async () => {
  database = await createTestDatabase('finaliser');
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

describe('finaliser', () => {
  evidenceTest('interaction end with outcome is a no-op verdict', async () => {
    const convo = await withTenant(app, ORG_A, (client) =>
      startConversation(client, { channel: 'call' }),
    );
    await withTenant(app, ORG_A, (client) =>
      recordOutcome(client, convo.id, { resultCode: 'handled', handledAutomatically: false }),
    );
    const done = await withTenant(app, ORG_A, (client) => finaliseInteraction(client, convo.id));
    expect(done.verdict).toBe('outcome-existed');
    expect(done.taskId).toBeNull();
    const tasks = await withTenant(app, ORG_A, (client) => listOpenTasks(client));
    expect(tasks.filter((t) => t.conversationId === convo.id)).toHaveLength(0);
  });

  evidenceTest('interaction end without outcome creates the German callback fallback', async () => {
    const convo = await withTenant(app, ORG_A, (client) =>
      startConversation(client, { channel: 'call' }),
    );
    const done = await withTenant(app, ORG_A, (client) => finaliseInteraction(client, convo.id));
    expect(done.verdict).toBe('fallback-created');
    expect(done.taskId).not.toBeNull();
    const tasks = await withTenant(app, ORG_A, (client) => listOpenTasks(client));
    const fallback = tasks.find((t) => t.conversationId === convo.id);
    expect(fallback).toMatchObject({
      title: 'Rückruf – Anruf ohne Ergebnis',
      type: 'callback',
      priority: 'high',
      status: 'open',
    });
    // The audit row carries the verdict marker, never the title text.
    await withTenant(app, ORG_A, async (client) => {
      const events = await listAuditEvents(client, { targetId: convo.id });
      const finalise = events.find((e) => e.operation === 'interaction.finalise');
      expect(finalise?.args_sanitized).toStrictEqual({ verdict: 2 });
    });
  });

  evidenceTest('existing open task is a no-op verdict, never a second task', async () => {
    const convo = await withTenant(app, ORG_A, (client) =>
      startConversation(client, { channel: 'call' }),
    );
    const first = await withTenant(app, ORG_A, (client) => finaliseInteraction(client, convo.id));
    expect(first.verdict).toBe('fallback-created');
    const second = await withTenant(app, ORG_A, (client) => finaliseInteraction(client, convo.id));
    expect(second.verdict).toBe('task-existed');
    const tasks = await withTenant(app, ORG_A, (client) => listOpenTasks(client));
    expect(tasks.filter((t) => t.conversationId === convo.id)).toHaveLength(1);
  });

  evidenceTest('concurrent finalisers converge on one fallback task', async () => {
    const convo = await withTenant(app, ORG_A, (client) =>
      startConversation(client, { channel: 'call' }),
    );
    const [one, two] = await Promise.all([
      withTenant(app, ORG_A, (client) => finaliseInteraction(client, convo.id)),
      withTenant(app, ORG_A, (client) => finaliseInteraction(client, convo.id)),
    ]);
    const created = [one, two].filter((r) => r.verdict === 'fallback-created');
    expect(created).toHaveLength(1);
    const tasks = await withTenant(app, ORG_A, (client) => listOpenTasks(client));
    expect(tasks.filter((t) => t.conversationId === convo.id)).toHaveLength(1);
  });

  evidenceTest(
    'simulated kill mid-call: reconciler creates the task, double run is idempotent',
    async () => {
      // A call ingested but never finished and never finalised — the killed process.
      const ingested = await withTenant(app, ORG_A, (client) =>
        ingestCall(client, { providerCallSid: 'CA-killed-1', fromNumber: '+4930123456' }),
      );
      expect(ingested.created).toBe(true);
      // Age it past the cutoff without touching the service (the process died, nothing updated it).
      await admin.query(
        `update conversations set updated_at = clock_timestamp() - make_interval(mins => 11)
       where id = $1`,
        [ingested.call.conversationId],
      );
      const first = await reconcileOrphans(app, { olderThanMinutes: 10 });
      expect(first.orphans.map((o) => o.conversationId)).toContain(ingested.call.conversationId);
      expect(first.orphaned).toBeGreaterThanOrEqual(1);
      const tasks = await withTenant(app, ORG_A, (client) => listOpenTasks(client));
      expect(tasks.filter((t) => t.conversationId === ingested.call.conversationId)).toHaveLength(
        1,
      );
      // Double run: the fallback task now counts as the open task — nothing left to claim.
      const second = await reconcileOrphans(app, { olderThanMinutes: 10 });
      expect(second.finalised).toBe(0);
      expect(second.orphaned).toBe(0);
      const again = await withTenant(app, ORG_A, (client) => listOpenTasks(client));
      expect(again.filter((t) => t.conversationId === ingested.call.conversationId)).toHaveLength(
        1,
      );
    },
  );

  evidenceTest('reconciler skips fresh interactions and decided ones', async () => {
    const fresh = await withTenant(app, ORG_A, (client) =>
      startConversation(client, { channel: 'call' }),
    );
    const decided = await withTenant(app, ORG_A, (client) =>
      startConversation(client, { channel: 'call' }),
    );
    await withTenant(app, ORG_A, (client) =>
      recordOutcome(client, decided.id, { resultCode: 'spam', handledAutomatically: true }),
    );
    await admin.query(
      `update conversations set updated_at = clock_timestamp() - make_interval(mins => 11)
       where id in ($1, $2)`,
      [fresh.id, decided.id],
    );
    // The decided one is excluded by its outcome row; the aged-but-fresh one is claimed
    // (age is the only clock — a live call updates its conversation, a dead one does not).
    const report = await reconcileOrphans(app, { olderThanMinutes: 10 });
    expect(report.orphans.map((o) => o.conversationId)).not.toContain(decided.id);
    expect(report.orphans.map((o) => o.conversationId)).toContain(fresh.id);
  });

  evidenceTest('reconciler is cross-tenant: B orphans do not leak into A', async () => {
    const foreign = await withTenant(app, ORG_B, (client) =>
      startConversation(client, { channel: 'call' }),
    );
    await admin.query(
      `update conversations set updated_at = clock_timestamp() - make_interval(mins => 11)
       where id = $1`,
      [foreign.id],
    );
    const seen: string[] = [];
    await reconcileOrphans(app, {
      olderThanMinutes: 10,
      onOrphan: (orphan) => {
        seen.push(`${orphan.organisationId}:${orphan.conversationId}`);
      },
    });
    expect(seen.some((s) => s.endsWith(`:${foreign.id}`))).toBe(true);
    const tasksA = await withTenant(app, ORG_A, (client) => listOpenTasks(client));
    expect(tasksA.filter((t) => t.conversationId === foreign.id)).toHaveLength(0);
    const tasksB = await withTenant(app, ORG_B, (client) => listOpenTasks(client));
    expect(tasksB.filter((t) => t.conversationId === foreign.id)).toHaveLength(1);
  });

  it('orphan severity: first sighting SEV2, repeat SEV1', () => {
    const convo = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    expect(orphanSeverity(new Set(), convo)).toBe('SEV2');
    expect(orphanSeverity(new Set([convo]), convo)).toBe('SEV1');
    expect(orphanSeverity(new Set(['bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb']), convo)).toBe('SEV2');
  });
});

/**
 * Tasks (P07.06.04): illegal transitions rejected, concurrent edits 409, idempotent creation.
 */
import { createTestDatabase, evidenceTest, type TestDatabase } from '@moin/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { listAuditEvents } from './audit.ts';
import {
  VersionConflictError,
  assignTask,
  completeTask,
  createTask,
  listOpenTasks,
  reopenTask,
  setTaskStatus,
  snoozeTask,
} from './tasks.ts';
import { createPool, type Pool } from './pool.ts';
import { withTenant } from './tenant.ts';

const ORG_A = '11111111-1111-4111-8111-111111111111';
const ORG_B = '22222222-2222-4222-8222-222222222222';

let database: TestDatabase;
let app: Pool;
let admin: Pool;

beforeAll(async () => {
  database = await createTestDatabase('tasks');
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

describe('tasks', () => {
  evidenceTest('full lifecycle: open to done with version bumps', async () => {
    const task = await withTenant(app, ORG_A, (client) =>
      createTask(client, {
        title: 'Rückruf',
        type: 'callback',
        priority: 'high',
        dueAt: new Date('2026-11-01T09:00:00Z'),
      }),
    );
    expect(task.status).toBe('open');
    expect(task.dueAt?.toISOString()).toBe('2026-11-01T09:00:00.000Z');
    const started = await withTenant(app, ORG_A, (client) =>
      setTaskStatus(client, task.id, 'in_progress', task.version),
    );
    expect(started.version).toBe(task.version + 1);
    const done = await withTenant(app, ORG_A, (client) =>
      setTaskStatus(client, started.id, 'done', started.version),
    );
    expect(done.status).toBe('done');
    const reopened = await withTenant(app, ORG_A, (client) =>
      reopenTask(client, done.id, done.version),
    );
    expect(reopened.status).toBe('open');
  });

  evidenceTest('illegal transitions are rejected for every rung', async () => {
    // [setup path from open, illegal target]: setup runs only legal moves.
    const illegal: {
      setup: ('in_progress' | 'waiting' | 'done' | 'cancelled')[];
      next: 'open' | 'in_progress' | 'waiting' | 'done' | 'cancelled';
    }[] = [
      { setup: [], next: 'done' },
      { setup: ['in_progress'], next: 'open' },
      { setup: ['waiting'], next: 'open' },
      { setup: ['in_progress', 'done'], next: 'in_progress' },
      { setup: ['in_progress', 'done'], next: 'cancelled' },
      { setup: ['cancelled'], next: 'open' },
    ];
    for (const { setup, next } of illegal) {
      const task = await withTenant(app, ORG_A, (client) =>
        createTask(client, { title: `Illegal ${setup.join(',')} ${next}` }),
      );
      let current = task;
      for (const rung of setup) {
        current = await withTenant(app, ORG_A, (client) =>
          setTaskStatus(client, current.id, rung, current.version),
        );
      }
      await expect(
        withTenant(app, ORG_A, (client) =>
          setTaskStatus(client, current.id, next, current.version),
        ),
        `${current.status} → ${next}`,
      ).rejects.toBeInstanceOf(VersionConflictError);
    }
  });

  evidenceTest('concurrent edits: exactly one writer wins', async () => {
    const task = await withTenant(app, ORG_A, (client) => createTask(client, { title: 'Race' }));
    const [one, two] = await Promise.allSettled([
      withTenant(app, ORG_A, (client) =>
        setTaskStatus(client, task.id, 'in_progress', task.version),
      ),
      withTenant(app, ORG_A, (client) => setTaskStatus(client, task.id, 'waiting', task.version)),
    ]);
    const won = [one, two].filter((r) => r.status === 'fulfilled');
    const lost = [one, two].filter((r) => r.status === 'rejected');
    expect(won.length).toBe(1);
    expect(lost).toHaveLength(1);
    expect(lost).toHaveLength(1);
    const reasons: unknown[] = [];
    for (const outcome of lost) {
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- allSettled narrows by status at runtime; the linter cannot see it.
      if (outcome.status === 'rejected') reasons.push(outcome.reason);
    }
    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toBeInstanceOf(VersionConflictError);
  });

  evidenceTest('idempotent creation returns the first row on retry', async () => {
    const first = await withTenant(app, ORG_A, (client) =>
      createTask(client, { title: 'System review', type: 'review', idempotencyKey: 'sys-1' }),
    );
    const second = await withTenant(app, ORG_A, (client) =>
      createTask(client, { title: 'Different title', type: 'review', idempotencyKey: 'sys-1' }),
    );
    expect(second.id).toBe(first.id);
    expect(second.title).toBe('System review');
    const [one, two] = await Promise.all([
      withTenant(app, ORG_A, (client) =>
        createTask(client, { title: 'Race key', type: 'callback', idempotencyKey: 'sys-race' }),
      ),
      withTenant(app, ORG_A, (client) =>
        createTask(client, { title: 'Race key 2', type: 'callback', idempotencyKey: 'sys-race' }),
      ),
    ]);
    expect(one.id).toBe(two.id);
  });

  evidenceTest('assign, snooze and complete behave', async () => {
    const userId = '33333333-3333-4333-8333-333333333333';
    const task = await withTenant(app, ORG_A, (client) => createTask(client, { title: 'Work' }));
    const assigned = await withTenant(app, ORG_A, (client) =>
      assignTask(client, task.id, userId, task.version),
    );
    expect(assigned.assigneeUserId).toBe(userId);
    await expect(
      withTenant(app, ORG_A, (client) =>
        assignTask(client, task.id, 'not-a-uuid', assigned.version),
      ),
    ).rejects.toBeInstanceOf(RangeError);
    const snoozed = await withTenant(app, ORG_A, (client) =>
      snoozeTask(client, task.id, new Date('2026-12-01T08:00:00Z'), assigned.version),
    );
    expect(snoozed.snoozedUntil?.toISOString()).toBe('2026-12-01T08:00:00.000Z');
    expect(snoozed.status).toBe('open');
    const done = await withTenant(app, ORG_A, (client) =>
      completeTask(client, task.id, snoozed.version),
    );
    expect(done.status).toBe('done');
  });

  evidenceTest('cross-tenant task rows are invisible', async () => {
    await withTenant(app, ORG_A, (client) => createTask(client, { title: 'Private task' }));
    const foreign = await withTenant(app, ORG_B, (client) => listOpenTasks(client));
    expect(foreign.map((t) => t.title)).not.toContain('Private task');
  });

  evidenceTest('mutations audit with opaque markers, no titles', async () => {
    const task = await withTenant(app, ORG_A, (client) =>
      createTask(client, { title: 'Geheimtitel', type: 'callback' }),
    );
    await withTenant(app, ORG_A, (client) =>
      setTaskStatus(client, task.id, 'waiting', task.version),
    );
    await withTenant(app, ORG_A, async (client) => {
      const events = await listAuditEvents(client, { targetId: task.id });
      expect(events.map((e) => e.operation).sort()).toStrictEqual(['task.create', 'task.status']);
      for (const event of events) {
        expect(JSON.stringify(event.args_sanitized)).not.toContain('Geheimtitel');
      }
    });
  });

  it('rejects empty and oversized titles', async () => {
    await expect(
      withTenant(app, ORG_A, (client) => createTask(client, { title: '  ' })),
    ).rejects.toBeInstanceOf(RangeError);
    await expect(
      withTenant(app, ORG_A, (client) => createTask(client, { title: 'x'.repeat(73) })),
    ).rejects.toBeInstanceOf(RangeError);
  });
});

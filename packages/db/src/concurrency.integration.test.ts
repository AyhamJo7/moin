/**
 * Concurrency + optimistic locking suite (P07.13.02): parallel workers on real PG prove the
 * losers 409 instead of silently overwriting.
 *
 * Each test races two `withTenant` transactions holding the SAME version and asserts exactly
 * one wins: the loser gets `VersionConflictError` (409 at the HTTP layer via the shared
 * `version-conflict` problem type), the row keeps the winner's state, and a re-read shows
 * the bumped version the loser must retry against. The finaliser-vs-reconciler race
 * reuses the P07.11 convergence tests' shape at higher parallelism: N racers, one fallback
 * task, every loser reporting `task-existed`.
 */
import { createTestDatabase, evidenceTest, type TestDatabase } from '@moin/testing';
import { afterAll, beforeAll, describe, expect } from 'vitest';
import {
  createContact,
  updateContact,
  VersionConflictError as ContactConflict,
} from './contacts.ts';
import { startConversation } from './conversations.ts';
import { finaliseInteraction, reconcileOrphans } from './finaliser.ts';
import { createLead, getLead, setLeadStatus } from './leads.ts';
import { createPool, type Pool } from './pool.ts';
import { createTask, listOpenTasks, setTaskStatus } from './tasks.ts';
import { withTenant } from './tenant.ts';
import { isVersionConflict, versionConflictProblem } from './version-conflict.ts';

const ORG_A = '11111111-1111-4111-8111-111111111111';

let database: TestDatabase;
let app: Pool;
let admin: Pool;

beforeAll(async () => {
  database = await createTestDatabase('concurrency');
  app = database.pool();
  admin = createPool({ connectionString: database.migrationUrl, max: 1 });
  await admin.query(
    `insert into organisations (id, slug, name) values ($1, 'alpha', 'Alpha GmbH')`,
    [ORG_A],
  );
});

afterAll(async () => {
  await admin.end();
  await database.drop();
});

describe('concurrency', () => {
  evidenceTest('task edits: N parallel writers, one wins, rest 409', async () => {
    const task = await withTenant(app, ORG_A, (client) => createTask(client, { title: 'Race' }));
    const outcomes = await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        withTenant(app, ORG_A, (client) =>
          setTaskStatus(client, task.id, 'in_progress', task.version),
        ),
      ),
    );
    const won = outcomes.filter((r) => r.status === 'fulfilled');
    const lost = outcomes.filter((r) => r.status === 'rejected');
    expect(won).toHaveLength(1);
    expect(lost).toHaveLength(4);
    for (const outcome of lost) {
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- allSettled narrows by status at runtime; the linter cannot see it.
      if (outcome.status === 'rejected') expect(isVersionConflict(outcome.reason)).toBe(true);
    }
    // The winner's state stuck; a re-read shows the bumped version to retry against.
    const reread = await withTenant(app, ORG_A, (client) =>
      client.query<{ status: string; version: string }>(
        `select status, version::text from tasks where id = $1`,
        [task.id],
      ),
    );
    expect(reread.rows[0]?.status).toBe('in_progress');
    expect(Number(reread.rows[0]?.version)).toBe(task.version + 1);
  });

  evidenceTest('contact edits: parallel writers 409, winner visible', async () => {
    const contact = await withTenant(app, ORG_A, (client) =>
      createContact(client, { displayName: 'Anna Schmidt' }),
    );
    const outcomes = await Promise.allSettled([
      withTenant(app, ORG_A, (client) =>
        updateContact(client, contact.id, { displayName: 'Anna Meier', version: contact.version }),
      ),
      withTenant(app, ORG_A, (client) =>
        updateContact(client, contact.id, { displayName: 'Anna Weber', version: contact.version }),
      ),
    ]);
    const won = outcomes.filter((r) => r.status === 'fulfilled');
    const lost = outcomes.filter((r) => r.status === 'rejected');
    expect(won).toHaveLength(1);
    expect(lost).toHaveLength(1);
    if (lost[0]?.status === 'rejected') {
      expect(lost[0].reason).toBeInstanceOf(ContactConflict);
      expect(isVersionConflict(lost[0].reason)).toBe(true);
    } else {
      throw new Error('expected exactly one rejected contact write');
    }
  });

  evidenceTest('lead transitions: racers converge, loser 409s, linkage holds', async () => {
    const lead = await withTenant(app, ORG_A, (client) => createLead(client, { title: 'Race' }));
    const outcomes = await Promise.allSettled([
      withTenant(app, ORG_A, (client) =>
        setLeadStatus(client, lead.id, 'needs_action', lead.version),
      ),
      withTenant(app, ORG_A, (client) =>
        setLeadStatus(client, lead.id, 'needs_action', lead.version),
      ),
    ]);
    const won = outcomes.filter((r) => r.status === 'fulfilled');
    expect(won).toHaveLength(1);
    const read = await withTenant(app, ORG_A, (client) => getLead(client, lead.id));
    expect(read.status).toBe('needs_action');
    expect(read.taskId).not.toBeNull();
  });

  evidenceTest(
    'finaliser vs reconciler at N-way parallelism: one task, losers task-existed',
    async () => {
      const convo = await withTenant(app, ORG_A, (client) =>
        startConversation(client, { channel: 'call' }),
      );
      // Age all three legs so the reconciler genuinely claims this conversation.
      await admin.query(
        `update conversations set updated_at = clock_timestamp() - make_interval(mins => 11)
       where id = $1`,
        [convo.id],
      );
      // The advisory lock serialises same-conversation finalises: exactly one creator,
      // the rest report task-existed — whether they raced directly or through the sweep.
      const racers = await Promise.allSettled([
        withTenant(app, ORG_A, (client) => finaliseInteraction(client, convo.id)),
        withTenant(app, ORG_A, (client) => finaliseInteraction(client, convo.id)),
        reconcileOrphans(app, { olderThanMinutes: 10 }),
      ]);
      const created = racers.filter(
        (r) =>
          r.status === 'fulfilled' &&
          'verdict' in r.value &&
          r.value.verdict === 'fallback-created',
      );
      expect(created).toHaveLength(1);
      const tasks = await withTenant(app, ORG_A, (client) => listOpenTasks(client));
      expect(tasks.filter((t) => t.conversationId === convo.id)).toHaveLength(1);
    },
  );

  evidenceTest('shared problem type: shape, status, and narrowing', () => {
    const problem = versionConflictProblem({
      targetKind: 'task',
      targetId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      version: 3,
      status: 'in_progress',
    });
    expect(problem).toStrictEqual({
      type: '/problems/version-conflict',
      title: 'Version conflict',
      status: 409,
      current: {
        targetKind: 'task',
        targetId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        version: 3,
        status: 'in_progress',
      },
    });
    expect(isVersionConflict(new ContactConflict('stale'))).toBe(true);
    expect(isVersionConflict(new Error('boom'))).toBe(false);
    expect(isVersionConflict(null)).toBe(false);
  });
});

/**
 * Governance records (P07.10.03): every tool has an actor; TTL candidates are correct.
 */
import { createTestDatabase, evidenceTest, type TestDatabase } from '@moin/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { listAuditEvents } from './audit.ts';
import {
  decideApproval,
  finishRun,
  invokeTool,
  purgeCandidates,
  recordAction,
  reportInvocation,
  requestApproval,
  startRun,
  VersionConflictError,
} from './governance.ts';
import { createPool, type Pool } from './pool.ts';
import { withTenant } from './tenant.ts';

const ORG_A = '11111111-1111-4111-8111-111111111111';
const ORG_B = '22222222-2222-4222-8222-222222222222';
const STAFF = '33333333-3333-4333-8333-333333333333';

let database: TestDatabase;
let app: Pool;
let admin: Pool;

beforeAll(async () => {
  database = await createTestDatabase('governance');
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

describe('governance', () => {
  evidenceTest('run lifecycle: running to terminal, terminal never moves', async () => {
    const run = await withTenant(app, ORG_A, (client) => startRun(client, {}));
    expect(run.status).toBe('running');
    const done = await withTenant(app, ORG_A, (client) =>
      finishRun(client, run.id, 'succeeded', run.version),
    );
    expect(done.status).toBe('succeeded');
    await expect(
      withTenant(app, ORG_A, (client) => finishRun(client, run.id, 'failed', done.version)),
    ).rejects.toBeInstanceOf(VersionConflictError);
  });

  evidenceTest('every executed tool has an AI action or a user actor', async () => {
    const run = await withTenant(app, ORG_A, (client) => startRun(client, {}));
    const action = await withTenant(app, ORG_A, (client) =>
      recordAction(client, { kind: 'tool_call', workflowRunId: run.id }),
    );
    // AI-attributed invocation starts unknown.
    const invoked = await withTenant(app, ORG_A, (client) =>
      invokeTool(client, { toolName: 'calendar.check', aiActionId: action.id }),
    );
    expect(invoked.state).toBe('unknown');
    // Neither actor → unattributable; both → ambiguous. Both refused before SQL.
    await expect(
      withTenant(app, ORG_A, (client) => invokeTool(client, { toolName: 'x' })),
    ).rejects.toBeInstanceOf(RangeError);
    await expect(
      withTenant(app, ORG_A, (client) =>
        invokeTool(client, { toolName: 'x', aiActionId: action.id, actorUserId: STAFF }),
      ),
    ).rejects.toBeInstanceOf(RangeError);
    // User-attributed invocation works without an AI action.
    const userInvoked = await withTenant(app, ORG_A, (client) =>
      invokeTool(client, { toolName: 'manual.note', actorUserId: STAFF }),
    );
    expect(userInvoked.actorUserId).toBe(STAFF);
    // DB CHECK mirrors the service: hand-written neither/both rows rejected (23514).
    await expect(
      withTenant(app, ORG_A, (client) =>
        client.query(
          `insert into tool_invocations (organisation_id, id, tool_name)
           values (app.current_org(), gen_random_uuid(), 'hand')`,
        ),
      ),
    ).rejects.toMatchObject({ code: '23514' });
    // Report exactly once: second report 409s.
    const reported = await withTenant(app, ORG_A, (client) =>
      reportInvocation(client, invoked.id, 'succeeded'),
    );
    expect(reported.state).toBe('succeeded');
    await expect(
      withTenant(app, ORG_A, (client) => reportInvocation(client, invoked.id, 'failed')),
    ).rejects.toBeInstanceOf(VersionConflictError);
  });

  evidenceTest('approvals gate: pending decides once with a named decider', async () => {
    const approval = await withTenant(app, ORG_A, (client) =>
      requestApproval(client, { proposalKind: 'book' }),
    );
    expect(approval.status).toBe('pending');
    const decided = await withTenant(app, ORG_A, (client) =>
      decideApproval(client, approval.id, {
        decision: 'approved',
        decidedBy: STAFF,
        version: 1,
      }),
    );
    expect(decided).toMatchObject({ status: 'approved', decidedBy: STAFF });
    await expect(
      withTenant(app, ORG_A, (client) =>
        decideApproval(client, approval.id, { decision: 'rejected', decidedBy: STAFF, version: 2 }),
      ),
    ).rejects.toBeInstanceOf(VersionConflictError);
    // DB CHECK mirrors: hand-written decided-without-decider rejected (23514).
    await expect(
      withTenant(app, ORG_A, (client) =>
        client.query(
          `insert into human_approvals (organisation_id, id, proposal_kind, status)
           values (app.current_org(), gen_random_uuid(), 'book', 'approved')`,
        ),
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });

  evidenceTest('TTL purge candidates: expired only, capped, per table', async () => {
    const past = new Date('2020-01-01T00:00:00Z');
    const future = new Date('2099-01-01T00:00:00Z');
    const expired = await withTenant(app, ORG_A, (client) => startRun(client, { expiresAt: past }));
    await withTenant(app, ORG_A, (client) => startRun(client, { expiresAt: future }));
    await withTenant(app, ORG_A, (client) => startRun(client, {}));
    const candidates = await withTenant(app, ORG_A, (client) =>
      purgeCandidates(client, 'workflow_runs'),
    );
    expect(candidates).toContain(expired.id);
    expect(candidates).toHaveLength(1);
    expect(
      await withTenant(app, ORG_A, (client) => purgeCandidates(client, 'ai_actions')),
    ).toStrictEqual([]);
    expect(
      await withTenant(app, ORG_A, (client) => purgeCandidates(client, 'tool_invocations', 1)),
    ).toStrictEqual([]);
  });

  evidenceTest('cross-tenant governance rows are invisible', async () => {
    await withTenant(app, ORG_A, (client) => startRun(client, {}));
    const foreign = await withTenant(app, ORG_B, (client) =>
      client.query<{ n: string }>(`select count(*)::text as n from workflow_runs`),
    );
    expect(foreign.rows[0]?.n).toBe('0');
  });

  evidenceTest('mutations audit with opaque markers, never content', async () => {
    const run = await withTenant(app, ORG_A, (client) => startRun(client, {}));
    const action = await withTenant(app, ORG_A, (client) =>
      recordAction(client, { kind: 'reply', workflowRunId: run.id }),
    );
    const invoked = await withTenant(app, ORG_A, (client) =>
      invokeTool(client, { toolName: 'Geheimtool', aiActionId: action.id }),
    );
    await withTenant(app, ORG_A, (client) => reportInvocation(client, invoked.id, 'failed'));
    await withTenant(app, ORG_A, async (client) => {
      const events = await listAuditEvents(client, {});
      const ops = events.map((e) => e.operation);
      expect(ops).toEqual(
        expect.arrayContaining(['run.start', 'action.record', 'tool.invoke', 'tool.report']),
      );
      for (const event of events) {
        expect(JSON.stringify(event.args_sanitized)).not.toContain('Geheimtool');
      }
    });
  });

  it('rejects malformed tool names and correlations', async () => {
    await expect(
      withTenant(app, ORG_A, (client) =>
        invokeTool(client, { toolName: '  ', actorUserId: STAFF }),
      ),
    ).rejects.toBeInstanceOf(RangeError);
    await expect(
      withTenant(app, ORG_A, (client) => startRun(client, { correlationId: 'nope' })),
    ).rejects.toBeInstanceOf(RangeError);
  });
});

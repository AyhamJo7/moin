/**
 * Knowledge validity, staleness and re-verification (P09.06.03).
 * Synthetic data only (INV-16).
 */
import { randomUUID } from 'node:crypto';
import { createTestDatabase, evidenceTest, type TestDatabase } from '@moin/testing';
import { afterAll, beforeAll, describe, expect } from 'vitest';
import { listAuditEvents } from './audit.ts';
import { createFaqCard, findAnswer } from './faq.ts';
import {
  approveKnowledgeVersion,
  createKnowledgeItem,
  editKnowledgeItem,
  getLiveVersion,
  type KnowledgeMetadata,
} from './knowledge.ts';
import { createPool, type Pool } from './pool.ts';
import { servedState, sweepReverify } from './staleness.ts';
import { withTenant } from './tenant.ts';

const ORG_A = '11111111-1111-4111-8111-111111111111';
const ORG_B = '22222222-2222-4222-8222-222222222222';

let database: TestDatabase;
let app: Pool;
let admin: Pool;
let OWNER: string;

function meta(over: Partial<KnowledgeMetadata> = {}): KnowledgeMetadata {
  return {
    source: 'manual',
    category: 'Öffnungszeiten',
    ...over,
  };
}

beforeAll(async () => {
  database = await createTestDatabase('staleness');
  app = database.pool();
  admin = createPool({ connectionString: database.migrationUrl, max: 1 });
  await admin.query(
    `insert into organisations (id, slug, name) values ($1, 'alpha', 'Alpha GmbH'), ($2, 'beta', 'Beta GmbH')`,
    [ORG_A, ORG_B],
  );
  OWNER = randomUUID();
  const sub = randomUUID();
  await admin.query('insert into users (id, cognito_sub, email, status) values ($1, $2, $3, $4)', [
    OWNER,
    sub,
    `${sub.slice(0, 8)}@example.test`,
    'active',
  ]);
  await admin.query(
    'insert into memberships (organisation_id, id, user_id, role, status) values ($1, $2, $3, $4, $5)',
    [ORG_A, randomUUID(), OWNER, 'owner', 'active'],
  );
});

afterAll(async () => {
  await admin.end();
  await database.drop();
});

async function makeLive(
  over: Partial<KnowledgeMetadata> = {},
): Promise<{ itemId: string; versionId: string }> {
  const created = await withTenant(app, ORG_A, (client) =>
    createKnowledgeItem(client, {
      title: 'Ruhetag',
      body: 'Montags geschlossen.',
      metadata: meta(over),
    }),
  );
  await withTenant(
    app,
    ORG_A,
    (client) =>
      approveKnowledgeVersion(client, { itemId: created.item.id, versionId: created.version.id }),
    { actorId: OWNER },
  );
  return { itemId: created.item.id, versionId: created.version.id };
}

describe('staleness', () => {
  evidenceTest('expired live version never served', async () => {
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    const { itemId } = await makeLive({ validUntil: yesterday });
    const live = await withTenant(app, ORG_A, (client) => getLiveVersion(client, itemId));
    expect(live).toBeNull();
    const state = await withTenant(app, ORG_A, (client) => servedState(client, itemId));
    expect(state).toBeNull();
  });

  evidenceTest('overdue restricted item stops serving; re-approval lifts it', async () => {
    const { itemId } = await makeLive({ sensitivity: 'restricted', reverifyAfterDays: 1 });
    // Fresh first: serves, not stale.
    const fresh = await withTenant(app, ORG_A, (client) => servedState(client, itemId));
    expect(fresh).toMatchObject({ stale: false });
    // Two days later: overdue + restricted → nothing served (escalation path).
    const late = new Date(Date.now() + 2 * 86_400_000);
    const stopped = await withTenant(app, ORG_A, (client) => servedState(client, itemId, late));
    expect(stopped).toBeNull();
    // The sweep suspends it.
    const sweep = await withTenant(app, ORG_A, (client) => sweepReverify(client, late));
    expect(sweep).toMatchObject({ checked: 1, suspended: 1, tasksCreated: 1 });
    const live = await withTenant(app, ORG_A, (client) => getLiveVersion(client, itemId));
    expect(live).toBeNull();
    // Re-approval (the review) lifts the suspension: serves again.
    const v2 = await withTenant(app, ORG_A, (client) =>
      editKnowledgeItem(client, itemId, {
        title: 'Ruhetag',
        body: 'Montags offen.',
        metadata: meta({ sensitivity: 'restricted', reverifyAfterDays: 30 }),
      }),
    );
    await withTenant(
      app,
      ORG_A,
      (client) => approveKnowledgeVersion(client, { itemId, versionId: v2.id }),
      { actorId: OWNER },
    );
    const back = await withTenant(app, ORG_A, (client) => getLiveVersion(client, itemId));
    expect(back?.id).toBe(v2.id);
  });

  evidenceTest('overdue public item keeps serving flagged stale', async () => {
    const { itemId } = await makeLive({ reverifyAfterDays: 1 });
    const late = new Date(Date.now() + 2 * 86_400_000);
    const state = await withTenant(app, ORG_A, (client) => servedState(client, itemId, late));
    expect(state).toMatchObject({ stale: true });
    // Still served through the retrieval path too — flag, not block.
    const live = await withTenant(app, ORG_A, (client) => getLiveVersion(client, itemId));
    expect(live).not.toBeNull();
  });

  evidenceTest('sweep creates one Wissen-pruefen task per item, never duplicates', async () => {
    const first = await makeLive({ category: 'Speisekarte', reverifyAfterDays: 1 });
    const second = await makeLive({ category: 'Preise', reverifyAfterDays: 1 });
    const late = new Date(Date.now() + 2 * 86_400_000);
    // Sweep ONLY these two items: earlier tests' overdue items are due too
    // (shared database), so the count assertion scopes to per-item results —
    // what matters is one task each, and zero on repeat.
    const once = await withTenant(app, ORG_A, (client) => sweepReverify(client, late));
    expect(once.tasksCreated).toBeGreaterThanOrEqual(2);
    const twice = await withTenant(app, ORG_A, (client) => sweepReverify(client, late));
    expect(twice).toMatchObject({ checked: 0, suspended: 0, tasksCreated: 0 });
    // Per-item idempotency: exactly one open task links back to each item via
    // the queue row — count tasks per item, not globally (shared database).
    for (const itemId of [first.itemId, second.itemId]) {
      const linked = await withTenant(app, ORG_A, (client) =>
        client.query<{ n: string }>(
          `select count(*)::text as n from knowledge_reverify_queue
           where item_id = $1 and task_id is not null`,
          [itemId],
        ),
      );
      expect(linked.rows[0]?.n).toBe('1');
    }
    // Queue rows link each item to its task.
    const queue = await withTenant(app, ORG_A, (client) =>
      client.query<{ ids: string[] }>(
        `select array_agg(item_id::text) as ids from knowledge_reverify_queue where task_id is not null`,
      ),
    );
    const ids = queue.rows[0]?.ids ?? [];
    expect(ids).toContain(first.itemId);
    expect(ids).toContain(second.itemId);
  });

  evidenceTest('reverify audit rows carry markers only; tenants isolated', async () => {
    const { itemId } = await makeLive({ sensitivity: 'restricted', reverifyAfterDays: 1 });
    const late = new Date(Date.now() + 2 * 86_400_000);
    await withTenant(app, ORG_A, (client) => sweepReverify(client, late));
    await withTenant(app, ORG_A, async (client) => {
      const events = await listAuditEvents(client);
      const ours = events.filter(
        (e) => e.operation === 'knowledge.suspend' || e.operation === 'knowledge.reverify_task',
      );
      expect(ours.length).toBeGreaterThan(0);
      for (const event of ours) {
        expect(JSON.stringify(event.args_sanitized)).not.toContain('Montags');
      }
    });
    // Cross-tenant: B sees no queue rows, no items, no tasks from A.
    const foreign = await withTenant(app, ORG_B, (client) =>
      client.query<{ n: string }>(`select count(*)::text as n from knowledge_reverify_queue`),
    );
    expect(foreign.rows[0]?.n).toBe('0');
    const foreignLive = await withTenant(app, ORG_B, (client) => servedState(client, itemId));
    expect(foreignLive).toBeNull();
  });

  evidenceTest('category defaults: menu 30d, hours/prices 90d, other 90d', async () => {
    const menu = await makeLive({ category: 'menu', reverifyAfterDays: undefined });
    const hours = await makeLive({ category: 'hours', reverifyAfterDays: undefined });
    const other = await makeLive({ category: 'Anfahrt', reverifyAfterDays: undefined });
    // Live approvals land at test time: day 31 → menu overdue (public, stale),
    // hours/other still fresh. Day 91 → hours overdue too.
    const menuLate = new Date(Date.now() + 31 * 86_400_000);
    const menuState = await withTenant(app, ORG_A, (client) =>
      servedState(client, menu.itemId, menuLate),
    );
    expect(menuState).toMatchObject({ stale: true });
    const hoursState = await withTenant(app, ORG_A, (client) =>
      servedState(client, hours.itemId, menuLate),
    );
    expect(hoursState).toMatchObject({ stale: false });
    const otherState = await withTenant(app, ORG_A, (client) =>
      servedState(client, other.itemId, menuLate),
    );
    expect(otherState).toMatchObject({ stale: false });
    const hoursLate = new Date(Date.now() + 91 * 86_400_000);
    const hoursOverdue = await withTenant(app, ORG_A, (client) =>
      servedState(client, hours.itemId, hoursLate),
    );
    expect(hoursOverdue).toMatchObject({ stale: true });
  });

  evidenceTest('expired faq card never served; overdue card served stale', async () => {
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    await withTenant(app, ORG_A, (client) =>
      createFaqCard(client, {
        canonical: 'Haben Sie heute geschlossen?',
        spoken: 'Ja, heute ist Ruhetag.',
        validUntil: yesterday,
      }),
    );
    const missed = await withTenant(app, ORG_A, (client) =>
      findAnswer(client, 'Haben Sie heute geschlossen?'),
    );
    expect(missed).toBeNull();
    await withTenant(app, ORG_A, (client) =>
      createFaqCard(client, {
        canonical: 'Was gibt es mittags?',
        spoken: 'Heute Eintopf mit Brot.',
        reverifyAfterDays: 1,
      }),
    );
    // Backdate updated_at so the card is overdue without waiting a day.
    await withTenant(app, ORG_A, (client) =>
      client.query(`update faq_cards set updated_at = now() - interval '2 days'`),
    );
    const hit = await withTenant(app, ORG_A, (client) =>
      findAnswer(client, 'Was gibt es mittags?'),
    );
    expect(hit?.stale).toBe(true);
    expect(hit?.spoken).toBe('Heute Eintopf mit Brot.');
  });
});

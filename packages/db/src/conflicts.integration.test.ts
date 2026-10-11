/**
 * Knowledge conflict detection (P09.07.04).
 * Synthetic data only (INV-16).
 */
import { randomUUID } from 'node:crypto';
import { createTestDatabase, evidenceTest, type TestDatabase } from '@moin/testing';
import { afterAll, beforeAll, describe, expect } from 'vitest';
import { listAuditEvents } from './audit.ts';
import {
  CONFLICT_TASK_TITLE,
  detectFaqDuplicates,
  detectHoursOverlaps,
  openConflict,
  orderLegs,
  resolveConflict,
} from './conflicts.ts';
import { createFaqCard } from './faq.ts';
import { approveKnowledgeVersion, createKnowledgeItem, getLiveVersion } from './knowledge.ts';
import { createPool, type Pool } from './pool.ts';
import { listOpenTasks } from './tasks.ts';
import { withTenant } from './tenant.ts';

const ORG_A = '11111111-1111-4111-8111-111111111111';
const ORG_B = '22222222-2222-4222-8222-222222222222';
const LOC_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

let database: TestDatabase;
let app: Pool;
let admin: Pool;
let OWNER: string;

beforeAll(async () => {
  database = await createTestDatabase('conflicts');
  app = database.pool();
  admin = createPool({ connectionString: database.migrationUrl, max: 1 });
  await admin.query(
    `insert into organisations (id, slug, name) values ($1, 'alpha', 'Alpha GmbH'), ($2, 'beta', 'Beta GmbH')`,
    [ORG_A, ORG_B],
  );
  await admin.query(`insert into locations (organisation_id, id, name) values ($1, $2, 'Mitte')`, [
    ORG_A,
    LOC_A,
  ]);
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

describe('conflicts', () => {
  evidenceTest('overlapping weekly rules raise one conflict + one task', async () => {
    await withTenant(app, ORG_A, (client) =>
      client.query(`delete from opening_rules where location_id = $1`, [LOC_A]),
    );
    await admin.query(
      `insert into opening_rules (organisation_id, id, location_id, weekday, opens_min, closes_min)
       values ($1, $2, $3, 1, 540, 720), ($1, $4, $3, 1, 660, 900)`,
      [ORG_A, randomUUID(), LOC_A, randomUUID()],
    );
    const first = await withTenant(app, ORG_A, (client) => detectHoursOverlaps(client));
    expect(first.opened).toBe(1);
    expect(first.tasksCreated).toBe(1);
    // Repeat detection: same pair, no duplicate row, no duplicate task.
    const second = await withTenant(app, ORG_A, (client) => detectHoursOverlaps(client));
    expect(second.opened).toBe(0);
    expect(second.tasksCreated).toBe(0);
    const rows = await withTenant(app, ORG_A, (client) =>
      client.query<{ n: string }>(
        `select count(*)::text as n from knowledge_conflicts where detector = 'hours-overlap' and status = 'open'`,
      ),
    );
    expect(rows.rows[0]?.n).toBe('1');
    const tasks = await withTenant(app, ORG_A, (client) => listOpenTasks(client, 50));
    expect(tasks.filter((t) => t.title === CONFLICT_TASK_TITLE)).toHaveLength(1);
  });

  evidenceTest('mirror pairs share one row (leg ordering)', async () => {
    const x = randomUUID();
    const y = randomUUID();
    const [a, b] = orderLegs(x, y);
    expect([a, b]).toStrictEqual([x, y].sort());
    await withTenant(app, ORG_A, (client) =>
      openConflict(client, {
        detector: 'item-contradiction',
        subjectKind: 'knowledge-item',
        subjectA: x,
        subjectB: y,
        reason: 'review probe one',
      }),
    );
    await withTenant(app, ORG_A, (client) =>
      openConflict(client, {
        detector: 'item-contradiction',
        subjectKind: 'knowledge-item',
        subjectA: y,
        subjectB: x,
        reason: 'review probe two',
      }),
    );
    const rows = await withTenant(app, ORG_A, (client) =>
      client.query<{ n: string }>(
        `select count(*)::text as n from knowledge_conflicts
         where detector = 'item-contradiction' and status = 'open'`,
      ),
    );
    expect(rows.rows[0]?.n).toBe('1');
  });

  evidenceTest('near-duplicate faq canonicals become merge candidates, never merges', async () => {
    const first = await withTenant(app, ORG_A, (client) =>
      createFaqCard(client, {
        canonical: 'Haben Sie heute Abend geoeffnet?',
        spoken: 'Ja, bis zweiundzwanzig Uhr.',
        reverifyAfterDays: null,
      }),
    );
    const second = await withTenant(app, ORG_A, (client) =>
      createFaqCard(client, {
        canonical: 'Haben Sie heute Abend geoeffnet?',
        spoken: 'Ja, bis dreiundzwanzig Uhr.',
        reverifyAfterDays: null,
      }),
    );
    const sweep = await withTenant(app, ORG_A, (client) => detectFaqDuplicates(client));
    expect(sweep.opened).toBeGreaterThanOrEqual(1);
    // Both cards still exist — flag-for-review only, never a merge. (findAnswer
    // is staleness-scoped and may return null on shared-DB timing; the merge
    // absence is what this pins: two live rows, no deletion.)
    const rows = await withTenant(app, ORG_A, (client) =>
      client.query<{ n: string }>(
        `select count(*)::text as n from faq_cards where id = any ($1::uuid[])`,
        [[first.id, second.id]],
      ),
    );
    expect(rows.rows[0]?.n).toBe('2');
    const again = await withTenant(app, ORG_A, (client) => detectFaqDuplicates(client));
    expect(again.tasksCreated).toBe(0);
  });

  evidenceTest('conflicted approved items stop serving; resolution restores', async () => {
    const first = await withTenant(app, ORG_A, (client) =>
      createKnowledgeItem(client, {
        title: 'Preise',
        body: 'Schnitzel zwolf Euro.',
        // No reverify deadline: the conflict (not staleness) is the subject.
        metadata: { source: 'manual', category: 'Preise', reverifyAfterDays: null },
      }),
    );
    const second = await withTenant(app, ORG_A, (client) =>
      createKnowledgeItem(client, {
        title: 'Preise',
        body: 'Schnitzel dreizehn Euro.',
        metadata: { source: 'manual', category: 'Preise', reverifyAfterDays: null },
      }),
    );
    // Approve both through the real door (conflict is the subject here;
    // the approval path itself is proven in P09.05).
    for (const created of [first, second]) {
      await withTenant(
        app,
        ORG_A,
        (client) =>
          approveKnowledgeVersion(client, {
            itemId: created.item.id,
            versionId: created.version.id,
          }),
        { actorId: OWNER },
      );
    }
    const liveBefore = await withTenant(app, ORG_A, (client) =>
      getLiveVersion(client, first.item.id),
    );
    expect(liveBefore).not.toBeNull();
    await withTenant(app, ORG_A, (client) =>
      openConflict(client, {
        detector: 'item-contradiction',
        subjectKind: 'knowledge-item',
        subjectA: first.item.id,
        subjectB: second.item.id,
        reason: 'contradictory prices',
      }),
    );
    // Both suspended from serving → callback path.
    const hidden = await withTenant(app, ORG_A, (client) => getLiveVersion(client, first.item.id));
    expect(hidden).toBeNull();
    // Resolve THIS pair (scoped by legs — the shared DB holds other open
    // rows from earlier tests; limit 1 could grab a stranger).
    const conflicts = await withTenant(app, ORG_A, (client) =>
      client.query<{ id: string }>(
        `select id::text from knowledge_conflicts where status = 'open'
         and subject_a = $1::uuid and subject_b = $2::uuid limit 1`,
        orderLegs(first.item.id, second.item.id),
      ),
    );
    const conflictId = conflicts.rows[0]?.id ?? '';
    expect(conflictId).toBeTruthy();
    const resolved = await withTenant(app, ORG_A, (client) =>
      resolveConflict(client, { conflictId, note: 'Owner kept first card.' }),
    );
    expect(resolved).toBe(true);
    const back = await withTenant(app, ORG_A, (client) => getLiveVersion(client, first.item.id));
    expect(back).not.toBeNull();
  });

  evidenceTest('resolution keeps suspension while another conflict stays open', async () => {
    // Two overlapping pairs sharing one item: resolving the first must NOT
    // clear the shared item while the second stays open. Uses faq cards
    // (suspend = active=false, observable without item fixtures).
    const cards = [];
    for (const canonical of [
      'Wann beginnt der Sonntagsbrunch im Detail?',
      'Wann startet der Mittagstisch genau?',
      'Wann oeffnet der Biergarten morgens?',
    ]) {
      const card = await withTenant(app, ORG_A, (client) =>
        createFaqCard(client, { canonical, spoken: 'Antwort zum Test.' }),
      );
      cards.push(card.id);
    }
    const [a, b, c] = cards as [string, string, string];
    await withTenant(app, ORG_A, (client) =>
      openConflict(client, {
        detector: 'faq-duplicate',
        subjectKind: 'faq-card',
        subjectA: a,
        subjectB: b,
        reason: 'pair one',
      }),
    );
    await withTenant(app, ORG_A, (client) =>
      openConflict(client, {
        detector: 'faq-duplicate',
        subjectKind: 'faq-card',
        subjectA: b,
        subjectB: c,
        reason: 'pair two',
      }),
    );
    // Shared card b deactivated by the suspension.
    const off = await withTenant(app, ORG_A, (client) =>
      client.query<{ active: boolean }>(`select active from faq_cards where id = $1`, [b]),
    );
    expect(off.rows[0]?.active).toBe(false);
    // Resolve pair one: b stays off (still contradicted by pair two).
    const first = await withTenant(app, ORG_A, (client) =>
      client.query<{ id: string }>(
        `select id::text from knowledge_conflicts
         where status = 'open' and reason = 'pair one' limit 1`,
      ),
    );
    const resolved = await withTenant(app, ORG_A, (client) =>
      resolveConflict(client, { conflictId: first.rows[0]?.id ?? '', note: 'Pair one reviewed.' }),
    );
    expect(resolved).toBe(true);
    const still = await withTenant(app, ORG_A, (client) =>
      client.query<{ active: boolean }>(`select active from faq_cards where id = $1`, [b]),
    );
    expect(still.rows[0]?.active).toBe(false);
    // Resolve pair two (scoped by legs — shared DB holds other open rows):
    // b reactivates (no open conflict left).
    const second = await withTenant(app, ORG_A, (client) =>
      client.query<{ id: string }>(
        `select id::text from knowledge_conflicts where status = 'open'
         and subject_kind = 'faq-card' and
         ((subject_a = $1::uuid and subject_b = $2::uuid)
           or (subject_a = $2::uuid and subject_b = $1::uuid)) limit 1`,
        orderLegs(b, c),
      ),
    );
    await withTenant(app, ORG_A, (client) =>
      resolveConflict(client, { conflictId: second.rows[0]?.id ?? '', note: 'Pair two reviewed.' }),
    );
    const back = await withTenant(app, ORG_A, (client) =>
      client.query<{ active: boolean }>(`select active from faq_cards where id = $1`, [b]),
    );
    expect(back.rows[0]?.active).toBe(true);
  });

  evidenceTest('resolved then redetected reopens with a fresh open task', async () => {
    // ROUND-1 P1: resolved + redetected is a NEW CYCLE — the row reopens
    // (status open, resolution cleared), subjects suspend again, and the
    // owner gets a FRESH open task (not the DONE one from cycle one).
    const x = await withTenant(app, ORG_A, (client) =>
      createFaqCard(client, {
        canonical: 'Gibt es sonntags Brunch?',
        spoken: 'Ja, von zehn bis vierzehn Uhr.',
      }),
    );
    const y = await withTenant(app, ORG_A, (client) =>
      createFaqCard(client, {
        canonical: 'Gibt es sonntags Fruehstueck?',
        spoken: 'Ja, von neun bis dreizehn Uhr.',
      }),
    );
    const first = await withTenant(app, ORG_A, (client) =>
      openConflict(client, {
        detector: 'faq-duplicate',
        subjectKind: 'faq-card',
        subjectA: x.id,
        subjectB: y.id,
        reason: 'cycle one',
      }),
    );
    expect(first).toMatchObject({ opened: true, tasked: true });
    const row = await withTenant(app, ORG_A, (client) =>
      client.query<{ id: string; task_id: string }>(
        `select id::text, task_id::text from knowledge_conflicts
         where status = 'open' and reason = 'cycle one' limit 1`,
      ),
    );
    const conflictId = row.rows[0]?.id ?? '';
    const firstTaskId = row.rows[0]?.task_id ?? '';
    expect(conflictId).toBeTruthy();
    expect(firstTaskId).toBeTruthy();
    // Owner resolves; cycle-one task completes.
    await withTenant(app, ORG_A, (client) =>
      resolveConflict(client, { conflictId, note: 'Reviewed, kept both.' }),
    );
    await withTenant(app, ORG_A, (client) =>
      client.query(`update tasks set status = 'done' where id = $1::uuid`, [firstTaskId]),
    );
    // Contradiction persists → redetection reopens: row OPEN again,
    // resolution cleared, subjects suspended, FRESH open task.
    const second = await withTenant(app, ORG_A, (client) =>
      openConflict(client, {
        detector: 'faq-duplicate',
        subjectKind: 'faq-card',
        subjectA: x.id,
        subjectB: y.id,
        reason: 'cycle two',
      }),
    );
    expect(second).toMatchObject({ opened: true, tasked: true });
    const reopened = await withTenant(app, ORG_A, (client) =>
      client.query<{ status: string; note: string | null; task_id: string }>(
        `select status, resolution_note as note, task_id::text from knowledge_conflicts
         where id = $1::uuid`,
        [conflictId],
      ),
    );
    expect(reopened.rows[0]?.status).toBe('open');
    expect(reopened.rows[0]?.note).toBeNull();
    const secondTaskId = reopened.rows[0]?.task_id ?? '';
    expect(secondTaskId).toBeTruthy();
    expect(secondTaskId).not.toBe(firstTaskId);
    const taskState = await withTenant(app, ORG_A, (client) =>
      client.query<{ status: string }>(`select status from tasks where id = $1::uuid`, [
        secondTaskId,
      ]),
    );
    expect(taskState.rows[0]?.status).toBe('open');
    const suspended = await withTenant(app, ORG_A, (client) =>
      client.query<{ n: string }>(
        `select count(*)::text as n from faq_cards where id = any ($1::uuid[]) and active = false`,
        [[x.id, y.id]],
      ),
    );
    expect(suspended.rows[0]?.n).toBe('2');
  });

  evidenceTest('conflict audit rows carry markers only; tenants isolated', async () => {
    await withTenant(app, ORG_A, (client) =>
      openConflict(client, {
        detector: 'item-contradiction',
        subjectKind: 'knowledge-item',
        subjectA: randomUUID(),
        subjectB: randomUUID(),
        reason: 'Geheime Zutat X widerspricht Y',
      }),
    );
    await withTenant(app, ORG_A, async (client) => {
      const events = await listAuditEvents(client);
      const ours = events.filter(
        (e) =>
          e.operation === 'knowledge.conflict_open' || e.operation === 'knowledge.conflict_resolve',
      );
      expect(ours.length).toBeGreaterThan(0);
      for (const event of ours) {
        expect(JSON.stringify(event.args_sanitized)).not.toContain('Zutat');
      }
    });
    const foreign = await withTenant(app, ORG_B, (client) =>
      client.query<{ n: string }>(`select count(*)::text as n from knowledge_conflicts`),
    );
    expect(foreign.rows[0]?.n).toBe('0');
  });
});

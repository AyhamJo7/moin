/**
 * Approval workflow + audit (P09.05.03): owner/admin gate, content binding,
 * stale-draft rejection, per-item bulk results, marker-only audit.
 * Synthetic data only (INV-16).
 */
import { randomUUID } from 'node:crypto';
import { createTestDatabase, evidenceTest, type TestDatabase } from '@moin/testing';
import { afterAll, beforeAll, describe, expect } from 'vitest';
import { approveFaqCard, bulkApprove, ForbiddenError } from './approval.ts';
import { listAuditEvents } from './audit.ts';
import {
  createKnowledgeItem,
  editKnowledgeItem,
  getLiveVersion,
  VersionConflictError as KnowledgeConflict,
} from './knowledge.ts';
import { createPool, type Pool } from './pool.ts';
import { withTenant } from './tenant.ts';

const ORG_A = '11111111-1111-4111-8111-111111111111';
const ORG_B = '22222222-2222-4222-8222-222222222222';

const META = {
  source: 'manual' as const,
  category: 'Öffnungszeiten',
};

let database: TestDatabase;
let app: Pool;
let admin: Pool;

let OWNER: string;
let ADMIN: string;
let STAFF: string;

async function seedUser(org: string, role: 'owner' | 'admin' | 'staff'): Promise<string> {
  const userId = randomUUID();
  const sub = randomUUID();
  await admin.query('insert into users (id, cognito_sub, email, status) values ($1, $2, $3, $4)', [
    userId,
    sub,
    `${sub.slice(0, 8)}@example.test`,
    'active',
  ]);
  await admin.query(
    'insert into memberships (organisation_id, id, user_id, role, status) values ($1, $2, $3, $4, $5)',
    [org, randomUUID(), userId, role, 'active'],
  );
  return userId;
}

beforeAll(async () => {
  database = await createTestDatabase('approval');
  app = database.pool();
  admin = createPool({ connectionString: database.migrationUrl, max: 1 });
  await admin.query(
    `insert into organisations (id, slug, name) values ($1, 'alpha', 'Alpha GmbH'), ($2, 'beta', 'Beta GmbH')`,
    [ORG_A, ORG_B],
  );
  OWNER = await seedUser(ORG_A, 'owner');
  ADMIN = await seedUser(ORG_A, 'admin');
  STAFF = await seedUser(ORG_A, 'staff');
});

afterAll(async () => {
  await admin.end();
  await database.drop();
});

async function makeDraft(
  body = 'Montags geschlossen.',
): Promise<{ itemId: string; versionId: string }> {
  const created = await withTenant(app, ORG_A, (client) =>
    createKnowledgeItem(client, { title: 'Ruhetag', body, metadata: META }),
  );
  return { itemId: created.item.id, versionId: created.version.id };
}

describe('approval', () => {
  evidenceTest('owner and admin approve; version hash and role stamped', async () => {
    const draft = await makeDraft();
    await withTenant(app, ORG_A, (client) =>
      approveFaqCard(client, {
        itemId: draft.itemId,
        versionId: draft.versionId,
        approvedBy: OWNER,
      }),
    );
    const live = await withTenant(app, ORG_A, (client) => getLiveVersion(client, draft.itemId));
    expect(live?.id).toBe(draft.versionId);
    const row = await withTenant(app, ORG_A, (client) =>
      client.query<{ role: string | null; hash: string | null; decided: string | null }>(
        `select approver_role as role, version_hash as hash, decided_at::text as decided
         from knowledge_approvals where item_id = $1`,
        [draft.itemId],
      ),
    );
    expect(row.rows[0]?.role).toBe('owner');
    expect(row.rows[0]?.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.rows[0]?.decided).toBeTruthy();
    const second = await makeDraft('Dienstags geschlossen.');
    await withTenant(app, ORG_A, (client) =>
      approveFaqCard(client, {
        itemId: second.itemId,
        versionId: second.versionId,
        approvedBy: ADMIN,
      }),
    );
    const adminRow = await withTenant(app, ORG_A, (client) =>
      client.query<{ role: string | null }>(
        `select approver_role as role from knowledge_approvals where item_id = $1`,
        [second.itemId],
      ),
    );
    expect(adminRow.rows[0]?.role).toBe('admin');
  });

  evidenceTest('staff cannot approve: 403, nothing published, nothing ledgered', async () => {
    const draft = await makeDraft();
    await expect(
      withTenant(app, ORG_A, (client) =>
        approveFaqCard(client, {
          itemId: draft.itemId,
          versionId: draft.versionId,
          approvedBy: STAFF,
        }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
    const live = await withTenant(app, ORG_A, (client) => getLiveVersion(client, draft.itemId));
    expect(live).toBeNull();
    const ledger = await withTenant(app, ORG_A, (client) =>
      client.query<{ n: string }>(
        `select count(*)::text as n from knowledge_approvals where item_id = $1`,
        [draft.itemId],
      ),
    );
    expect(ledger.rows[0]?.n).toBe('0');
  });

  evidenceTest('stale draft rejected when a newer version exists', async () => {
    const created = await withTenant(app, ORG_A, (client) =>
      createKnowledgeItem(client, { title: 'Karte', body: 'Eins.', metadata: META }),
    );
    const v2 = await withTenant(app, ORG_A, (client) =>
      editKnowledgeItem(client, created.item.id, { title: 'Karte', body: 'Zwei.', metadata: META }),
    );
    const v3 = await withTenant(app, ORG_A, (client) =>
      editKnowledgeItem(client, created.item.id, { title: 'Karte', body: 'Drei.', metadata: META }),
    );
    await expect(
      withTenant(app, ORG_A, (client) =>
        approveFaqCard(client, { itemId: created.item.id, versionId: v2.id, approvedBy: OWNER }),
      ),
    ).rejects.toBeInstanceOf(KnowledgeConflict);
    await withTenant(app, ORG_A, (client) =>
      approveFaqCard(client, { itemId: created.item.id, versionId: v3.id, approvedBy: OWNER }),
    );
    const live = await withTenant(app, ORG_A, (client) => getLiveVersion(client, created.item.id));
    expect(live?.id).toBe(v3.id);
  });

  evidenceTest('bulk approval confirms per item; failures never abort', async () => {
    const good = await makeDraft('Gut.');
    const staleBase = await withTenant(app, ORG_A, (client) =>
      createKnowledgeItem(client, { title: 'Alt', body: 'Alt eins.', metadata: META }),
    );
    const staleV2 = await withTenant(app, ORG_A, (client) =>
      editKnowledgeItem(client, staleBase.item.id, {
        title: 'Alt',
        body: 'Alt zwei.',
        metadata: META,
      }),
    );
    await withTenant(app, ORG_A, (client) =>
      editKnowledgeItem(client, staleBase.item.id, {
        title: 'Alt',
        body: 'Alt drei.',
        metadata: META,
      }),
    );
    const result = await withTenant(app, ORG_A, (client) =>
      bulkApprove(client, {
        items: [
          { itemId: good.itemId, versionId: good.versionId, approvedBy: OWNER },
          { itemId: staleBase.item.id, versionId: staleV2.id, approvedBy: OWNER },
        ],
      }),
    );
    expect(result.results).toHaveLength(2);
    expect(result.results[0]).toMatchObject({ approved: true, reason: null });
    expect(result.results[1]).toMatchObject({ approved: false, reason: 'conflict' });
    // The good item went live despite its neighbour failing.
    const live = await withTenant(app, ORG_A, (client) => getLiveVersion(client, good.itemId));
    expect(live?.id).toBe(good.versionId);
    // Staff bulk attempt: forbidden per item, nothing published.
    const staffRun = await withTenant(app, ORG_A, (client) =>
      bulkApprove(client, {
        items: [{ itemId: good.itemId, versionId: good.versionId, approvedBy: STAFF }],
      }),
    );
    expect(staffRun.results[0]).toMatchObject({ approved: false, reason: 'forbidden' });
  });

  evidenceTest('every approval audited with markers only; tenants isolated', async () => {
    const draft = await makeDraft('Geheime Zutat X.');
    await withTenant(app, ORG_A, (client) =>
      approveFaqCard(client, {
        itemId: draft.itemId,
        versionId: draft.versionId,
        approvedBy: OWNER,
      }),
    );
    await withTenant(app, ORG_A, async (client) => {
      const events = await listAuditEvents(client);
      const approvals = events.filter(
        (e) => e.operation === 'knowledge.approve' || e.operation === 'knowledge.bulk_approve',
      );
      expect(approvals.length).toBeGreaterThan(0);
      for (const event of approvals) {
        expect(JSON.stringify(event.args_sanitized)).not.toContain('Zutat');
      }
    });
    // Cross-tenant: B has no memberships for these users; approval dies in the fn.
    await expect(
      withTenant(app, ORG_B, (client) =>
        approveFaqCard(client, {
          itemId: draft.itemId,
          versionId: draft.versionId,
          approvedBy: OWNER,
        }),
      ),
    ).rejects.toThrow();
  });
});

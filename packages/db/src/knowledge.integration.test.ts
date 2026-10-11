/**
 * Knowledge model, lifecycle and versions (P09.01.04): state machine, old-version
 * served during draft, retired never served, tenant isolation. Synthetic data (INV-16).
 */
import { createTestDatabase, evidenceTest, type TestDatabase } from '@moin/testing';
import { afterAll, beforeAll, describe, expect } from 'vitest';
import { listAuditEvents } from './audit.ts';
import {
  approveKnowledgeVersion,
  createKnowledgeItem,
  editKnowledgeItem,
  getLiveVersion,
  retireKnowledgeItem,
  VersionConflictError as KnowledgeConflict,
} from './knowledge.ts';
import { createPool, type Pool } from './pool.ts';
import { withTenant } from './tenant.ts';

const ORG_A = '11111111-1111-4111-8111-111111111111';
const ORG_B = '22222222-2222-4222-8222-222222222222';
const STAFF = '33333333-3333-4333-8333-333333333333';

const META = {
  source: 'manual' as const,
  category: 'Öffnungszeiten',
};

let database: TestDatabase;
let app: Pool;
let admin: Pool;

beforeAll(async () => {
  database = await createTestDatabase('knowledge');
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

describe('knowledge', () => {
  evidenceTest('create is draft and serves nothing until approval', async () => {
    const created = await withTenant(app, ORG_A, (client) =>
      createKnowledgeItem(client, {
        title: 'Ruhetag',
        body: 'Montags geschlossen.',
        metadata: META,
      }),
    );
    expect(created.item.state).toBe('draft');
    expect(created.item.liveVersionId).toBeNull();
    expect(created.version.versionNo).toBe(1);
    // Draft serves nothing — no live pointer, no approved row.
    const live = await withTenant(app, ORG_A, (client) => getLiveVersion(client, created.item.id));
    expect(live).toBeNull();
  });

  evidenceTest('approve goes live; edit-after-approval keeps serving the old version', async () => {
    const created = await withTenant(app, ORG_A, (client) =>
      createKnowledgeItem(client, {
        title: 'Ruhetag',
        body: 'Montags geschlossen.',
        metadata: META,
      }),
    );
    const approved = await withTenant(app, ORG_A, (client) =>
      approveKnowledgeVersion(client, {
        itemId: created.item.id,
        versionId: created.version.id,
        approvedBy: STAFF,
      }),
    );
    expect(approved.state).toBe('approved');
    expect(approved.liveVersionId).toBe(created.version.id);
    const live = await withTenant(app, ORG_A, (client) => getLiveVersion(client, created.item.id));
    expect(live?.body).toBe('Montags geschlossen.');
    // Edit inserts draft v2; the approved v1 stays live.
    const draft = await withTenant(app, ORG_A, (client) =>
      editKnowledgeItem(client, created.item.id, {
        title: 'Ruhetag',
        body: 'Dienstags geschlossen.',
        metadata: META,
      }),
    );
    expect(draft.versionNo).toBe(2);
    expect(draft.state).toBe('draft');
    const stillLive = await withTenant(app, ORG_A, (client) =>
      getLiveVersion(client, created.item.id),
    );
    expect(stillLive?.id).toBe(created.version.id);
    expect(stillLive?.body).toBe('Montags geschlossen.');
    // Approving v2 flips the pointer atomically.
    await withTenant(app, ORG_A, (client) =>
      approveKnowledgeVersion(client, {
        itemId: created.item.id,
        versionId: draft.id,
        approvedBy: STAFF,
      }),
    );
    const flipped = await withTenant(app, ORG_A, (client) =>
      getLiveVersion(client, created.item.id),
    );
    expect(flipped?.id).toBe(draft.id);
    expect(flipped?.body).toBe('Dienstags geschlossen.');
  });

  evidenceTest(
    'illegal transitions 409: double approve, foreign version, retire twice',
    async () => {
      const created = await withTenant(app, ORG_A, (client) =>
        createKnowledgeItem(client, {
          title: 'Parkplätze',
          body: 'Hinter dem Haus.',
          metadata: META,
        }),
      );
      await withTenant(app, ORG_A, (client) =>
        approveKnowledgeVersion(client, {
          itemId: created.item.id,
          versionId: created.version.id,
          approvedBy: STAFF,
        }),
      );
      // Same version twice: already approved, no draft to flip.
      await expect(
        withTenant(app, ORG_A, (client) =>
          approveKnowledgeVersion(client, {
            itemId: created.item.id,
            versionId: created.version.id,
            approvedBy: STAFF,
          }),
        ),
      ).rejects.toBeInstanceOf(KnowledgeConflict);
      // Another item's version: wrong pair, never cross-approved.
      const other = await withTenant(app, ORG_A, (client) =>
        createKnowledgeItem(client, {
          title: 'Anfahrt',
          body: 'Neben der Kirche.',
          metadata: META,
        }),
      );
      await expect(
        withTenant(app, ORG_A, (client) =>
          approveKnowledgeVersion(client, {
            itemId: created.item.id,
            versionId: other.version.id,
            approvedBy: STAFF,
          }),
        ),
      ).rejects.toBeInstanceOf(KnowledgeConflict);
      // Retire, then retire again: terminal, second 409s.
      await withTenant(app, ORG_A, (client) => retireKnowledgeItem(client, created.item.id));
      await expect(
        withTenant(app, ORG_A, (client) => retireKnowledgeItem(client, created.item.id)),
      ).rejects.toBeInstanceOf(KnowledgeConflict);
      // Retired serves nothing; editing a retired item is refused.
      const gone = await withTenant(app, ORG_A, (client) =>
        getLiveVersion(client, created.item.id),
      );
      expect(gone).toBeNull();
      await expect(
        withTenant(app, ORG_A, (client) =>
          editKnowledgeItem(client, created.item.id, {
            title: 'Parkplätze',
            body: 'Vorm Haus.',
            metadata: META,
          }),
        ),
      ).rejects.toBeInstanceOf(KnowledgeConflict);
    },
  );

  evidenceTest('concurrent approves serialise: one flips, the other 409s', async () => {
    const created = await withTenant(app, ORG_A, (client) =>
      createKnowledgeItem(client, {
        title: 'Stornierung',
        body: 'Bis 24h vorher kostenfrei.',
        metadata: META,
      }),
    );
    const outcomes = await Promise.allSettled([
      withTenant(app, ORG_A, (client) =>
        approveKnowledgeVersion(client, {
          itemId: created.item.id,
          versionId: created.version.id,
          approvedBy: STAFF,
        }),
      ),
      withTenant(app, ORG_A, (client) =>
        approveKnowledgeVersion(client, {
          itemId: created.item.id,
          versionId: created.version.id,
          approvedBy: STAFF,
        }),
      ),
    ]);
    const won = outcomes.filter((r) => r.status === 'fulfilled');
    const lost = outcomes.filter((r) => r.status === 'rejected');
    expect(won).toHaveLength(1);
    expect(lost).toHaveLength(1);
    if (lost[0]?.status === 'rejected') {
      expect(lost[0].reason).toBeInstanceOf(KnowledgeConflict);
    } else {
      throw new Error('expected exactly one rejected approve');
    }
  });

  evidenceTest('audit carries markers only, never bodies; tenants isolated', async () => {
    const created = await withTenant(app, ORG_A, (client) =>
      createKnowledgeItem(client, {
        title: 'Geheimrezept',
        body: 'Streng geheime Zutat X.',
        metadata: META,
      }),
    );
    await withTenant(app, ORG_A, (client) =>
      approveKnowledgeVersion(client, {
        itemId: created.item.id,
        versionId: created.version.id,
        approvedBy: STAFF,
      }),
    );
    await withTenant(app, ORG_A, async (client) => {
      const events = await listAuditEvents(client);
      const knowledge = events.filter((e) => e.operation.startsWith('knowledge.'));
      expect(knowledge.length).toBeGreaterThan(0);
      for (const event of knowledge) {
        expect(JSON.stringify(event.args_sanitized)).not.toContain('Zutat');
        expect(JSON.stringify(event.args_sanitized)).not.toContain('Geheimrezept');
      }
    });
    // Cross-tenant: B sees no items, no versions, no approvals; serving A's id is null.
    const foreign = await withTenant(app, ORG_B, (client) =>
      client.query<{ n: string }>(`select count(*)::text as n from knowledge_items`),
    );
    expect(foreign.rows[0]?.n).toBe('0');
    const foreignVersions = await withTenant(app, ORG_B, (client) =>
      client.query<{ n: string }>(`select count(*)::text as n from knowledge_versions`),
    );
    expect(foreignVersions.rows[0]?.n).toBe('0');
    const served = await withTenant(app, ORG_B, (client) =>
      getLiveVersion(client, created.item.id),
    );
    expect(served).toBeNull();
    // Malformed metadata rejected, never stored.
    await expect(
      withTenant(app, ORG_A, (client) =>
        createKnowledgeItem(client, {
          title: 'Falsch',
          body: 'Falscher Kanal.',
          metadata: { ...META, allowedChannels: ['fax'] },
        }),
      ),
    ).rejects.toBeInstanceOf(RangeError);
    await expect(
      withTenant(app, ORG_A, (client) =>
        createKnowledgeItem(client, {
          title: 'Falsch',
          body: 'Falsches Datum.',
          metadata: { ...META, validFrom: '2026-12-31', validUntil: '2026-01-01' },
        }),
      ),
    ).rejects.toBeInstanceOf(RangeError);
  });
});

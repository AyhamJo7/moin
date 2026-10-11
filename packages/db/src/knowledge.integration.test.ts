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
  // P09.05 role gate: the DEFINER resolves membership role — STAFF approves here, so
  // STAFF is an admin member (role coverage lives in approval.integration.test.ts).
  const sub = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  await admin.query('insert into users (id, cognito_sub, email, status) values ($1, $2, $3, $4)', [
    STAFF,
    sub,
    'staff@example.test',
    'active',
  ]);
  await admin.query(
    'insert into memberships (organisation_id, id, user_id, role, status) values ($1, gen_random_uuid(), $2, $3, $4)',
    [ORG_A, STAFF, 'admin', 'active'],
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
    const approved = await withTenant(
      app,
      ORG_A,
      (client) =>
        approveKnowledgeVersion(client, {
          itemId: created.item.id,
          versionId: created.version.id,
        }),
      { actorId: STAFF },
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
    await withTenant(
      app,
      ORG_A,
      (client) =>
        approveKnowledgeVersion(client, {
          itemId: created.item.id,
          versionId: draft.id,
        }),
      { actorId: STAFF },
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
      await withTenant(
        app,
        ORG_A,
        (client) =>
          approveKnowledgeVersion(client, {
            itemId: created.item.id,
            versionId: created.version.id,
          }),
        { actorId: STAFF },
      );
      // Same version twice: already approved, no draft to flip.
      await expect(
        withTenant(
          app,
          ORG_A,
          (client) =>
            approveKnowledgeVersion(client, {
              itemId: created.item.id,
              versionId: created.version.id,
            }),
          { actorId: STAFF },
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
        withTenant(
          app,
          ORG_A,
          (client) =>
            approveKnowledgeVersion(client, {
              itemId: created.item.id,
              versionId: other.version.id,
            }),
          { actorId: STAFF },
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

  evidenceTest('stale draft never goes live: approve v2 with v3 pending 409s', async () => {
    const created = await withTenant(app, ORG_A, (client) =>
      createKnowledgeItem(client, {
        title: 'Speisekarte',
        body: 'Schnitzel 12,90.',
        metadata: META,
      }),
    );
    await withTenant(
      app,
      ORG_A,
      (client) =>
        approveKnowledgeVersion(client, {
          itemId: created.item.id,
          versionId: created.version.id,
        }),
      { actorId: STAFF },
    );
    const v2 = await withTenant(app, ORG_A, (client) =>
      editKnowledgeItem(client, created.item.id, {
        title: 'Speisekarte',
        body: 'Schnitzel 13,90.',
        metadata: META,
      }),
    );
    const v3 = await withTenant(app, ORG_A, (client) =>
      editKnowledgeItem(client, created.item.id, {
        title: 'Speisekarte',
        body: 'Schnitzel 14,90.',
        metadata: META,
      }),
    );
    expect(v2.versionNo).toBe(2);
    expect(v3.versionNo).toBe(3);
    // v2 is stale the moment v3 exists: approving it 409s, the live v1 keeps serving.
    await expect(
      withTenant(
        app,
        ORG_A,
        (client) =>
          approveKnowledgeVersion(client, {
            itemId: created.item.id,
            versionId: v2.id,
          }),
        { actorId: STAFF },
      ),
    ).rejects.toBeInstanceOf(KnowledgeConflict);
    const stillLive = await withTenant(app, ORG_A, (client) =>
      getLiveVersion(client, created.item.id),
    );
    expect(stillLive?.id).toBe(created.version.id);
    // The latest draft approves cleanly.
    await withTenant(
      app,
      ORG_A,
      (client) =>
        approveKnowledgeVersion(client, {
          itemId: created.item.id,
          versionId: v3.id,
        }),
      { actorId: STAFF },
    );
    const flipped = await withTenant(app, ORG_A, (client) =>
      getLiveVersion(client, created.item.id),
    );
    expect(flipped?.id).toBe(v3.id);
  });

  evidenceTest('direct definer call cannot publish a stale draft', async () => {
    // ROUND-4 regression: the DEFINER assigned the boolean guard to the wrong
    // variable, so a DIRECT fn call (bypassing the service pre-check) published a
    // stale v2 with v3 pending. The fn itself must refuse.
    const created = await withTenant(app, ORG_A, (client) =>
      createKnowledgeItem(client, {
        title: 'Direktaufruf',
        body: 'Erste Fassung.',
        metadata: META,
      }),
    );
    await withTenant(
      app,
      ORG_A,
      (client) =>
        approveKnowledgeVersion(client, {
          itemId: created.item.id,
          versionId: created.version.id,
        }),
      { actorId: STAFF },
    );
    const v2 = await withTenant(app, ORG_A, (client) =>
      editKnowledgeItem(client, created.item.id, {
        title: 'Direktaufruf',
        body: 'Zweite Fassung.',
        metadata: META,
      }),
    );
    await withTenant(app, ORG_A, (client) =>
      editKnowledgeItem(client, created.item.id, {
        title: 'Direktaufruf',
        body: 'Dritte Fassung.',
        metadata: META,
      }),
    );
    // Direct DEFINER call for stale v2 (no service pre-check in this path).
    // P09.05: 2-arg door, actor from the txn (insufficient_privilege, 42501).
    await expect(
      withTenant(
        app,
        ORG_A,
        (client) =>
          client.query(`select app.approve_knowledge_version($1, $2)`, [created.item.id, v2.id]),
        { actorId: STAFF },
      ),
    ).rejects.toMatchObject({ code: '42501' });
    // v2 stays draft; live still v1.
    const state = await withTenant(app, ORG_A, (client) =>
      client.query<{ state: string }>(`select state from knowledge_versions where id = $1`, [
        v2.id,
      ]),
    );
    expect(state.rows[0]?.state).toBe('draft');
    const live = await withTenant(app, ORG_A, (client) => getLiveVersion(client, created.item.id));
    expect(live?.id).toBe(created.version.id);
  });

  evidenceTest('concurrent approves serialise: one flips, the other 409s', async () => {
    const created = await withTenant(app, ORG_A, (client) =>
      createKnowledgeItem(client, {
        title: 'Stornierung',
        body: 'Bis 24h vorher kostenfrei.',
        metadata: META,
      }),
    );
    const outcomes = await Promise.allSettled([
      withTenant(
        app,
        ORG_A,
        (client) =>
          approveKnowledgeVersion(client, {
            itemId: created.item.id,
            versionId: created.version.id,
          }),
        { actorId: STAFF },
      ),
      withTenant(
        app,
        ORG_A,
        (client) =>
          approveKnowledgeVersion(client, {
            itemId: created.item.id,
            versionId: created.version.id,
          }),
        { actorId: STAFF },
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

  evidenceTest(
    'DB boundary rejects bypass writes: approved body, unretire, draft pointer',
    async () => {
      const created = await withTenant(app, ORG_A, (client) =>
        createKnowledgeItem(client, {
          title: 'Angebot',
          body: 'Ab 100 Euro versandkostenfrei.',
          metadata: META,
        }),
      );
      await withTenant(
        app,
        ORG_A,
        (client) =>
          approveKnowledgeVersion(client, {
            itemId: created.item.id,
            versionId: created.version.id,
          }),
        { actorId: STAFF },
      );
      const draft = await withTenant(app, ORG_A, (client) =>
        editKnowledgeItem(client, created.item.id, {
          title: 'Angebot',
          body: 'Ab 150 Euro versandkostenfrei.',
          metadata: META,
        }),
      );
      // Direct body rewrite of the APPROVED row: trigger rejects (insufficient_privilege).
      await expect(
        withTenant(app, ORG_A, (client) =>
          client.query(`update knowledge_versions set body = 'gehackt' where id = $1`, [
            created.version.id,
          ]),
        ),
      ).rejects.toMatchObject({ code: '42501' });
      // Direct live-pointer move to a DRAFT version: items trigger rejects.
      await expect(
        withTenant(app, ORG_A, (client) =>
          client.query(`update knowledge_items set live_version_id = $1 where id = $2`, [
            draft.id,
            created.item.id,
          ]),
        ),
      ).rejects.toMatchObject({ code: '42501' });
      // Retire, then direct unretire: terminal, trigger rejects.
      await withTenant(app, ORG_A, (client) => retireKnowledgeItem(client, created.item.id));
      await expect(
        withTenant(app, ORG_A, (client) =>
          client.query(`update knowledge_items set state = 'approved' where id = $1`, [
            created.item.id,
          ]),
        ),
      ).rejects.toMatchObject({ code: '42501' });
      // Approved content untouched by the rejected writes.
      const live = await withTenant(app, ORG_A, (client) =>
        client.query<{ body: string }>(`select body from knowledge_versions where id = $1`, [
          created.version.id,
        ]),
      );
      expect(live.rows[0]?.body).toBe('Ab 100 Euro versandkostenfrei.');
    },
  );

  evidenceTest(
    'DB boundary rejects insert-approved, fabricated approval, direct flip',
    async () => {
      // INSERT-approved-version: the insert-draft trigger rejects smuggling an approved
      // row past the publish path.
      await expect(
        withTenant(app, ORG_A, (client) =>
          client.query(
            `insert into knowledge_versions
             (organisation_id, id, item_id, version_no, title, body, state, source, category)
           values (app.current_org(), gen_random_uuid(), gen_random_uuid(), 1, 'Gehackt', 'Gehackt.', 'approved', 'manual', 'x')`,
          ),
        ),
      ).rejects.toMatchObject({ code: '42501' });
      const created = await withTenant(app, ORG_A, (client) =>
        createKnowledgeItem(client, {
          title: 'Angebot',
          body: 'Ab 100 Euro versandkostenfrei.',
          metadata: META,
        }),
      );
      const draft = await withTenant(app, ORG_A, (client) =>
        editKnowledgeItem(client, created.item.id, {
          title: 'Angebot',
          body: 'Ab 150 Euro versandkostenfrei.',
          metadata: META,
        }),
      );
      expect(draft.versionNo).toBe(2);
      // Fabricated approval + direct flip in ONE txn: moin_app holds no INSERT on
      // approvals and no UPDATE on versions — both die as 42501 before any trigger.
      // (The service path works because the DEFINER fn writes as owner.)
      await expect(
        withTenant(app, ORG_A, async (client) => {
          await client.query(
            `insert into knowledge_approvals (organisation_id, id, item_id, version_id, approved_by)
           values (app.current_org(), gen_random_uuid(), $1, $2, $3)`,
            [created.item.id, created.version.id, STAFF],
          );
          await client.query(`update knowledge_versions set state = 'approved' where id = $1`, [
            created.version.id,
          ]);
        }),
      ).rejects.toMatchObject({ code: '42501' });
      // Nothing published by the bypass attempt: still draft, still serves nothing.
      const live = await withTenant(app, ORG_A, (client) =>
        getLiveVersion(client, created.item.id),
      );
      expect(live).toBeNull();
    },
  );

  evidenceTest('DB boundary rejects state regression and cross-item pointer', async () => {
    const first = await withTenant(app, ORG_A, (client) =>
      createKnowledgeItem(client, {
        title: 'Erstens',
        body: 'Erste Karte.',
        metadata: META,
      }),
    );
    const second = await withTenant(app, ORG_A, (client) =>
      createKnowledgeItem(client, {
        title: 'Zweitens',
        body: 'Zweite Karte.',
        metadata: META,
      }),
    );
    await withTenant(
      app,
      ORG_A,
      (client) =>
        approveKnowledgeVersion(client, {
          itemId: first.item.id,
          versionId: first.version.id,
        }),
      { actorId: STAFF },
    );
    await withTenant(
      app,
      ORG_A,
      (client) =>
        approveKnowledgeVersion(client, {
          itemId: second.item.id,
          versionId: second.version.id,
        }),
      { actorId: STAFF },
    );
    // approved → draft directly: forward-only, trigger rejects.
    await expect(
      withTenant(app, ORG_A, (client) =>
        client.query(`update knowledge_items set state = 'draft' where id = $1`, [first.item.id]),
      ),
    ).rejects.toMatchObject({ code: '42501' });
    // Live pointer to ANOTHER item's approved version: item-match rejects.
    await expect(
      withTenant(app, ORG_A, (client) =>
        client.query(`update knowledge_items set live_version_id = $1 where id = $2`, [
          second.version.id,
          first.item.id,
        ]),
      ),
    ).rejects.toMatchObject({ code: '42501' });
    // Mismatched approval INSERT (item A + version of item B): moin_app holds no
    // INSERT on approvals at all (DEFINER-only ledger) — dies as 42501 before any FK
    // fires. The ledger can never name a version that does not belong to the named
    // item: only the fn writes it, and the fn takes a single (item, version) pair it
    // validates together.
    const fresh = await withTenant(app, ORG_A, (client) =>
      createKnowledgeItem(client, {
        title: 'Drittens',
        body: 'Dritte Karte.',
        metadata: META,
      }),
    );
    const freshDraft = await withTenant(app, ORG_A, (client) =>
      editKnowledgeItem(client, fresh.item.id, {
        title: 'Drittens',
        body: 'Dritte Karte neu.',
        metadata: META,
      }),
    );
    await expect(
      withTenant(app, ORG_A, (client) =>
        client.query(
          `insert into knowledge_approvals (organisation_id, id, item_id, version_id, approved_by)
           values (app.current_org(), gen_random_uuid(), $1, $2, $3)`,
          [first.item.id, freshDraft.id, STAFF],
        ),
      ),
    ).rejects.toMatchObject({ code: '42501' });
    // Location deleted with a version leg: RESTRICT refuses with 23503 (the FK
    // fires before any trigger — the leg survives, org kept). SET NULL would be dead
    // text here (FK actions fire row triggers too, probe-verified), so RESTRICT is
    // the honest action.
    const loc = '55555555-5555-4555-8555-555555555555';
    await withTenant(app, ORG_A, (client) =>
      client.query(`insert into locations (organisation_id, id, name) values ($1, $2, 'Mitte')`, [
        ORG_A,
        loc,
      ]),
    );
    const placed = await withTenant(app, ORG_A, (client) =>
      createKnowledgeItem(client, {
        title: 'Filiale',
        body: 'Nur vor Ort.',
        metadata: { ...META, locationId: loc },
      }),
    );
    await expect(
      withTenant(app, ORG_A, (client) =>
        client.query(`delete from locations where id = $1`, [loc]),
      ),
    ).rejects.toMatchObject({ code: '23503' });
    const leg = await withTenant(app, ORG_A, (client) =>
      client.query<{ location_id: string | null; org: string }>(
        `select location_id::text, organisation_id::text as org from knowledge_versions where id = $1`,
        [placed.version.id],
      ),
    );
    expect(leg.rows[0]?.location_id).toBe(loc);
    expect(leg.rows[0]?.org).toBe(ORG_A);
  });

  evidenceTest('audit carries markers only, never bodies; tenants isolated', async () => {
    const created = await withTenant(app, ORG_A, (client) =>
      createKnowledgeItem(client, {
        title: 'Geheimrezept',
        body: 'Streng geheime Zutat X.',
        metadata: META,
      }),
    );
    await withTenant(
      app,
      ORG_A,
      (client) =>
        approveKnowledgeVersion(client, {
          itemId: created.item.id,
          versionId: created.version.id,
        }),
      { actorId: STAFF },
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
    // Cross-tenant location: B's location id on an A version dies as 23503 (composite FK).
    const bloc = '44444444-4444-4444-8444-444444444444';
    await withTenant(app, ORG_B, (client) =>
      client.query(`insert into locations (organisation_id, id, name) values ($1, $2, 'Beta')`, [
        ORG_B,
        bloc,
      ]),
    );
    await expect(
      withTenant(app, ORG_A, (client) =>
        createKnowledgeItem(client, {
          title: 'Falsch',
          body: 'Fremder Standort.',
          metadata: { ...META, locationId: bloc },
        }),
      ),
    ).rejects.toMatchObject({ code: '23503' });
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

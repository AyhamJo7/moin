/**
 * Approved-only retrieval exclusion suite (P09.09.05).
 * Synthetic data only (INV-16).
 */
import { randomUUID } from 'node:crypto';
import { createTestDatabase, evidenceTest, type TestDatabase } from '@moin/testing';
import { afterAll, beforeAll, describe, expect } from 'vitest';
import { openConflict } from './conflicts.ts';
import { createFaqCard, deactivateFaqCard, findAnswer } from './faq.ts';
import {
  approveKnowledgeVersion,
  createKnowledgeItem,
  getLiveVersion,
  retireKnowledgeItem,
  type KnowledgeMetadata,
} from './knowledge.ts';
import { createPool, type Pool } from './pool.ts';
import { findCandidates, listCardCatalogue, readApprovedVersions } from './retrieval.ts';
import { sweepReverify } from './staleness.ts';
import { withTenant } from './tenant.ts';

const ORG_A = '11111111-1111-4111-8111-111111111111';
const ORG_B = '22222222-2222-4222-8222-222222222222';

let database: TestDatabase;
let app: Pool;
let admin: Pool;
let OWNER: string;

function meta(over: Partial<KnowledgeMetadata> = {}): KnowledgeMetadata {
  return { source: 'manual', category: 'Öffnungszeiten', ...over };
}

beforeAll(async () => {
  database = await createTestDatabase('retrieval');
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
  body = 'Montags geschlossen.',
): Promise<{ itemId: string; versionId: string }> {
  const created = await withTenant(app, ORG_A, (client) =>
    createKnowledgeItem(client, { title: 'Ruhetag', body, metadata: meta(over) }),
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

describe('retrieval-exclusion', () => {
  evidenceTest('drafts and retired items never retrievable', async () => {
    const draft = await withTenant(app, ORG_A, (client) =>
      createKnowledgeItem(client, {
        title: 'Entwurf',
        body: 'Noch nicht fertig.',
        metadata: meta(),
      }),
    );
    expect(
      await withTenant(app, ORG_A, (client) => getLiveVersion(client, draft.item.id)),
    ).toBeNull();
    const live = await makeLive();
    await withTenant(app, ORG_A, (client) => retireKnowledgeItem(client, live.itemId));
    expect(
      await withTenant(app, ORG_A, (client) => getLiveVersion(client, live.itemId)),
    ).toBeNull();
    const view = await withTenant(app, ORG_A, (client) => readApprovedVersions(client));
    const ids = view.map((v) => v.itemId);
    expect(ids).not.toContain(draft.item.id);
    expect(ids).not.toContain(live.itemId);
  });

  evidenceTest('expired, suspended and conflicted never retrievable', async () => {
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    const expired = await makeLive({ validUntil: yesterday });
    expect(
      await withTenant(app, ORG_A, (client) => getLiveVersion(client, expired.itemId)),
    ).toBeNull();
    // Overdue restricted: inline suppression guards serving even before the
    // sweep runs, then the sweep suspends it for real.
    const overdue = await makeLive({ sensitivity: 'restricted', reverifyAfterDays: 1 });
    const late = new Date(Date.now() + 3 * 86_400_000);
    expect(
      await withTenant(app, ORG_A, (client) => getLiveVersion(client, overdue.itemId, late)),
    ).toBeNull();
    await withTenant(app, ORG_A, (client) => sweepReverify(client, late));
    expect(
      await withTenant(app, ORG_A, (client) => getLiveVersion(client, overdue.itemId)),
    ).toBeNull();
    const other = await makeLive({ sensitivity: 'restricted', reverifyAfterDays: 1 });
    // Suspend the overdue item through its conflict: the conflicted leg then
    // holds it out even after its reverify deadline passes a second time.
    await withTenant(app, ORG_A, (client) =>
      openConflict(client, {
        detector: 'item-contradiction',
        subjectKind: 'knowledge-item',
        subjectA: overdue.itemId,
        subjectB: other.itemId,
        reason: 'retrieval probe',
      }),
    );
    expect(
      await withTenant(app, ORG_A, (client) => getLiveVersion(client, overdue.itemId)),
    ).toBeNull();
    const view = await withTenant(app, ORG_A, (client) => readApprovedVersions(client));
    const ids = view.map((v) => v.itemId);
    expect(ids).not.toContain(expired.itemId);
    expect(ids).not.toContain(overdue.itemId);
  });

  evidenceTest('disallowed-channel cards absent from catalogue and answers', async () => {
    await withTenant(app, ORG_A, (client) =>
      createFaqCard(client, {
        canonical: 'Erhalten Sie eine schriftliche Bestaetigung?',
        spoken: 'Ja, per Nachricht sofort.',
        channels: ['message'],
      }),
    );
    // Voice call without a channel filter needs both channels: absent.
    const callHit = await withTenant(app, ORG_A, (client) =>
      findAnswer(client, {
        query: 'Erhalten Sie eine schriftliche Bestaetigung?',
        channel: 'call',
      }),
    );
    expect(callHit).toBeNull();
    const catalogue = await withTenant(app, ORG_A, (client) =>
      listCardCatalogue(client, { channel: 'call' }),
    );
    expect(
      catalogue.filter((c) => c.canonical === 'Erhalten Sie eine schriftliche Bestaetigung?'),
    ).toHaveLength(0);
    const messageCatalogue = await withTenant(app, ORG_A, (client) =>
      listCardCatalogue(client, { channel: 'message' }),
    );
    expect(
      messageCatalogue.filter(
        (c) => c.canonical === 'Erhalten Sie eine schriftliche Bestaetigung?',
      ),
    ).toHaveLength(1);
  });

  evidenceTest('deactivated cards leave catalogue, candidates and answers', async () => {
    const card = await withTenant(app, ORG_A, (client) =>
      createFaqCard(client, {
        canonical: 'Gibt es heute Klossgerichte?',
        spoken: 'Ja, Pilzragout mit Knoedeln.',
      }),
    );
    const before = await withTenant(app, ORG_A, (client) =>
      findCandidates(client, { query: 'Gibt es heute Klossgerichte?' }),
    );
    expect(before.map((c) => c.id)).toContain(card.id);
    await withTenant(app, ORG_A, (client) => deactivateFaqCard(client, card.id, 1));
    const catalogue = await withTenant(app, ORG_A, (client) => listCardCatalogue(client, {}));
    expect(catalogue.map((c) => c.id)).not.toContain(card.id);
    const after = await withTenant(app, ORG_A, (client) =>
      findCandidates(client, { query: 'Gibt es heute Klossgerichte?' }),
    );
    expect(after.map((c) => c.id)).not.toContain(card.id);
    const answer = await withTenant(app, ORG_A, (client) =>
      findAnswer(client, 'Gibt es heute Klossgerichte?'),
    );
    expect(answer?.cardId === card.id ? answer : null).toBeNull();
  });

  evidenceTest('catalogue is closed-set: ids, questions, variants per channel', async () => {
    const card = await withTenant(app, ORG_A, (client) =>
      createFaqCard(client, {
        canonical: 'Wann oeffnet der Biergarten?',
        variants: ['Biergarten Oeffnungszeiten bitte'],
        spoken: 'Ab zwoelf Uhr mittags.',
      }),
    );
    const catalogue = await withTenant(app, ORG_A, (client) => listCardCatalogue(client, {}));
    const entry = catalogue.find((c) => c.id === card.id);
    expect(entry?.canonical).toBe('Wann oeffnet der Biergarten?');
    expect(entry?.variants).toContain('Biergarten Oeffnungszeiten bitte');
  });

  evidenceTest('view and service agree; tenants isolated', async () => {
    const live = await makeLive({ category: 'Anfahrt' }, 'Hinter dem Haus.');
    const viaService = await withTenant(app, ORG_A, (client) =>
      getLiveVersion(client, live.itemId),
    );
    expect(viaService?.id).toBe(live.versionId);
    const viaView = await withTenant(app, ORG_A, (client) =>
      readApprovedVersions(client, { category: 'Anfahrt' }),
    );
    expect(viaView.map((v) => v.versionId)).toContain(live.versionId);
    // Cross-tenant: B sees neither the view rows nor the live version.
    const foreignView = await withTenant(app, ORG_B, (client) => readApprovedVersions(client));
    expect(foreignView.map((v) => v.versionId)).not.toContain(live.versionId);
    const foreignLive = await withTenant(app, ORG_B, (client) =>
      getLiveVersion(client, live.itemId),
    );
    expect(foreignLive).toBeNull();
    const foreignCatalogue = await withTenant(app, ORG_B, (client) =>
      listCardCatalogue(client, {}),
    );
    expect(foreignCatalogue).toHaveLength(0);
  });
});

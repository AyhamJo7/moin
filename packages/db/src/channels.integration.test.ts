import { randomUUID } from 'node:crypto';
import { createTestDatabase, evidenceTest, type TestDatabase } from '@moin/testing';
import { afterAll, beforeAll, describe, expect } from 'vitest';
import { createFaqCard, findAnswer, groundedCandidates, updateFaqCard } from './faq.ts';
import { KNOWLEDGE_CHANNELS } from './knowledge-channels.ts';
import { approveKnowledgeVersion, createKnowledgeItem, getLiveVersion } from './knowledge.ts';
import { createPool, type Pool } from './pool.ts';
import { findCandidates, listCardCatalogue, readApprovedVersions } from './retrieval.ts';
import { servedState, sweepReverify } from './staleness.ts';
import { withTenant, type TenantClient } from './tenant.ts';

const ORG = '11111111-1111-4111-8111-111111111111';
const OTHER_ORG = '22222222-2222-4222-8222-222222222222';
const DAY_MS = 86_400_000;
let database: TestDatabase;
let app: Pool;
let admin: Pool;
let owner: string;

beforeAll(async () => {
  database = await createTestDatabase('channels');
  app = createPool({ connectionString: database.appUrl, max: 1 });
  admin = database.fixturePool();
  owner = randomUUID();
  await admin.query(
    `insert into organisations (id, slug, name) values ($1, 'channels', 'Channels'),
      ($2, 'other-channels', 'Other Channels')`,
    [ORG, OTHER_ORG],
  );
  await admin.query(
    `insert into users (id, cognito_sub, email, status) values ($1, $2, 'owner@example.test', 'active')`,
    [owner, randomUUID()],
  );
  await admin.query(
    `insert into memberships (organisation_id, id, user_id, role, status)
      values ($1, $2, $3, 'owner', 'active')`,
    [ORG, randomUUID(), owner],
  );
});

afterAll(async () => {
  await app.end();
  await database.drop();
});

async function live(
  category: string,
  channels: readonly string[] | undefined,
  sensitivity: 'public' | 'internal' | 'restricted' = 'public',
): Promise<string> {
  return withTenant(
    app,
    ORG,
    async (client) => {
      const created = await createKnowledgeItem(client, {
        title: 'Gemeinsames Wissen',
        body: 'Montags geschlossen.',
        metadata: {
          source: 'manual',
          category,
          allowedChannels: channels,
          sensitivity,
          reverifyAfterDays: 1,
        },
      });
      await approveKnowledgeVersion(client, {
        itemId: created.item.id,
        versionId: created.version.id,
      });
      return created.item.id;
    },
    { actorId: owner },
  );
}

async function viewIds(client: TenantClient): Promise<string[]> {
  const rows = await client.query<{ item_id: string }>(
    'select item_id::text from knowledge_approved_current',
  );
  return rows.rows.map((row) => row.item_id);
}

describe('channel-scoping', () => {
  for (const channel of ['voice', 'email', 'web']) {
    evidenceTest(`${channel} sees own and all-channel content only`, async () => {
      const category = `scope-${channel}`;
      const query = `${randomUUID()} Hinweis`;
      const scoped: { channel: string; itemId: string; cardId: string }[] = [];
      for (const grant of KNOWLEDGE_CHANNELS) {
        const itemId = await live(category, [grant]);
        const card = await withTenant(app, ORG, (client) =>
          createFaqCard(client, {
            canonical: query,
            spoken: 'Montags geschlossen.',
            channels: [grant],
          }),
        );
        scoped.push({ channel: grant, itemId, cardId: card.id });
      }
      const allItem = await live(category, undefined);
      const allCard = await withTenant(app, ORG, (client) =>
        createFaqCard(client, { canonical: query, spoken: 'Montags geschlossen.' }),
      );
      const own = scoped.find((row) => row.channel === channel);
      if (own === undefined) throw new Error('missing channel fixture');
      await withTenant(app, ORG, async (client) => {
        const expectedItems = [own.itemId, allItem].sort();
        const expectedCards = [own.cardId, allCard.id].sort();
        expect(
          (await readApprovedVersions(client, { category, channel })).map((v) => v.itemId).sort(),
        ).toEqual(expectedItems);
        const direct = await viewIds(client);
        for (const row of scoped) expect(direct.includes(row.itemId)).toBe(row.channel === channel);
        expect(direct).toContain(allItem);
        const catalogue = await listCardCatalogue(client, { channel });
        expect(
          catalogue
            .filter((c) => c.canonical === query)
            .map((c) => c.id)
            .sort(),
        ).toEqual(expectedCards);
        expect(
          (await findCandidates(client, { query, channel }))
            .filter((c) => c.canonical === query)
            .map((c) => c.id)
            .sort(),
        ).toEqual(expectedCards);
        expect(
          (await groundedCandidates(client, { query, channel })).map((c) => c.cardId).sort(),
        ).toEqual(expectedCards);
        expect(expectedCards).toContain((await findAnswer(client, { query, channel }))?.cardId);
        for (const row of scoped) {
          expect((await getLiveVersion(client, row.itemId, new Date(), channel)) !== null).toBe(
            row.channel === channel,
          );
          expect((await servedState(client, row.itemId, new Date(), channel)) !== null).toBe(
            row.channel === channel,
          );
        }
      });
    });
  }

  evidenceTest('omitted context is fail closed and legacy grants are not aliases', async () => {
    const itemId = await live('legacy', ['call', 'message']);
    const card = await withTenant(app, ORG, (client) =>
      createFaqCard(client, {
        canonical: 'Legacy Hinweis',
        spoken: 'Nur im alten Kanal.',
        channels: ['call', 'message'],
      }),
    );
    await withTenant(app, ORG, async (client) => {
      for (const channel of [undefined, ...KNOWLEDGE_CHANNELS]) {
        const allowed = channel === 'call' || channel === 'message';
        expect(
          (await readApprovedVersions(client, { channel })).some((v) => v.itemId === itemId),
        ).toBe(allowed);
        expect((await listCardCatalogue(client, { channel })).some((c) => c.id === card.id)).toBe(
          allowed,
        );
        expect(
          (await findCandidates(client, { query: 'Legacy Hinweis', channel })).some(
            (c) => c.id === card.id,
          ),
        ).toBe(allowed);
        expect(
          (await groundedCandidates(client, { query: 'Legacy Hinweis', channel })).some(
            (c) => c.cardId === card.id,
          ),
        ).toBe(allowed);
        expect(
          (await findAnswer(client, { query: 'Legacy Hinweis', channel }))?.cardId === card.id,
        ).toBe(allowed);
        expect((await getLiveVersion(client, itemId, new Date(), channel)) !== null).toBe(allowed);
        expect((await servedState(client, itemId, new Date(), channel)) !== null).toBe(allowed);
      }
      expect((await readApprovedVersions(client)).some((v) => v.itemId === itemId)).toBe(false);
      expect(await viewIds(client)).not.toContain(itemId);
    });
  });

  evidenceTest(
    'channel sensitivity matrix preserves verbatim grounded and overdue gates',
    async () => {
      for (const channel of KNOWLEDGE_CHANNELS) {
        for (const sensitivity of ['public', 'internal', 'sensitive'] as const) {
          const query = `${randomUUID()} Hinweis`;
          const card = await withTenant(app, ORG, (client) =>
            createFaqCard(client, {
              canonical: query,
              spoken: 'Freigegebene Antwort.',
              channels: [channel],
              sensitivity,
              reverifyAfterDays: 1,
            }),
          );
          await withTenant(app, ORG, async (client) => {
            expect((await findAnswer(client, { query, channel }))?.cardId).toBe(card.id);
            expect(
              (await groundedCandidates(client, { query, channel })).some(
                (c) => c.cardId === card.id,
              ),
            ).toBe(sensitivity !== 'sensitive');
            const other = channel === 'voice' ? 'email' : 'voice';
            expect(
              (await findCandidates(client, { query, channel: other })).map((c) => c.id),
            ).not.toContain(card.id);
            expect(
              (await groundedCandidates(client, { query, channel: other })).map((c) => c.cardId),
            ).not.toContain(card.id);
            await client.query(
              `update faq_cards set updated_at = now() - interval '2 days' where id = $1`,
              [card.id],
            );
            const answer = await findAnswer(client, { query, channel });
            expect(answer?.cardId === card.id).toBe(sensitivity !== 'sensitive');
            if (sensitivity !== 'sensitive') expect(answer?.stale).toBe(true);
            expect(
              (await listCardCatalogue(client, { channel })).some((c) => c.id === card.id),
            ).toBe(sensitivity !== 'sensitive');
            expect(
              (await findCandidates(client, { query, channel })).some((c) => c.id === card.id),
            ).toBe(sensitivity !== 'sensitive');
            expect(
              (await groundedCandidates(client, { query, channel })).some(
                (c) => c.cardId === card.id,
              ),
            ).toBe(sensitivity !== 'sensitive');
          });
        }
        for (const sensitivity of ['public', 'internal', 'restricted'] as const) {
          const itemId = await live(`matrix-${channel}-${sensitivity}`, [channel], sensitivity);
          const late = new Date(Date.now() + 2 * DAY_MS);
          await withTenant(app, ORG, async (client) => {
            expect(
              (await readApprovedVersions(client, { channel })).map((v) => v.itemId),
            ).toContain(itemId);
            expect((await servedState(client, itemId, late, channel)) !== null).toBe(
              sensitivity !== 'restricted',
            );
            expect((await getLiveVersion(client, itemId, late, channel)) !== null).toBe(
              sensitivity !== 'restricted',
            );
            await sweepReverify(client, late);
            expect(
              (await readApprovedVersions(client, { channel })).some((v) => v.itemId === itemId),
            ).toBe(sensitivity !== 'restricted');
          });
        }
      }
    },
  );

  evidenceTest(
    'view context rejects unknown channels and cannot leak across transactions or tenants',
    async () => {
      const itemId = await live('context', ['email']);
      await withTenant(app, ORG, async (client) => {
        expect(
          (await readApprovedVersions(client, { channel: 'email' })).map((v) => v.itemId),
        ).toContain(itemId);
        await client.query(`select set_config('app.knowledge_channel', 'fax', true)`);
        expect(await viewIds(client)).toEqual([]);
      });
      await withTenant(app, ORG, async (client) => {
        expect(await viewIds(client)).not.toContain(itemId);
        await readApprovedVersions(client, { channel: 'email' });
        await readApprovedVersions(client);
        expect(await viewIds(client)).not.toContain(itemId);
      });
      await withTenant(app, OTHER_ORG, async (client) => {
        expect(await readApprovedVersions(client, { channel: 'email' })).toEqual([]);
        expect(await listCardCatalogue(client, { channel: 'email' })).toEqual([]);
      });
    },
  );

  evidenceTest('service and database reject invalid and empty channel grants', async () => {
    const card = await withTenant(app, ORG, (client) =>
      createFaqCard(client, {
        canonical: 'Validierung Hinweis',
        spoken: 'Freigegeben.',
        channels: ['web'],
      }),
    );
    for (const channels of [[], ['fax']]) {
      await expect(
        withTenant(app, ORG, (client) =>
          createFaqCard(client, {
            canonical: 'Ungueltig',
            spoken: 'Nein.',
            channels,
          }),
        ),
      ).rejects.toBeInstanceOf(RangeError);
      await expect(
        withTenant(app, ORG, (client) =>
          updateFaqCard(client, card.id, {
            canonical: 'Ungueltig',
            spoken: 'Nein.',
            channels,
            expectedVersion: 1,
          }),
        ),
      ).rejects.toBeInstanceOf(RangeError);
      await expect(live('invalid', channels)).rejects.toBeInstanceOf(RangeError);
    }
    for (const grants of [[], ['fax'], [null]]) {
      await expect(
        withTenant(app, ORG, (client) =>
          client.query('update faq_cards set allowed_channels = $1::text[] where id = $2', [
            grants,
            card.id,
          ]),
        ),
      ).rejects.toMatchObject({ code: '23514' });
      await expect(
        withTenant(app, ORG, async (client) => {
          const id = randomUUID();
          await client.query('insert into knowledge_items (organisation_id, id) values ($1, $2)', [
            ORG,
            id,
          ]);
          return client.query(
            `insert into knowledge_versions
          (organisation_id, id, item_id, version_no, title, body, source, category, allowed_channels)
          values ($1, $2, $3, 1, 'Probe', 'Probe', 'manual', 'Probe', $4::text[])`,
            [ORG, randomUUID(), id, grants],
          );
        }),
      ).rejects.toMatchObject({ code: '23514' });
    }
    await withTenant(app, ORG, async (client) => {
      const input = { query: 'Probe', channel: 'fax' };
      await expect(findAnswer(client, input)).rejects.toBeInstanceOf(RangeError);
      await expect(groundedCandidates(client, input)).rejects.toBeInstanceOf(RangeError);
      await expect(findCandidates(client, input)).rejects.toBeInstanceOf(RangeError);
      await expect(listCardCatalogue(client, input)).rejects.toBeInstanceOf(RangeError);
      await expect(readApprovedVersions(client, input)).rejects.toBeInstanceOf(RangeError);
      await expect(getLiveVersion(client, randomUUID(), new Date(), 'fax')).rejects.toBeInstanceOf(
        RangeError,
      );
      await expect(servedState(client, randomUUID(), new Date(), 'fax')).rejects.toBeInstanceOf(
        RangeError,
      );
    });
  });
});

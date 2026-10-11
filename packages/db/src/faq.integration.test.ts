/**
 * FAQ cards with approved spoken answers (P09.04.04): lint, sensitivity gating,
 * version locking, tenant isolation. Synthetic data only (INV-16).
 */
import { createTestDatabase, evidenceTest, type TestDatabase } from '@moin/testing';
import { afterAll, beforeAll, describe, expect } from 'vitest';
import { listAuditEvents } from './audit.ts';
import {
  createFaqCard,
  deactivateFaqCard,
  findAnswer,
  groundedCandidates,
  updateFaqCard,
  VersionConflictError as FaqConflict,
} from './faq.ts';
import { createPool, type Pool } from './pool.ts';
import { withTenant } from './tenant.ts';

const ORG_A = '11111111-1111-4111-8111-111111111111';
const ORG_B = '22222222-2222-4222-8222-222222222222';

let database: TestDatabase;
let app: Pool;
let admin: Pool;

beforeAll(async () => {
  database = await createTestDatabase('faq');
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

describe('faq', () => {
  evidenceTest('spoken answer returned verbatim on variant match', async () => {
    const card = await withTenant(app, ORG_A, (client) =>
      createFaqCard(client, {
        canonical: 'Wann haben Sie geöffnet?',
        variants: ['Öffnungszeiten bitte', 'Wann ist offen?'],
        spoken: 'Montag bis Freitag neun bis achtzehn Uhr.',
      }),
    );
    expect(card.sensitivity).toBe('public');
    const hit = await withTenant(app, ORG_A, (client) => findAnswer(client, 'Wann ist offen?'));
    expect(hit?.cardId).toBe(card.id);
    expect(hit?.spoken).toBe('Montag bis Freitag neun bis achtzehn Uhr.');
    // Cross-tenant: B sees no cards and matches nothing of A's corpus.
    const foreign = await withTenant(app, ORG_B, (client) => findAnswer(client, 'Wann ist offen?'));
    expect(foreign).toBeNull();
  });

  evidenceTest('lint rejects URLs and unreadable numbers at creation and update', async () => {
    await expect(
      withTenant(app, ORG_A, (client) =>
        createFaqCard(client, {
          canonical: 'Preise?',
          variants: [],
          spoken: 'Mehr unter https://example.de.',
        }),
      ),
    ).rejects.toBeInstanceOf(RangeError);
    await expect(
      withTenant(app, ORG_A, (client) =>
        createFaqCard(client, {
          canonical: 'Rufnummer?',
          variants: [],
          spoken: 'Rufen Sie 03012345678 an.',
        }),
      ),
    ).rejects.toBeInstanceOf(RangeError);
    const card = await withTenant(app, ORG_A, (client) =>
      createFaqCard(client, {
        canonical: 'Anfahrt?',
        variants: [],
        spoken: 'Ab Hauptbahnhof mit der U3.',
      }),
    );
    await expect(
      withTenant(app, ORG_A, (client) =>
        updateFaqCard(client, card.id, {
          canonical: 'Anfahrt?',
          spoken: 'Siehe www.example.de/anfahrt.',
          expectedVersion: card.version,
        }),
      ),
    ).rejects.toBeInstanceOf(RangeError);
  });

  evidenceTest('sensitive cards answer verbatim but never ground', async () => {
    const card = await withTenant(app, ORG_A, (client) =>
      createFaqCard(client, {
        canonical: 'Enthält der Kuchen Nüsse?',
        variants: ['Nussallergie Hinweis'],
        spoken: 'Unser Kuchen enthält Haselnüsse.',
        sensitivity: 'sensitive',
      }),
    );
    // Approved-card mode (default): sensitive answers verbatim.
    const hit = await withTenant(app, ORG_A, (client) =>
      findAnswer(client, 'Nussallergie Hinweis'),
    );
    expect(hit?.cardId).toBe(card.id);
    expect(hit?.spoken).toBe('Unser Kuchen enthält Haselnüsse.');
    // Grounded mode: sensitive excluded — yields nothing even on exact match.
    const grounded = await withTenant(app, ORG_A, (client) =>
      groundedCandidates(client, 'Nussallergie Hinweis'),
    );
    expect(grounded).toHaveLength(0);
    // Non-sensitive cards ground normally.
    await withTenant(app, ORG_A, (client) =>
      createFaqCard(client, {
        canonical: 'Wo parke ich?',
        variants: ['Parkplatz gesucht'],
        spoken: 'Parkhaus nebenan, erste Stunde frei.',
      }),
    );
    const groundedPublic = await withTenant(app, ORG_A, (client) =>
      groundedCandidates(client, 'Parkplatz gesucht'),
    );
    expect(groundedPublic.length).toBeGreaterThan(0);
  });

  evidenceTest('stale version 409s; deactivated cards never match', async () => {
    const card = await withTenant(app, ORG_A, (client) =>
      createFaqCard(client, {
        canonical: 'Stornierung?',
        variants: ['Storno Hinweis'],
        spoken: 'Bis vierundzwanzig Stunden vorher kostenfrei.',
      }),
    );
    await expect(
      withTenant(app, ORG_A, (client) =>
        updateFaqCard(client, card.id, {
          canonical: 'Stornierung?',
          spoken: 'Anders.',
          expectedVersion: 999,
        }),
      ),
    ).rejects.toBeInstanceOf(FaqConflict);
    const bumped = await withTenant(app, ORG_A, (client) =>
      updateFaqCard(client, card.id, {
        canonical: 'Stornierung?',
        spoken: 'Bis achtundvierzig Stunden vorher kostenfrei.',
        expectedVersion: card.version,
      }),
    );
    expect(bumped.version).toBe(card.version + 1);
    await withTenant(app, ORG_A, (client) => deactivateFaqCard(client, card.id));
    const gone = await withTenant(app, ORG_A, (client) => findAnswer(client, 'Storno Hinweis'));
    expect(gone).toBeNull();
  });

  evidenceTest('no match abstains; audit markers only; tenants isolated', async () => {
    const miss = await withTenant(app, ORG_A, (client) =>
      findAnswer(client, 'Zahnreinigung Kosten'),
    );
    expect(miss).toBeNull();
    await withTenant(app, ORG_A, async (client) => {
      const events = await listAuditEvents(client);
      const faqs = events.filter((e) => e.operation === 'faq.upsert');
      expect(faqs.length).toBeGreaterThan(0);
      for (const event of faqs) {
        const raw = JSON.stringify(event.args_sanitized);
        expect(raw).not.toContain('Haselnüsse');
        expect(raw).not.toContain('Nussallergie');
        expect(event.args_sanitized).toHaveProperty('sensitivity');
      }
    });
    const foreign = await withTenant(app, ORG_B, (client) =>
      findAnswer(client, 'Nussallergie Hinweis'),
    );
    expect(foreign).toBeNull();
    const foreignCount = await withTenant(app, ORG_B, (client) =>
      client.query<{ n: string }>(`select count(*)::text as n from faq_cards`),
    );
    expect(foreignCount.rows[0]?.n).toBe('0');
  });
});

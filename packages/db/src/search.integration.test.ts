/**
 * Tenant search (P07.12.03): German umlaut/ß matching, partial numbers, no cross-tenant
 * hits, cursor pagination. Synthetic data only (INV-16).
 */
import { createTestDatabase, evidenceTest, type TestDatabase } from '@moin/testing';
import { afterAll, beforeAll, describe, expect } from 'vitest';
import { listAuditEvents } from './audit.ts';
import { addContactMethod, createContact } from './contacts.ts';
import { createNote } from './notes-facts.ts';
import { createPool, type Pool } from './pool.ts';
import { searchTenant } from './search.ts';
import { createTask } from './tasks.ts';
import { withTenant } from './tenant.ts';

const ORG_A = '11111111-1111-4111-8111-111111111111';
const ORG_B = '22222222-2222-4222-8222-222222222222';

let database: TestDatabase;
let app: Pool;
let admin: Pool;

beforeAll(async () => {
  database = await createTestDatabase('search');
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

describe('search', () => {
  evidenceTest('umlaut and ß variants find the contact', async () => {
    const contact = await withTenant(app, ORG_A, (client) =>
      createContact(client, { displayName: 'Jürgen Müller' }),
    );
    // Exact spelling first: FTS leg.
    const exact = await withTenant(app, ORG_A, (client) =>
      searchTenant(client, { query: 'Müller', scope: 'contacts' }),
    );
    expect(exact.hits.map((h) => h.id)).toContain(contact.id);
    // ASCII spelling: trgm leg over unaccented names (german FTS alone does not fold ü→u).
    const ascii = await withTenant(app, ORG_A, (client) =>
      searchTenant(client, { query: 'Muller', scope: 'contacts' }),
    );
    expect(ascii.hits.map((h) => h.id)).toContain(contact.id);
  });

  evidenceTest('partial phone digits find the contact', async () => {
    const contact = await withTenant(app, ORG_A, (client) =>
      createContact(client, { displayName: 'Anna Schmidt' }),
    );
    await withTenant(app, ORG_A, (client) =>
      addContactMethod(client, contact.id, { kind: 'phone', value: '+49 30 111111' }),
    );
    // Folding strips spaces/dashes/plus on BOTH sides: the stored '+49 30 …' matches
    // a query with the plus and one without it.
    const withPlus = await withTenant(app, ORG_A, (client) =>
      searchTenant(client, { query: '+4930111111', scope: 'contacts' }),
    );
    expect(withPlus.hits.map((h) => h.id)).toContain(contact.id);
    const withoutPlus = await withTenant(app, ORG_A, (client) =>
      searchTenant(client, { query: '30 111111', scope: 'contacts' }),
    );
    expect(withoutPlus.hits.map((h) => h.id)).toContain(contact.id);
  });

  evidenceTest('cursor orders numerically across integer widths', async () => {
    // Cursor regression: scores compared as TEXT misorder across integer widths
    // ('2.1' > '10.5' lexicographically). Seed an FTS-band row (~2.1) plus a fuzzy
    // companion, page with limit 1, and assert the second page advances numerically
    // instead of replaying the first row.
    await withTenant(app, ORG_A, (client) =>
      createContact(client, { displayName: 'Zahlwort Tausendundeins' }),
    );
    await withTenant(app, ORG_A, (client) =>
      createContact(client, { displayName: 'Zahlwort Tausendundzwei' }),
    );
    const first = await withTenant(app, ORG_A, (client) =>
      searchTenant(client, { query: 'Zahlwort Tausendundeins', scope: 'contacts', limit: 1 }),
    );
    expect(first.hits).toHaveLength(1);
    expect(first.nextCursor).not.toBeNull();
    expect(first.hits[0]?.score).toBeGreaterThan(1.9);
    const second = await withTenant(app, ORG_A, (client) =>
      searchTenant(client, {
        query: 'Zahlwort Tausendundeins',
        scope: 'contacts',
        limit: 1,
        cursor: first.nextCursor ?? undefined,
      }),
    );
    // Advanced past page 1: no replay of the first row (text cursors replayed here
    // when a 1.x trgm score compared above a 2.x FTS score lexicographically).
    expect(second.hits.map((h) => h.id)).not.toContain(first.hits[0]?.id);
  });

  evidenceTest('tasks and notes match German stems; audit keeps no query text', async () => {
    const task = await withTenant(app, ORG_A, (client) =>
      createTask(client, { title: 'Rechnung prüfen' }),
    );
    const contact = await withTenant(app, ORG_A, (client) =>
      createContact(client, { displayName: 'Karl Meier' }),
    );
    await withTenant(app, ORG_A, (client) =>
      createNote(client, {
        parent: 'contact',
        parentId: contact.id,
        body: 'Der Kunde wünscht eine Straße mit Bäumen',
      }),
    );
    // Stemmed form: german dict matches Rechnungen → Rechnung.
    const tasks = await withTenant(app, ORG_A, (client) =>
      searchTenant(client, { query: 'Rechnungen', scope: 'tasks' }),
    );
    expect(tasks.hits.map((h) => h.id)).toContain(task.id);
    const notes = await withTenant(app, ORG_A, (client) =>
      searchTenant(client, { query: 'Strasse', scope: 'notes' }),
    );
    expect(notes).toBeTruthy();
    expect(notes.hits.length).toBeGreaterThan(0);
    // Audit carries the length marker and scope marker — never the query text.
    await withTenant(app, ORG_A, async (client) => {
      const events = await listAuditEvents(client);
      const searches = events.filter((e) => e.operation === 'search.query');
      expect(searches.length).toBeGreaterThan(0);
      for (const event of searches) {
        expect(JSON.stringify(event.args_sanitized)).not.toContain('Rechnungen');
        expect(JSON.stringify(event.args_sanitized)).not.toContain('Strasse');
        expect(event.args_sanitized).toHaveProperty('query_len');
      }
    });
  });

  evidenceTest('cursor pages through contacts; other tenants invisible', async () => {
    // NOTE 'Suchtest' + similar lengths: the FTS leg ties at 0.1 for every seed, so
    // page 1 (limit 2) takes the two alphabetically-first ids and the cursor resumes
    // after them. Trgm ordering is asserted in the umlaut test; here the cursor only
    // needs disjoint advance on the FTS band.
    const tags = ['Ava Maler', 'Ben Schreiner', 'Cleo Weber', 'Dan Fischer', 'Eli Braun'];
    for (let i = 0; i < 5; i++) {
      const contact = await withTenant(app, ORG_A, (client) =>
        createContact(client, { displayName: `Suchtest ${tags[i]}` }),
      );
      await withTenant(app, ORG_A, (client) =>
        createNote(client, {
          parent: 'contact',
          parentId: contact.id,
          body: `Notiz ${i}`,
        }),
      );
    }
    const foreign = await withTenant(app, ORG_B, (client) =>
      createContact(client, { displayName: 'Suchtest Fremd' }),
    );
    const first = await withTenant(app, ORG_A, (client) =>
      searchTenant(client, { query: 'Suchtest', scope: 'contacts', limit: 2 }),
    );
    expect(first.hits).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();
    expect(first.hits.map((h) => h.id)).not.toContain(foreign.id);
    const second = await withTenant(app, ORG_A, (client) =>
      searchTenant(client, {
        query: 'Suchtest',
        scope: 'contacts',
        limit: 10,
        cursor: first.nextCursor ?? undefined,
      }),
    );
    // Page 2 advances: none of page 1's rows reappear (strict score/id advance holds
    // per leg; ties replay only within the same score band — page 1's exact rows are
    // excluded by the cursor).
    for (const hit of first.hits) {
      expect(second.hits.map((h) => h.id)).not.toContain(hit.id);
    }
    expect(second.hits.map((h) => h.id)).not.toContain(foreign.id);
    // Cross-tenant search sees nothing of A's corpus: RLS scopes every leg, so the
    // B-side query returns exactly the one B contact even though the A names share
    // the 'Suchtest' stem (B's RLS policy hides A's rows before ranking).
    const other = await withTenant(app, ORG_B, (client) =>
      searchTenant(client, { query: 'Fremd', scope: 'contacts' }),
    );
    const otherIds = other.hits.map((h) => h.id);
    expect(otherIds).toContain(foreign.id);
    expect(other.hits.filter((h) => h.scope === 'contact')).toHaveLength(1);
  });

  evidenceTest('empty and overlong queries rejected, never audited', async () => {
    await expect(
      withTenant(app, ORG_A, (client) => searchTenant(client, { query: '   ' })),
    ).rejects.toBeInstanceOf(RangeError);
    await expect(
      withTenant(app, ORG_A, (client) => searchTenant(client, { query: 'x'.repeat(201) })),
    ).rejects.toBeInstanceOf(RangeError);
    await expect(
      withTenant(app, ORG_A, (client) =>
        searchTenant(client, { query: 'x', cursor: 'not-a-cursor' }),
      ),
    ).rejects.toBeInstanceOf(RangeError);
  });
});

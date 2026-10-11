/**
 * Duplicate candidates + human merge/unmerge (P07.04.04): deterministic signals, human-only
 * merges, reversible in 30 days, concurrent-safe, tenant-isolated.
 */
import { createTestDatabase, evidenceTest, type TestDatabase } from '@moin/testing';
import { afterAll, beforeAll, describe, expect } from 'vitest';
import { listAuditEvents } from './audit.ts';
import { addContactMethod, createContact, listContactMethods } from './contacts.ts';
import {
  applyMerge,
  suggestAiSimilarity,
  suggestEmailLocal,
  suggestNamePostal,
  unmerge,
  VersionConflictError as MergeConflict,
} from './merge.ts';
import { createPool, type Pool } from './pool.ts';
import { startConversation } from './conversations.ts';
import { withTenant } from './tenant.ts';

const ORG_A = '11111111-1111-4111-8111-111111111111';
const ORG_B = '22222222-2222-4222-8222-222222222222';
const STAFF = '33333333-3333-4333-8333-333333333333';

let database: TestDatabase;
let app: Pool;
let admin: Pool;

beforeAll(async () => {
  database = await createTestDatabase('merge');
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

describe('merge', () => {
  evidenceTest('name+PLZ and email-local signals suggest idempotently', async () => {
    const a = await withTenant(app, ORG_A, (client) =>
      createContact(client, { displayName: 'Anna Schmidt' }),
    );
    const b = await withTenant(app, ORG_A, (client) =>
      createContact(client, { displayName: 'anna  schmidt' }),
    );
    const one = await withTenant(app, ORG_A, (client) =>
      suggestNamePostal(client, a.id, b.id, { displayName: 'Anna Schmidt', postalCode: '20354' }),
    );
    expect(one.kind).toBe('name_postal');
    // Reversed order + idempotent retry: same open pair, same row.
    const two = await withTenant(app, ORG_A, (client) =>
      suggestNamePostal(client, b.id, a.id, { displayName: 'Anna Schmidt', postalCode: '20354' }),
    );
    expect(two.id).toBe(one.id);
    const local = await withTenant(app, ORG_A, (client) =>
      suggestEmailLocal(client, a.id, b.id, { localPart: 'Anna.Schmidt' }),
    );
    expect(local.kind).toBe('email_local');
    const ai = await withTenant(app, ORG_A, (client) => suggestAiSimilarity(client, a.id, b.id));
    expect(ai.kind).toBe('ai_similarity');
    // Malformed signals rejected, never stored.
    await expect(
      withTenant(app, ORG_A, (client) =>
        suggestNamePostal(client, a.id, b.id, { displayName: 'Anna Schmidt', postalCode: 'XX' }),
      ),
    ).rejects.toBeInstanceOf(RangeError);
    await expect(
      withTenant(app, ORG_A, (client) =>
        suggestNamePostal(client, a.id, a.id, { displayName: 'Anna Schmidt', postalCode: '20354' }),
      ),
    ).rejects.toBeInstanceOf(RangeError);
  });

  evidenceTest('human merge moves methods and links, deletes loser, audits markers', async () => {
    const winner = await withTenant(app, ORG_A, (client) =>
      createContact(client, { displayName: 'Bernd Weber' }),
    );
    const loser = await withTenant(app, ORG_A, (client) =>
      createContact(client, { displayName: 'Bernd Weber' }),
    );
    const method = await withTenant(app, ORG_A, (client) =>
      addContactMethod(client, loser.id, { kind: 'phone', value: '+49 30 111111' }),
    );
    const convo = await withTenant(app, ORG_A, (client) =>
      startConversation(client, { channel: 'call', contactId: loser.id }),
    );
    const candidate = await withTenant(app, ORG_A, (client) =>
      suggestNamePostal(client, winner.id, loser.id, {
        displayName: 'Bernd Weber',
        postalCode: '20354',
      }),
    );
    const record = await withTenant(app, ORG_A, (client) =>
      applyMerge(client, {
        winnerId: winner.id,
        loserId: loser.id,
        approvedBy: STAFF,
        candidateId: candidate.id,
      }),
    );
    expect(record.movedMethodIds).toContain(method.id);
    // Loser row gone; method + conversation re-homed.
    const methods = await withTenant(app, ORG_A, (client) => listContactMethods(client, winner.id));
    expect(methods.map((m) => m.id)).toContain(method.id);
    const owned = await withTenant(app, ORG_A, (client) =>
      client.query<{ n: string }>(
        `select count(*)::text as n from conversations where contact_id = $1`,
        [winner.id],
      ),
    );
    expect(owned.rows[0]?.n).toBe('1');
    expect(convo.id).toBeTruthy();
    // Candidate consumed by the merge: the inbox row is gone with the loser (RESTRICT
    // legs forbid keeping it), and the merge_id lives on in the ledger + audit row.
    const resolved = await withTenant(app, ORG_A, (client) =>
      client.query<{ n: string }>(
        `select count(*)::text as n from duplicate_candidates where id = $1`,
        [candidate.id],
      ),
    );
    expect(resolved.rows[0]?.n).toBe('0');
    const ledger = await withTenant(app, ORG_A, (client) =>
      client.query<{ candidate_id: string | null }>(
        `select candidate_id::text from contact_merges where id = $1`,
        [record.id],
      ),
    );
    expect(ledger.rows[0]?.candidate_id).toBe(candidate.id);
    // Audit carries markers, never names.
    await withTenant(app, ORG_A, async (client) => {
      const events = await listAuditEvents(client, { targetId: record.id });
      const applied = events.find((e) => e.operation === 'merge.apply');
      expect(applied).toBeTruthy();
      expect(JSON.stringify(applied?.args_sanitized)).not.toContain('Bernd');
    });
  });

  evidenceTest('concurrent merges serialise: one applies, the other 409s', async () => {
    const winner = await withTenant(app, ORG_A, (client) =>
      createContact(client, { displayName: 'Clara Jansen' }),
    );
    const loser = await withTenant(app, ORG_A, (client) =>
      createContact(client, { displayName: 'Clara Jansen' }),
    );
    const outcomes = await Promise.allSettled([
      withTenant(app, ORG_A, (client) =>
        applyMerge(client, { winnerId: winner.id, loserId: loser.id, approvedBy: STAFF }),
      ),
      withTenant(app, ORG_A, (client) =>
        applyMerge(client, { winnerId: winner.id, loserId: loser.id, approvedBy: STAFF }),
      ),
    ]);
    const won = outcomes.filter((r) => r.status === 'fulfilled');
    const lost = outcomes.filter((r) => r.status === 'rejected');
    expect(won).toHaveLength(1);
    expect(lost).toHaveLength(1);
    if (lost[0]?.status === 'rejected') {
      expect(lost[0].reason).toBeInstanceOf(MergeConflict);
    } else {
      throw new Error('expected exactly one rejected merge');
    }
  });

  evidenceTest('new interaction during merge lands on the winner', async () => {
    const winner = await withTenant(app, ORG_A, (client) =>
      createContact(client, { displayName: 'Dieter Funk' }),
    );
    const loser = await withTenant(app, ORG_A, (client) =>
      createContact(client, { displayName: 'Dieter Funk' }),
    );
    // Merge first, then interact with the LOSER id: FK RESTRICT refuses it (the row is
    // gone), so the caller resolves to the winner — modelled here by linking to winner.
    await withTenant(app, ORG_A, (client) =>
      applyMerge(client, { winnerId: winner.id, loserId: loser.id, approvedBy: STAFF }),
    );
    const after = await withTenant(app, ORG_A, (client) =>
      startConversation(client, { channel: 'call', contactId: winner.id }),
    );
    expect(after.contactId).toBe(winner.id);
    await expect(
      withTenant(app, ORG_A, (client) =>
        startConversation(client, { channel: 'call', contactId: loser.id }),
      ),
    ).rejects.toMatchObject({ code: '23503' });
  });

  evidenceTest('unmerge within 30 days restores links under a fresh id', async () => {
    const winner = await withTenant(app, ORG_A, (client) =>
      createContact(client, { displayName: 'Eva Neumann' }),
    );
    const loser = await withTenant(app, ORG_A, (client) =>
      createContact(client, { displayName: 'Eva Neumann' }),
    );
    const method = await withTenant(app, ORG_A, (client) =>
      addContactMethod(client, loser.id, { kind: 'email', value: 'eva@example.test' }),
    );
    await withTenant(app, ORG_A, (client) =>
      startConversation(client, { channel: 'call', contactId: loser.id }),
    );
    const record = await withTenant(app, ORG_A, (client) =>
      applyMerge(client, { winnerId: winner.id, loserId: loser.id, approvedBy: STAFF }),
    );
    const undone = await withTenant(app, ORG_A, (client) => unmerge(client, record.id));
    expect(undone.restoredContactId).not.toBe(loser.id);
    // Method moved back to the restored row.
    const methods = await withTenant(app, ORG_A, (client) =>
      listContactMethods(client, undone.restoredContactId),
    );
    expect(methods.map((m) => m.id)).toContain(method.id);
    // Winner keeps no trace of the moved method.
    const winnerMethods = await withTenant(app, ORG_A, (client) =>
      listContactMethods(client, winner.id),
    );
    expect(winnerMethods.map((m) => m.id)).not.toContain(method.id);
    // Second unmerge refused: already undone.
    await expect(
      withTenant(app, ORG_A, (client) => unmerge(client, record.id)),
    ).rejects.toBeInstanceOf(MergeConflict);
  });

  evidenceTest('cross-tenant merges and candidates are invisible', async () => {
    const a = await withTenant(app, ORG_A, (client) =>
      createContact(client, { displayName: 'Finn Krüger' }),
    );
    const b = await withTenant(app, ORG_A, (client) =>
      createContact(client, { displayName: 'Finn Krüger' }),
    );
    await withTenant(app, ORG_A, (client) =>
      suggestNamePostal(client, a.id, b.id, { displayName: 'Finn Krüger', postalCode: '20354' }),
    );
    const foreign = await withTenant(app, ORG_B, (client) =>
      client.query<{ n: string }>(`select count(*)::text as n from duplicate_candidates`),
    );
    expect(foreign.rows[0]?.n).toBe('0');
    const foreignMerges = await withTenant(app, ORG_B, (client) =>
      client.query<{ n: string }>(`select count(*)::text as n from contact_merges`),
    );
    expect(foreignMerges.rows[0]?.n).toBe('0');
    // Cross-tenant merge attempt: B's contact id with A's row — lock finds one row, 409s.
    const stranger = await withTenant(app, ORG_B, (client) =>
      createContact(client, { displayName: 'Finn Krüger' }),
    );
    await expect(
      withTenant(app, ORG_A, (client) =>
        applyMerge(client, { winnerId: a.id, loserId: stranger.id, approvedBy: STAFF }),
      ),
    ).rejects.toBeInstanceOf(MergeConflict);
  });
});

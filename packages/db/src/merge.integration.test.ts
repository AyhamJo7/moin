/**
 * Duplicate candidates + human merge/unmerge (P07.04.04): deterministic signals, human-only
 * merges, reversible in 30 days, concurrent-safe, tenant-isolated.
 */
import { createTestDatabase, evidenceTest, type TestDatabase } from '@moin/testing';
import { afterAll, beforeAll, describe, expect } from 'vitest';
import { listAuditEvents } from './audit.ts';
import { addContactMethod, createContact, listContactMethods } from './contacts.ts';
import { randomUUID } from 'node:crypto';
import {
  applyMerge,
  suggestAiSimilarity,
  suggestEmailLocal,
  suggestNamePostal,
  unmerge,
  VersionConflictError as MergeConflict,
} from './merge.ts';
import { createTask } from './tasks.ts';
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
    // Changed signal, same open pair: stored suggestion stands (re-suggesting with
    // different data is not an update) — same row, original signal intact.
    const changed = await withTenant(app, ORG_A, (client) =>
      suggestNamePostal(client, a.id, b.id, { displayName: 'Anna Schmidt', postalCode: '10115' }),
    );
    expect(changed.id).toBe(one.id);
    // Identical signal on a DIFFERENT pair: a distinct row (pair-scoped, not value-scoped).
    const c = await withTenant(app, ORG_A, (client) =>
      createContact(client, { displayName: 'Anna Schmidt' }),
    );
    const other = await withTenant(app, ORG_A, (client) =>
      suggestNamePostal(client, a.id, c.id, { displayName: 'Anna Schmidt', postalCode: '20354' }),
    );
    expect(other.id).not.toBe(one.id);
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
    // A resolver verdict on the loser: merge must carry it to the winner (same
    // interaction_ref, winner leg), not drop it with the triple-FK delete.
    await withTenant(app, ORG_A, (client) =>
      client.query(
        `insert into interaction_links
           (organisation_id, id, interaction_ref, contact_id, method_id, rule, label_de)
         values (app.current_org(), $1, $2, $3, $4, 'phone', 'erkannt über Rufnummer')`,
        [randomUUID(), 'merge-probe-link', loser.id, method.id],
      ),
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
    // Loser row gone; method + conversation re-homed — with a version bump, so a stale
    // client holding the pre-merge version 409s instead of silently keeping the loser.
    const methods = await withTenant(app, ORG_A, (client) => listContactMethods(client, winner.id));
    expect(methods.map((m) => m.id)).toContain(method.id);
    const moved = await withTenant(app, ORG_A, (client) =>
      client.query<{ version: string }>(`select version::text from conversations where id = $1`, [
        convo.id,
      ]),
    );
    expect(Number(moved.rows[0]?.version)).toBe(convo.version + 1);
    const owned = await withTenant(app, ORG_A, (client) =>
      client.query<{ n: string }>(
        `select count(*)::text as n from conversations where contact_id = $1`,
        [winner.id],
      ),
    );
    expect(owned.rows[0]?.n).toBe('1');
    expect(convo.id).toBeTruthy();
    // The resolver verdict survived the triple-FK delete+recreate: winner leg, same ref.
    const link = await withTenant(app, ORG_A, (client) =>
      client.query<{ contact_id: string; method_id: string; rule: string; label_de: string }>(
        `select contact_id::text, method_id::text, rule, label_de
         from interaction_links where interaction_ref = 'merge-probe-link'`,
      ),
    );
    expect(link.rows[0]).toMatchObject({
      contact_id: winner.id,
      method_id: method.id,
      rule: 'phone',
      label_de: 'erkannt über Rufnummer',
    });
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

  evidenceTest('merge with a candidate for another pair is a 409, nothing moved', async () => {
    const winner = await withTenant(app, ORG_A, (client) =>
      createContact(client, { displayName: 'Clara Jansen' }),
    );
    const loser = await withTenant(app, ORG_A, (client) =>
      createContact(client, { displayName: 'Clara Jansen' }),
    );
    const stranger = await withTenant(app, ORG_A, (client) =>
      createContact(client, { displayName: 'Clara Jansen' }),
    );
    const foreign = await withTenant(app, ORG_A, (client) =>
      suggestNamePostal(client, winner.id, stranger.id, {
        displayName: 'Clara Jansen',
        postalCode: '20354',
      }),
    );
    await expect(
      withTenant(app, ORG_A, (client) =>
        applyMerge(client, {
          winnerId: winner.id,
          loserId: loser.id,
          approvedBy: STAFF,
          candidateId: foreign.id,
        }),
      ),
    ).rejects.toBeInstanceOf(MergeConflict);
    // Nothing moved: both rows still live, and this attempt wrote no ledger entry
    // (other tests in this file merge their own pairs — count only this pair's ledger).
    const live = await withTenant(app, ORG_A, (client) =>
      client.query<{ n: string }>(
        `select count(*)::text as n from contacts where id = $1 or id = $2`,
        [winner.id, loser.id],
      ),
    );
    expect(live.rows[0]?.n).toBe('2');
    const ledgers = await withTenant(app, ORG_A, (client) =>
      client.query<{ n: string }>(
        `select count(*)::text as n from contact_merges where winner_id = $1 and loser_id = $2`,
        [winner.id, loser.id],
      ),
    );
    expect(ledgers.rows[0]?.n).toBe('0');
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
    const movedConvo = await withTenant(app, ORG_A, (client) =>
      startConversation(client, { channel: 'call', contactId: loser.id }),
    );
    const task = await withTenant(app, ORG_A, (client) =>
      createTask(client, { title: 'Rückruf Eva', conversationId: movedConvo.id }),
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
    // The task stayed with its conversation throughout: unmerge must not re-point it
    // at the restored CONTACT id (that would corrupt tasks.conversation_id).
    const after = await withTenant(app, ORG_A, (client) =>
      client.query<{ conversation_id: string }>(
        `select conversation_id::text from tasks where id = $1`,
        [task.id],
      ),
    );
    expect(after.rows[0]?.conversation_id).toBe(movedConvo.id);
    // Recorded conversations/calls came back: their contact legs name the restored row,
    // not the winner (the round-2 HIGH: moved_link_ids held links+convos+calls but only
    // links were rewritten).
    const convoBack = await withTenant(app, ORG_A, (client) =>
      client.query<{ contact_id: string; version: string }>(
        `select contact_id::text, version::text from conversations where id = $1`,
        [movedConvo.id],
      ),
    );
    expect(convoBack.rows[0]?.contact_id).toBe(undone.restoredContactId);
    // The move-back bumped the version a second time (merge bumped once already).
    expect(Number(convoBack.rows[0]?.version)).toBe(movedConvo.version + 2);
    // Second unmerge refused: already undone.
    await expect(
      withTenant(app, ORG_A, (client) => unmerge(client, record.id)),
    ).rejects.toBeInstanceOf(MergeConflict);
  });

  evidenceTest('concurrent different-value suggests converge on one row', async () => {
    const a = await withTenant(app, ORG_A, (client) =>
      createContact(client, { displayName: 'Hugo Berger' }),
    );
    const b = await withTenant(app, ORG_A, (client) =>
      createContact(client, { displayName: 'Hugo Berger' }),
    );
    // Same pair, different signal inputs, racing: SELECT-first can miss on both sides,
    // so the INSERTs collide — the pair-unique arbiter turns the loser into a re-read,
    // not a 23505. Both callers get the same stored row (no throw, no duplicates).
    const [one, two] = await Promise.all([
      withTenant(app, ORG_A, (client) =>
        suggestNamePostal(client, a.id, b.id, { displayName: 'Hugo Berger', postalCode: '20354' }),
      ),
      withTenant(app, ORG_A, (client) =>
        suggestNamePostal(client, b.id, a.id, { displayName: 'Hugo Berger', postalCode: '10115' }),
      ),
    ]);
    expect(one.id).toBe(two.id);
    const rows = await withTenant(app, ORG_A, (client) =>
      client.query<{ n: string }>(
        `select count(*)::text as n from duplicate_candidates
         where kind = 'name_postal' and status = 'open'
           and ((contact_a_id = $1 and contact_b_id = $2) or (contact_a_id = $2 and contact_b_id = $1))`,
        [a.id, b.id],
      ),
    );
    expect(rows.rows[0]?.n).toBe('1');
  });

  evidenceTest('concurrent unmerges serialise: one restores, the other 409s', async () => {
    const winner = await withTenant(app, ORG_A, (client) =>
      createContact(client, { displayName: 'Greta Wolf' }),
    );
    const loser = await withTenant(app, ORG_A, (client) =>
      createContact(client, { displayName: 'Greta Wolf' }),
    );
    const record = await withTenant(app, ORG_A, (client) =>
      applyMerge(client, { winnerId: winner.id, loserId: loser.id, approvedBy: STAFF }),
    );
    const outcomes = await Promise.allSettled([
      withTenant(app, ORG_A, (client) => unmerge(client, record.id)),
      withTenant(app, ORG_A, (client) => unmerge(client, record.id)),
    ]);
    const won = outcomes.filter((r) => r.status === 'fulfilled');
    const lost = outcomes.filter((r) => r.status === 'rejected');
    expect(won).toHaveLength(1);
    expect(lost).toHaveLength(1);
    if (lost[0]?.status === 'rejected') {
      expect(lost[0].reason).toBeInstanceOf(MergeConflict);
    } else {
      throw new Error('expected exactly one rejected unmerge');
    }
    // One restoration only: exactly one restored contact beyond the winner.
    const restored = await withTenant(app, ORG_A, (client) =>
      client.query<{ n: string }>(
        `select count(*)::text as n from contacts where display_name = 'Greta Wolf'`,
      ),
    );
    expect(restored.rows[0]?.n).toBe('2');
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

/**
 * Idempotency-Key service (P08.04, ADR-0007).
 *
 * `executeIdempotent` wraps one POST/PATCH mutation:
 * - first presentation of (operation, key) inserts an `executing` row and
 *   runs `fn`; the result stores and returns (24 h replay, P08.04.01).
 * - same key + same body replays the stored response without re-executing.
 * - same key + different body is a 422 (P08.04.02) — the key names one
 *   request, and a different body under it is a client bug, never a retry.
 * - concurrent same key (P08.04.02): the loser blocks on the winner's row
 *   lock (SELECT … FOR UPDATE) and then replays or 422s — one executes.
 *
 * The request hash is SHA-256 over the canonical JSON body (INV-12: the hash
 * is compared, the body never stored here — bodies live in domain rows).
 */

import { createHash, randomUUID } from 'node:crypto';
import type { TenantClient } from './tenant.ts';

/** Same key, different body: the client reused a key for another request. */
export class IdempotencyMismatchError extends Error {
  public override readonly name = 'IdempotencyMismatchError';
}

export function hashRequest(body: unknown): string {
  return createHash('sha256').update(JSON.stringify(body) ?? 'null').digest('hex');
}

function checkOperation(operation: string): string {
  const trimmed = operation.trim();
  if (trimmed.length === 0 || trimmed.length > 80) {
    throw new RangeError('operation must be 1..80 characters');
  }
  return trimmed;
}

function checkKey(key: string): string {
  const trimmed = key.trim();
  if (trimmed.length === 0 || trimmed.length > 100) {
    throw new RangeError('idempotency key must be 1..100 characters');
  }
  return trimmed;
}

/**
 * Run `fn` once per (operation, key, body-hash): replays, 422s, or executes.
 * `fn` returns the response to store (JSON-serialisable, content-free
 * markers preferred — INV-12). Expired rows (expires_at past) are treated as
 * absent: the key may be reused after 24 h.
 */
export async function executeIdempotent<T>(
  client: TenantClient,
  input: {
    operation: string;
    key: string;
    body: unknown;
    execute: () => Promise<T>;
  },
): Promise<{ result: T; replayed: boolean }> {
  const operation = checkOperation(input.operation);
  const key = checkKey(input.key);
  const digest = hashRequest(input.body);
  // Expired rows never block a reuse: delete-then-insert is one statement,
  // so concurrent reuses still serialise on the unique index.
  await client.query(
    `delete from idempotency_keys
     where organisation_id = app.current_org() and operation = $1::text
       and key = $2::text and expires_at <= now()`,
    [operation, key],
  );
  const inserted = await client.query<{ request_hash: string; status: string; response: string | null }>(
    `insert into idempotency_keys
       (organisation_id, id, operation, key, request_hash, expires_at)
     values (app.current_org(), $1::uuid, $2::text, $3::text, $4::text,
             now() + interval '24 hours')
     on conflict (organisation_id, operation, key) do nothing
     returning request_hash, status, response::text`,
    [randomUUID(), operation, key, digest],
  );
  const own = inserted.rows[0];
  if (own !== undefined) {
    // We won the insert: execute, then store. A crash between execute and
    // store leaves `executing` — the next presentation waits on the row lock
    // below and replays or re-executes by status (never double-executes a
    // succeeded row).
    try {
      const result = await input.execute();
      await client.query(
        `update idempotency_keys set status = 'succeeded', response = $4::jsonb
         where organisation_id = app.current_org() and operation = $1::text and key = $2::text
           and request_hash = $3::text`,
        [operation, key, digest, JSON.stringify(result) ?? 'null'],
      );
      return { result, replayed: false };
    } catch (error) {
      await client.query(
        `update idempotency_keys set status = 'failed'
         where organisation_id = app.current_org() and operation = $1::text and key = $2::text
           and request_hash = $3::text`,
        [operation, key, digest],
      );
      throw error;
    }
  }
  // Lost the insert: lock the winner's row, then decide by what it says.
  const winner = await client.query<{
    request_hash: string;
    status: string;
    response: string | null;
  }>(
    `select request_hash, status, response::text from idempotency_keys
     where organisation_id = app.current_org() and operation = $1::text and key = $2::text
     for update`,
    [operation, key],
  );
  const row = winner.rows[0];
  if (row === undefined) throw new Error('idempotency row vanished mid-flight');
  if (row.request_hash !== digest) {
    throw new IdempotencyMismatchError('idempotency key reused with a different body');
  }
  if (row.status === 'succeeded' && row.response !== null) {
    return { result: JSON.parse(row.response) as T, replayed: true };
  }
  // Winner is executing or failed: run exactly once here (the lock held the
  // concurrency; a failed winner never stored, so executing is safe).
  const result = await input.execute();
  await client.query(
    `update idempotency_keys set status = 'succeeded', response = $4::jsonb
     where organisation_id = app.current_org() and operation = $1::text and key = $2::text
       and request_hash = $3::text`,
    [operation, key, digest, JSON.stringify(result) ?? 'null'],
  );
  return { result, replayed: false };
}

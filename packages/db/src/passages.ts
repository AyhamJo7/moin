/**
 * Approved passages (P09.09.04 SELL, migration 0074): tenant-scoped chunk
 * rows per approved version with embedding model version; idempotent
 * re-embed per (version, chunk). Retrieval gating (approved/channel/
 * sensitivity/validity/conflict, cross-tenant exclusion) rides the existing
 * P09.09 view + RLS — this module is the row mechanics; vectors/HNSW ride
 * the P10.01 gateway wiring separately.
 */

import { randomUUID } from 'node:crypto';
import type { TenantClient } from './tenant.ts';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

function checkVersion(version: string): string {
  const trimmed = version.trim();
  if (trimmed.length === 0 || trimmed.length > 80) {
    throw new RangeError('embedding model version must be 1..80 characters');
  }
  return trimmed;
}

export const PassageValidators = { checkVersion };

/**
 * Store one passage chunk: idempotent per (version, chunk) — repeats keep
 * the row (re-embed job is restart-safe).
 */
export async function storePassage(
  client: TenantClient,
  input: { versionId: string; chunkIndex: number; content: string; embeddingModel: string },
): Promise<string> {
  if (!UUID_RE.test(input.versionId)) throw new RangeError('version id must be a uuid');
  if (!Number.isInteger(input.chunkIndex) || input.chunkIndex < 0) {
    throw new RangeError('chunk index must be an integer ≥ 0');
  }
  const content = input.content.trim();
  if (content.length === 0 || content.length > 4000) {
    throw new RangeError('content must be 1..4000 characters');
  }
  const model = checkVersion(input.embeddingModel);
  const done = await client.query<{ id: string }>(
    `insert into knowledge_passages (organisation_id, id, version_id, chunk_index, content, embedding_model)
     values (app.current_org(), $1::uuid, $2::uuid, $3::integer, $4::text, $5::text)
     on conflict (organisation_id, version_id, chunk_index) do update set content = excluded.content
     returning id::text`,
    [randomUUID(), input.versionId, input.chunkIndex, content, model],
  );
  const row = done.rows[0];
  if (row === undefined) throw new Error('passage store returned no row');
  return row.id;
}

/** List passage chunks for one approved version, chunk order. */
export async function passagesForVersion(
  client: TenantClient,
  versionId: string,
): Promise<readonly { chunkIndex: number; content: string; embeddingModel: string }[]> {
  if (!UUID_RE.test(versionId)) throw new RangeError('version id must be a uuid');
  const found = await client.query<{
    chunk_index: number;
    content: string;
    embedding_model: string;
  }>(
    `select chunk_index, content, embedding_model from knowledge_passages
     where organisation_id = app.current_org() and version_id = $1::uuid
     order by chunk_index`,
    [versionId],
  );
  return found.rows.map((row) => ({
    chunkIndex: row.chunk_index,
    content: row.content,
    embeddingModel: row.embedding_model,
  }));
}

/**
 * Notes and the facts schema registry (P07.09).
 *
 * Notes attach free text to exactly one parent (contact, task or lead), soft-delete only —
 * `moin_app` holds no DELETE, erasure runs privileged. Bodies never reach audit rows (INV-12):
 * audit carries parent-kind markers and counts, never content.
 *
 * Fact schemas are versioned JSON Schemas with German labels. The service enforces a deliberately
 * small subset (object root, declared `properties` with scalar/async types, `required` subset of
 * properties, `additionalProperties: false`, no `$ref`/`$defs`/`allOf`/`anyOf`/`oneOf`/`not`/
 * `if`/`then`/`else`/`dependentSchemas`/`patternProperties`) — enough for template facts, too
 * small for schema smuggling. Validation is hand-rolled (no new dependency): the subset is tiny
 * and a general validator would accept what this registry must refuse.
 */

import { randomUUID } from 'node:crypto';
import { appendAuditEvent } from './audit.ts';
import type { TenantClient } from './tenant.ts';

export type NoteParent = 'contact' | 'task' | 'lead';

/** Version conflicts surface as 409 at the HTTP layer. */
export class VersionConflictError extends Error {
  public override readonly name = 'VersionConflictError';
}

const PARENT_MARKER: Record<NoteParent, number> = { contact: 0, task: 1, lead: 2 };

export interface Note {
  readonly id: string;
  readonly parent: NoteParent;
  readonly parentId: string;
  readonly authorUserId: string | null;
  readonly body: string;
  readonly version: number;
}

interface NoteRow extends Record<string, unknown> {
  id: string;
  contact_id: string | null;
  task_id: string | null;
  lead_id: string | null;
  author_user_id: string | null;
  body: string;
  version: string;
}

function toNote(row: NoteRow): Note {
  const parent: NoteParent =
    row.contact_id !== null ? 'contact' : row.task_id !== null ? 'task' : 'lead';
  const parentId = row.contact_id ?? row.task_id ?? row.lead_id ?? '';
  return {
    id: row.id,
    parent,
    parentId,
    authorUserId: row.author_user_id,
    body: row.body,
    version: Number(row.version),
  };
}

function checkBody(body: string): string {
  const trimmed = body.trim();
  if (trimmed.length === 0 || trimmed.length > 4000) {
    throw new RangeError('note body must be 1..4000 characters');
  }
  return trimmed;
}

export async function createNote(
  client: TenantClient,
  input: {
    parent: NoteParent;
    parentId: string;
    authorUserId?: string | undefined;
    body: string;
  },
): Promise<Note> {
  const id = randomUUID();
  const body = checkBody(input.body);
  const author = input.authorUserId ?? null;
  const createSql: Record<NoteParent, string> = {
    contact: `insert into notes (organisation_id, id, contact_id, author_user_id, body)
     values (app.current_org(), $1, $2, $3, $4)
     returning id, contact_id, task_id, lead_id, author_user_id, body, version::text`,
    task: `insert into notes (organisation_id, id, task_id, author_user_id, body)
     values (app.current_org(), $1, $2, $3, $4)
     returning id, contact_id, task_id, lead_id, author_user_id, body, version::text`,
    lead: `insert into notes (organisation_id, id, lead_id, author_user_id, body)
     values (app.current_org(), $1, $2, $3, $4)
     returning id, contact_id, task_id, lead_id, author_user_id, body, version::text`,
  };
  const result = await client.query<NoteRow>(createSql[input.parent], [
    id,
    input.parentId,
    author,
    body,
  ]);
  const row = result.rows[0];
  if (row === undefined) throw new Error('note insert returned no row');
  await appendAuditEvent(client, {
    source: 'api',
    operation: 'note.create',
    targetKind: 'note',
    targetId: id,
    argsSanitized: { parent: PARENT_MARKER[input.parent] },
    result: 'succeeded',
  });
  return toNote(row);
}

/** Soft delete: sets deleted_at, bumps version. Missing or already-deleted rows 409. */
export async function deleteNote(
  client: TenantClient,
  noteId: string,
  version: number,
): Promise<void> {
  const moved = await client.query<{ id: string }>(
    `update notes set deleted_at = clock_timestamp(), updated_at = clock_timestamp(),
       version = version + 1
     where id = $1 and version = $2 and deleted_at is null
     returning id::text`,
    [noteId, version],
  );
  if (moved.rows[0] === undefined) {
    throw new VersionConflictError(`note ${noteId} missing, deleted or version mismatch`);
  }
  await appendAuditEvent(client, {
    source: 'api',
    operation: 'note.delete',
    targetKind: 'note',
    targetId: noteId,
    argsSanitized: { deleted: 1 },
    result: 'succeeded',
  });
}

export async function listNotes(
  client: TenantClient,
  input: { parent: NoteParent; parentId: string; limit?: number | undefined },
): Promise<Note[]> {
  const capped = Math.min(Math.max(input.limit ?? 50, 1), 100);
  const listSql: Record<NoteParent, string> = {
    contact: `select id, contact_id, task_id, lead_id, author_user_id, body, version::text
     from notes where contact_id = $1 and deleted_at is null
     order by created_at limit $2`,
    task: `select id, contact_id, task_id, lead_id, author_user_id, body, version::text
     from notes where task_id = $1 and deleted_at is null
     order by created_at limit $2`,
    lead: `select id, contact_id, task_id, lead_id, author_user_id, body, version::text
     from notes where lead_id = $1 and deleted_at is null
     order by created_at limit $2`,
  };
  const result = await client.query<NoteRow>(listSql[input.parent], [input.parentId, capped]);
  return result.rows.map(toNote);
}

// ---------------------------------------------------------------------------------------------
// Facts schema registry and validation (P07.09.02, P07.09.03).
// ---------------------------------------------------------------------------------------------

export interface FactSchema {
  readonly id: string;
  readonly template: string;
  readonly version: string;
  readonly schema: Record<string, unknown>;
  readonly labelsDe: Record<string, string>;
}

interface FactSchemaRow extends Record<string, unknown> {
  id: string;
  template: string;
  version: string;
  schema: Record<string, unknown>;
  labels_de: Record<string, string>;
}

const SCALAR_TYPES = new Set(['string', 'number', 'integer', 'boolean']);

const FORBIDDEN_KEYS = new Set([
  '$ref',
  '$defs',
  'definitions',
  '$dynamicRef',
  '$recursiveRef',
  'allOf',
  'anyOf',
  'oneOf',
  'not',
  'if',
  'then',
  'else',
  'dependentSchemas',
  'dependentRequired',
  'patternProperties',
  'propertyNames',
  'unevaluatedProperties',
  'unevaluatedItems',
]);

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Structural check of the registry subset; throws RangeError on anything outside it. */
export function checkFactSchemaShape(schema: unknown): asserts schema is Record<string, unknown> {
  if (!isObject(schema)) throw new RangeError('facts schema must be an object');
  if (schema['type'] !== 'object') throw new RangeError('facts schema root must be type object');
  const properties = schema['properties'];
  if (properties !== undefined && !isObject(properties)) {
    throw new RangeError('properties must be an object');
  }
  for (const key of Object.keys(schema)) {
    if (FORBIDDEN_KEYS.has(key)) throw new RangeError(`forbidden schema key: ${key}`);
  }
  if (properties !== undefined) {
    for (const [name, prop] of Object.entries(properties)) {
      if (!isObject(prop)) throw new RangeError(`property ${name} must be an object`);
      for (const key of Object.keys(prop)) {
        if (FORBIDDEN_KEYS.has(key)) throw new RangeError(`forbidden key in ${name}: ${key}`);
      }
      const type = prop['type'];
      if (!(typeof type === 'string' && SCALAR_TYPES.has(type))) {
        throw new RangeError(`property ${name} must declare a scalar type`);
      }
      if (prop['properties'] !== undefined || prop['items'] !== undefined) {
        throw new RangeError(`property ${name} must not nest (no properties/items)`);
      }
    }
  }
  const required = schema['required'];
  if (required !== undefined) {
    if (!Array.isArray(required) || required.some((r) => typeof r !== 'string')) {
      throw new RangeError('required must be string[]');
    }
    const props = isObject(properties) ? properties : {};
    const names = new Set(Object.keys(props));
    for (const r of required as string[]) {
      if (!names.has(r)) throw new RangeError(`required ${r} is not a declared property`);
    }
  }
  if (schema['additionalProperties'] !== false) {
    throw new RangeError('additionalProperties must be exactly false');
  }
}

export async function registerFactSchema(
  client: TenantClient,
  input: {
    template: string;
    version: string;
    schema: Record<string, unknown>;
    labelsDe?: Record<string, string> | undefined;
  },
): Promise<FactSchema> {
  const template = input.template.trim();
  if (template.length === 0 || template.length > 120) {
    throw new RangeError('template must be 1..120 characters');
  }
  if (!/^[a-z0-9][a-z0-9._-]{0,31}$/.test(input.version)) {
    throw new RangeError('version must match the registry pattern');
  }
  checkFactSchemaShape(input.schema);
  const labels = input.labelsDe ?? {};
  for (const [field, label] of Object.entries(labels)) {
    if (typeof label !== 'string' || label.trim().length === 0 || label.length > 120) {
      throw new RangeError(`label for ${field} must be 1..120 characters`);
    }
  }
  const id = randomUUID();
  const result = await client.query<FactSchemaRow>(
    `insert into fact_schemas (organisation_id, id, template, version, schema, labels_de)
     values (app.current_org(), $1, $2, $3, $4, $5)
     returning id, template, version, schema, labels_de`,
    [id, template, input.version, JSON.stringify(input.schema), JSON.stringify(labels)],
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error('schema insert returned no row');
  return {
    id: row.id,
    template: row.template,
    version: row.version,
    schema: row.schema,
    labelsDe: row.labels_de,
  };
}

/** Validate a payload against the schema its version declares. Returns the verdict. */
export async function validateFacts(
  client: TenantClient,
  template: string,
  version: string,
  payload: unknown,
): Promise<{ valid: boolean; errors: string[] }> {
  const found = await client.query<FactSchemaRow>(
    `select id, template, version, schema, labels_de from fact_schemas
     where template = $1 and version = $2`,
    [template, version],
  );
  const row = found.rows[0];
  if (row === undefined) return { valid: false, errors: ['unknown schema version'] };
  const errors = checkPayload(row.schema, payload);
  await appendAuditEvent(client, {
    source: 'api',
    operation: 'facts.validate',
    targetKind: 'fact_schema',
    targetId: row.id,
    argsSanitized: { valid: errors.length === 0 ? 1 : 0 },
    result: 'succeeded',
  });
  return { valid: errors.length === 0, errors };
}

function checkPayload(schema: Record<string, unknown>, payload: unknown): string[] {
  if (!isObject(payload)) return ['payload must be an object'];
  const errors: string[] = [];
  const properties = (schema['properties'] ?? {}) as Record<string, unknown>;
  for (const [name, prop] of Object.entries(properties)) {
    const spec = prop as Record<string, unknown>;
    const value = payload[name];
    if (value === undefined) continue;
    const type = spec['type'];
    if (type === 'string' && typeof value !== 'string') errors.push(`${name} must be a string`);
    else if (type === 'number' && typeof value !== 'number')
      errors.push(`${name} must be a number`);
    else if (type === 'integer' && !(typeof value === 'number' && Number.isInteger(value))) {
      errors.push(`${name} must be an integer`);
    } else if (type === 'boolean' && typeof value !== 'boolean') {
      errors.push(`${name} must be a boolean`);
    }
  }
  for (const name of Object.keys(payload)) {
    if (!Object.hasOwn(properties, name)) errors.push(`undeclared field ${name}`);
  }
  const required = schema['required'];
  if (Array.isArray(required)) {
    for (const name of required as string[]) {
      if (payload[name] === undefined) errors.push(`missing required ${name}`);
    }
  }
  return errors;
}

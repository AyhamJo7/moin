import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { schemaColumns, unclassified } from './check-data-classification.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = resolve(HERE, '__fixtures__', 'classification');
const INVENTORY = resolve(HERE, '..', 'docs', 'privacy', 'data-inventory.md');

describe('data classification check (QG-12)', () => {
  it('reads columns out of a migration', () => {
    const columns = schemaColumns(FIXTURES);
    expect(columns.map((c) => c.column)).toContain('display_name');
    expect(columns.map((c) => c.column)).toContain('secret_nickname');
  });

  it('ignores constraints, which are not columns', () => {
    expect(schemaColumns(FIXTURES).map((c) => c.column)).not.toContain('PRIMARY');
  });

  // The whole point: a column nobody classified must fail, because an erasure request would
  // otherwise miss it and nothing would say so.
  it('flags a column the inventory has never seen', () => {
    const missing = unclassified(FIXTURES, INVENTORY).map((c) => `${c.table}.${c.column}`);
    expect(missing).toContain('contacts.secret_nickname');
  });

  it('accepts a column the inventory does classify', () => {
    const missing = unclassified(FIXTURES, INVENTORY).map((c) => `${c.table}.${c.column}`);
    expect(missing).not.toContain('contacts.display_name');
  });

  it('treats keys and timestamps as structural rather than unclassified', () => {
    const missing = unclassified(FIXTURES, INVENTORY).map((c) => c.column);
    for (const structural of ['id', 'organisation_id', 'created_at']) {
      expect(missing).not.toContain(structural);
    }
  });

  it('passes on the real schema', () => {
    expect(unclassified()).toStrictEqual([]);
  });
});

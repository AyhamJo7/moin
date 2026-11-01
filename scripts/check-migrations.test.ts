import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { HAND_WRITTEN_RLS_GRANDFATHERED, checkDirectory, checkSql } from './check-migrations.ts';

const FIXTURES = resolve(dirname(fileURLToPath(import.meta.url)), '__fixtures__', 'migrations');

function rules(sql: string): string[] {
  return checkSql('x.sql', sql).map((finding) => finding.rule);
}

describe('migration safety check (QG-08, INV-17)', () => {
  it('rejects statements that break the previous release during a rolling deploy', () => {
    expect(rules('ALTER TABLE contacts DROP COLUMN legacy_phone;')).toContain('drop-column');
    expect(rules('DROP TABLE contacts;')).toContain('drop-table');
    expect(rules('ALTER TABLE contacts RENAME COLUMN phone TO phone_e164;')).toContain('rename');
    expect(rules('TRUNCATE contacts;')).toContain('truncate');
  });

  it('rejects statements that take a heavy lock when an online alternative exists', () => {
    expect(rules('CREATE INDEX idx ON contacts (phone);')).toContain('create-index-blocking');
    expect(rules('ALTER TABLE tasks ADD COLUMN x uuid NOT NULL;')).toContain(
      'drop-not-null-column-add',
    );
    expect(
      rules('ALTER TABLE t ADD CONSTRAINT fk FOREIGN KEY (c) REFERENCES contacts (id);'),
    ).toContain('add-foreign-key-validated');
    expect(rules('ALTER TABLE t ADD CONSTRAINT ck CHECK (n > 0);')).toContain(
      'add-check-validated',
    );
    expect(rules('ALTER TABLE contacts ALTER COLUMN phone TYPE text;')).toContain(
      'alter-column-type',
    );
  });

  it('accepts the online alternatives', () => {
    expect(rules('CREATE INDEX CONCURRENTLY idx ON contacts (phone);')).toStrictEqual([]);
    expect(rules('ALTER TABLE contacts ADD COLUMN preferred_language text;')).toStrictEqual([]);
    expect(
      rules('ALTER TABLE t ADD CONSTRAINT fk FOREIGN KEY (c) REFERENCES contacts (id) NOT VALID;'),
    ).toStrictEqual([]);
    expect(rules("ALTER TABLE tasks ADD COLUMN x text NOT NULL DEFAULT 'a';")).toStrictEqual([]);
  });

  // A checker that fires on its own documentation trains people to ignore it.
  it('does not fire on a comment that merely mentions a destructive statement', () => {
    expect(rules('-- we will DROP COLUMN legacy_phone later\nSELECT 1;')).toStrictEqual([]);
    expect(rules('/* TRUNCATE is never allowed here */\nSELECT 1;')).toStrictEqual([]);
  });

  // The escape hatch requires a reason on the same line, so a reviewer sees a claim they can
  // check rather than a flag that becomes a reflex.
  it('allows an exception only when it states why', () => {
    const withReason =
      '-- migration-check: allow drop-column because the expand half shipped in v0.4.0\n' +
      'ALTER TABLE contacts DROP COLUMN legacy_phone;';
    expect(rules(withReason)).toStrictEqual([]);

    const withoutReason =
      '-- migration-check: allow drop-column\nALTER TABLE contacts DROP COLUMN legacy_phone;';
    expect(rules(withoutReason)).toContain('drop-column');
  });

  it('rejects a filename that does not encode an order', () => {
    const findings = checkDirectory(FIXTURES);
    expect(findings.some((f) => f.file === 'bad_name.sql' && f.rule === 'filename')).toBe(true);
  });

  it('finds every violating fixture and none of the safe ones', () => {
    const findings = checkDirectory(FIXTURES);
    const flagged = new Set(findings.map((f) => f.file));
    for (const file of [
      '0001_drop_column.sql',
      '0002_blocking_index.sql',
      '0003_not_null_no_default.sql',
      '0004_validated_fk.sql',
      '0005_alter_type.sql',
      '0006_rename.sql',
    ]) {
      expect(flagged, `${file} must be flagged`).toContain(file);
    }
    for (const file of ['0007_allowed_drop.sql', '0008_safe.sql', '0009_concurrent_index.sql']) {
      expect(flagged, `${file} must not be flagged`).not.toContain(file);
    }
  });

  it('passes on the repository’s own migrations', () => {
    expect(
      checkDirectory(resolve(FIXTURES, '..', '..', '..', 'packages', 'db', 'migrations')),
    ).toStrictEqual([]);
  });
});

describe('tenant row-level security goes through app.apply_tenant_rls (F6)', () => {
  const HAND_WRITTEN = `CREATE TABLE widgets (
  organisation_id uuid NOT NULL REFERENCES organisations (id),
  id uuid NOT NULL PRIMARY KEY,
  UNIQUE (organisation_id, id)
);
ALTER TABLE widgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE widgets FORCE ROW LEVEL SECURITY;
CREATE POLICY widgets_tenant ON widgets USING (organisation_id = app.current_org());`;

  const WITH_HELPER = `CREATE TABLE widgets (
  organisation_id uuid NOT NULL REFERENCES organisations (id),
  id uuid NOT NULL PRIMARY KEY,
  UNIQUE (organisation_id, id)
);
SELECT app.apply_tenant_rls('widgets');`;

  it('rejects a new migration that writes the policy by hand', () => {
    expect(checkSql('0100_widgets.sql', HAND_WRITTEN).map((f) => f.rule)).toStrictEqual([
      'tenant-rls-not-via-helper',
    ]);
  });

  it('rejects a tenant table that never reaches the helper', () => {
    const forgotten = WITH_HELPER.replace("SELECT app.apply_tenant_rls('widgets');", 'SELECT 1;');
    const findings = checkSql('0100_widgets.sql', forgotten);
    expect(findings.map((f) => f.rule)).toStrictEqual(['tenant-rls-not-via-helper']);
    expect(findings[0]?.detail).toContain('widgets');
  });

  it('accepts the helper, a table with no tenant column, and a reasoned opt-out', () => {
    expect(checkSql('0100_widgets.sql', WITH_HELPER)).toStrictEqual([]);
    expect(checkSql('0100_plain.sql', 'CREATE TABLE plain (id uuid PRIMARY KEY);')).toStrictEqual(
      [],
    );
    const reasoned = `-- migration-check: allow tenant-rls-not-via-helper because the policy joins a second table\n${HAND_WRITTEN}`;
    expect(checkSql('0100_widgets.sql', reasoned)).toStrictEqual([]);
  });

  it('does not fire on a comment, a foreign-key column list or a NO FORCE toggle', () => {
    const toggle = `-- ENABLE ROW LEVEL SECURITY is done by the helper
CREATE TABLE gadgets (
  organisation_id uuid NOT NULL REFERENCES organisations (id),
  id uuid NOT NULL PRIMARY KEY,
  FOREIGN KEY (organisation_id, id) REFERENCES widgets (organisation_id, id)
);
SELECT app.apply_tenant_rls('gadgets');
ALTER TABLE gadgets NO FORCE ROW LEVEL SECURITY;
ALTER TABLE gadgets FORCE ROW LEVEL SECURITY;`;
    expect(checkSql('0100_gadgets.sql', toggle)).toStrictEqual([]);
  });

  it('grandfathers exactly the twelve older migrations that cover fourteen tables, by name', () => {
    expect(Object.keys(HAND_WRITTEN_RLS_GRANDFATHERED)).toHaveLength(12);
    expect(Object.values(HAND_WRITTEN_RLS_GRANDFATHERED).flat()).toHaveLength(14);
    // The same text under a grandfathered name passes; under any other name it is a finding.
    expect(checkSql('0062_job_envelope.sql', HAND_WRITTEN)).toStrictEqual([]);
    expect(checkSql('0079_job_envelope.sql', HAND_WRITTEN)).toHaveLength(1);
  });
});

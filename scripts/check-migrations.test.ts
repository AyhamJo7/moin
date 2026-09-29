import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkDirectory, checkSql } from './check-migrations.ts';

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

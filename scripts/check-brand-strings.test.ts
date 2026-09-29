import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { brandName, scan } from './check-brand-strings.ts';

/** A miniature repository: a brand configuration and whatever source files a case needs. */
function fakeRepo(files: Record<string, string>, brand = 'KlarDesk'): string {
  const root = mkdtempSync(join(tmpdir(), 'brand-'));
  writeFileSync(join(root, '.env.example'), `NEXT_PUBLIC_BRAND_NAME=${brand}\n`, 'utf8');
  for (const [path, content] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, content, 'utf8');
  }
  return root;
}

describe('the real repository', () => {
  it('has no brand literal and no codename in customer-facing text', () => {
    expect(scan()).toStrictEqual([]);
  });

  // The check reads the name from the configuration it protects, so renaming the brand renames
  // what the check looks for. A hard-coded list would pass forever after a rename.
  it('takes the brand name from the configuration', () => {
    expect(brandName()).toBe('KlarDesk');
  });
});

describe('rule A — the brand name is not a literal in source', () => {
  it('catches it in a package', () => {
    const root = fakeRepo({ 'packages/ui/src/header.ts': "export const title = 'KlarDesk';\n" });
    expect(scan(root)).toStrictEqual([
      {
        file: join('packages', 'ui', 'src', 'header.ts'),
        line: 1,
        rule: 'brand-literal',
        text: "export const title = 'KlarDesk';",
      },
    ]);
  });

  it('catches it whatever the casing, because a greeting may lower-case it', () => {
    const root = fakeRepo({ 'apps/web/app/page.tsx': "const a = 'klardesk';\n" });
    expect(scan(root).map((v) => v.rule)).toContain('brand-literal');
  });

  it('follows a rename: after the configuration changes, the old name is fine and the new one is not', () => {
    const files = {
      'packages/ui/src/a.ts': "const old = 'KlarDesk';\n",
      'packages/ui/src/b.ts': "const next = 'Telefonheld';\n",
    };
    const renamed = scan(fakeRepo(files, 'Telefonheld'));
    expect(renamed).toHaveLength(1);
    expect(renamed[0]?.file).toBe(join('packages', 'ui', 'src', 'b.ts'));
  });

  it('passes source that reads the name from configuration', () => {
    const root = fakeRepo({
      'apps/web/app/page.tsx': "const title = process.env['NEXT_PUBLIC_BRAND_NAME'];\n",
    });
    expect(scan(root)).toStrictEqual([]);
  });
});

describe('rule B — the codename never reaches a customer', () => {
  it('catches the codename in a customer-facing string', () => {
    const root = fakeRepo({ 'apps/web/app/page.tsx': "const hello = 'Willkommen bei moin';\n" });
    expect(scan(root).map((v) => v.rule)).toStrictEqual(['codename-in-customer-text']);
  });

  // A template has no string literals: its whole body is the text. The first version of this
  // check looked for quotes and passed this file, which is the exact case the rule is for.
  it('catches it in a template, where the text is not inside quotes', () => {
    const root = fakeRepo({ 'templates/welcome.html': '<p>Ihr Team von Moin</p>\n' });
    expect(scan(root)).toStrictEqual([
      {
        file: join('templates', 'welcome.html'),
        line: 1,
        rule: 'codename-in-customer-text',
        text: '<p>Ihr Team von Moin</p>',
      },
    ]);
  });

  it('leaves a template that names no brand alone', () => {
    const root = fakeRepo({ 'templates/welcome.html': '<p>Guten Tag</p>\n' });
    expect(scan(root)).toStrictEqual([]);
  });

  it('leaves the package scope alone', () => {
    const root = fakeRepo({
      'apps/web/app/page.tsx': "import { Clock } from '@moin/kernel';\nexport const x = 1;\n",
    });
    expect(scan(root)).toStrictEqual([]);
  });

  // Internal is internal: a log field, a service name, a container name may all say `moin`.
  it('leaves the codename alone outside customer-facing trees', () => {
    const root = fakeRepo({ 'packages/observability/src/logger.ts': "const service = 'moin';\n" });
    expect(scan(root)).toStrictEqual([]);
  });
});

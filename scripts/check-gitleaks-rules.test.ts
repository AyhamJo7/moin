import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { check, loadRule } from './check-gitleaks-rules.ts';

describe("the repository's own gitleaks rule", () => {
  it('behaves as its examples say it must', () => {
    const result = check();
    expect(result.failures).toStrictEqual([]);
    expect(result.checked).toBeGreaterThanOrEqual(10);
  });

  it('is loaded from the configuration rather than restated here', () => {
    const rule = loadRule();
    expect(rule.id).toBe('moin-env-example-must-stay-fake');
    expect(rule.allowlist.length).toBeGreaterThanOrEqual(4);
  });
});

function configWith(regex: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'gitleaks-rule-'));
  const path = join(dir, '.gitleaks.toml');
  writeFileSync(
    path,
    [
      '[[rules]]',
      'id = "moin-env-example-must-stay-fake"',
      `regex = '''${regex}'''`,
      "path = '''\\.env\\.example$'''",
      '',
      '  [rules.allowlist]',
      '  regexTarget = "line"',
      '  regexes = [',
      "    '''local-development-only''',",
      "    '''\\$\\{''',",
      "    '''_SECRET_ARN''',",
      "    '''^[ \\t]*#''',",
      '  ]',
      '',
    ].join('\n'),
    'utf8',
  );
  return path;
}

const NAMES =
  '(TWILIO_AUTH_TOKEN|OPENAI_API_KEY|STRIPE_SECRET_KEY|STRIPE_WEBHOOK_SECRET|AWS_SECRET_ACCESS_KEY|GOOGLE_OAUTH_CLIENT_SECRET|MICROSOFT_GRAPH_CLIENT_SECRET)';

describe('what the self-test catches', () => {
  // The defect itself. gitleaks applies a rule to the whole file, so a bare `^` anchors to the
  // start of the file — and in a real example file these variables are never on line 1.
  it('fails a rule anchored without the multiline flag', () => {
    const path = configWith(`(?i)^[ \\t]*${NAMES}[ \\t]*=[ \\t]*\\S{12,}`);
    const result = check(path);
    expect(result.failures.length).toBeGreaterThan(0);
    expect(result.failures.join('\n')).toContain('`m` flag');
  });

  it('passes the same rule once the flag is there', () => {
    const path = configWith(`(?im)^[ \\t]*${NAMES}[ \\t]*=[ \\t]*\\S{12,}`);
    expect(check(path).failures).toStrictEqual([]);
  });

  // A rule that catches everything is as useless as one that catches nothing: it gets allowlisted
  // wholesale within a week.
  it('fails a rule that also flags the permitted development placeholder', () => {
    const path = configWith(`(?im)^[ \\t]*${NAMES}[ \\t]*=[ \\t]*\\S+`);
    const result = check(path);
    expect(result.failures.join('\n')).toContain('should be permitted but was caught');
  });

  it('fails loudly when the rule has been renamed or removed', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gitleaks-rule-'));
    const path = join(dir, '.gitleaks.toml');
    writeFileSync(path, '[[rules]]\nid = "something-else"\n', 'utf8');
    expect(() => check(path)).toThrow(/no longer defines a rule/u);
  });

  it('fails loudly when the allowlist is gone', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gitleaks-rule-'));
    const path = join(dir, '.gitleaks.toml');
    writeFileSync(
      path,
      ['[[rules]]', 'id = "moin-env-example-must-stay-fake"', "regex = '''(?im)^x'''", ''].join(
        '\n',
      ),
      'utf8',
    );
    expect(() => check(path)).toThrow(/no \[rules\.allowlist\]/u);
  });
});

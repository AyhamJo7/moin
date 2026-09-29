/**
 * The repository's own secret-scanning rules, self-tested (P02.06.07 follow-up).
 *
 * ## Why this file exists
 *
 * `.gitleaks.toml` extends the stock ruleset with one rule of our own,
 * `moin-env-example-must-stay-fake`, because the stock rules do not know which variable names
 * matter in this repository. **That rule never fired.** Its pattern was anchored `(?i)^…`, and
 * gitleaks applies a rule's regex to the whole file rather than line by line, so `^` anchored to
 * the start of the *file* while the variables it names sit near the bottom of a 90-line example.
 *
 * It was found by the P02.06.07 negative control — a deliberately planted fake credential — and
 * not by reading. The scan was green, the rule looked right, and the only thing that distinguished
 * "working" from "dead" was a value it was supposed to catch.
 *
 * So the rule now has executable examples, in the same shape as `check-no-ai-mentions.ts`: lines
 * it must reject, lines it must accept, and at least one of each **below the first line**, which is
 * the case that was broken. A rule that has never matched anything is not a rule.
 *
 * ## Why the TOML is parsed narrowly rather than properly
 *
 * Node has no built-in TOML parser and this check is not worth a dependency in the supply chain it
 * exists to protect. It extracts exactly two things by pattern — the rule's `regex` and its
 * allowlist's `regexes` — and fails loudly if either is missing, so a restructured file produces an
 * error rather than a silent pass.
 *
 *   node scripts/check-gitleaks-rules.ts
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { toJsRegExp } from './policy-regex.ts';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG = join(REPO_ROOT, '.gitleaks.toml');

const RULE_ID = 'moin-env-example-must-stay-fake';

/** A `key = '''…'''` assignment. Non-greedy, so the first closing delimiter ends it. */
function tripleQuoted(source: string, key: string): string | undefined {
  return new RegExp(`^\\s*${key}\\s*=\\s*'''([\\s\\S]*?)'''`, 'm').exec(source)?.[1];
}

export interface CustomRule {
  readonly id: string;
  readonly regex: RegExp;
  readonly allowlist: readonly RegExp[];
}

export function loadRule(configPath: string = CONFIG, id: string = RULE_ID): CustomRule {
  const text = readFileSync(configPath, 'utf8');
  const start = text.indexOf(`id = "${id}"`);
  if (start === -1) {
    throw new Error(`.gitleaks.toml no longer defines a rule with id "${id}"`);
  }
  const block = text.slice(start);

  const pattern = tripleQuoted(block, 'regex');
  if (pattern === undefined) {
    throw new Error(`rule ${id} has no regex, or it is not written as a ''' literal`);
  }

  const allowlistStart = block.indexOf('[rules.allowlist]');
  if (allowlistStart === -1) {
    throw new Error(`rule ${id} has no [rules.allowlist]; the placeholders it permits are missing`);
  }
  const allowlistBlock = block.slice(allowlistStart);
  // The array is terminated by a line that is only `]`, not by the first `]` in the text: one of
  // the permitted placeholders is `^[ \t]*#`, whose character class closes a bracket. Bounding on
  // the first `]` silently dropped it, and the tests below caught that before it mattered.
  const listStart = allowlistBlock.indexOf('regexes');
  if (listStart === -1) {
    throw new Error(`rule ${id}'s allowlist has no regexes`);
  }
  const afterBracket = allowlistBlock.slice(listStart);
  const openIndex = afterBracket.indexOf('[');
  if (openIndex === -1) {
    throw new Error(`rule ${id}'s allowlist regexes is not an array`);
  }
  const body = afterBracket.slice(openIndex + 1);
  const terminator = /^[ \t]*\][ \t]*$/m.exec(body);
  if (terminator === null) {
    throw new Error(
      `rule ${id}'s allowlist array is not closed by a line containing only "]"; ` +
        'this check expects one entry per line',
    );
  }
  const listBody = body.slice(0, terminator.index);
  const allowlist = [...listBody.matchAll(/'''([\s\S]*?)'''/g)].map((m, index) =>
    toJsRegExp(m[1] ?? '', `${id}.allowlist[${String(index)}]`),
  );

  return { id, regex: toJsRegExp(pattern, id), allowlist };
}

/** A line the rule must reject, or must leave alone. Each is scanned inside a realistic file. */
interface Example {
  readonly line: string;
  readonly blocked: boolean;
  readonly why: string;
}

/**
 * A value long enough to trip the rule's `\S{12,}` threshold, built rather than written down.
 *
 * Writing a realistic-looking token here would be writing a credential-shaped literal into the
 * repository — which is the thing this whole rule exists to prevent, and which the stock
 * `generic-api-key` rule correctly flagged in the first version of this file. The rule under test
 * cares only about the variable name and the length, so a low-entropy placeholder exercises it
 * exactly as a realistic value would, and nothing here can ever be mistaken for a real key.
 */
function placeholder(length: number): string {
  return 'placeholder-value-'.repeat(Math.ceil(length / 18)).slice(0, length);
}

const EXAMPLES: readonly Example[] = [
  {
    line: `TWILIO_AUTH_TOKEN=${placeholder(36)}`,
    blocked: true,
    why: 'a pasted-looking Twilio token',
  },
  {
    line: `OPENAI_API_KEY=${placeholder(48)}`,
    blocked: true,
    why: 'a pasted-looking OpenAI key',
  },
  {
    line: `  STRIPE_SECRET_KEY\t=\t${placeholder(30)}`,
    blocked: true,
    why: 'padding around the name and the equals sign must not smuggle it past',
  },
  {
    line: `AWS_SECRET_ACCESS_KEY=${placeholder(40)}`,
    blocked: true,
    why: 'an AWS secret access key',
  },
  {
    line: 'TWILIO_AUTH_TOKEN=local-development-only',
    blocked: false,
    why: 'the one permitted development placeholder',
  },
  {
    line: `# TWILIO_AUTH_TOKEN=${placeholder(36)}`,
    blocked: false,
    why: 'a commented-out line is documentation, not a configured value',
  },
  {
    line: 'TWILIO_AUTH_TOKEN_SECRET_ARN=arn:aws:secretsmanager:eu-central-1:1:secret:x',
    blocked: false,
    why: 'an ARN is a reference, which is what INV-15 asks for',
  },
  {
    line: 'TWILIO_AUTH_TOKEN=${TWILIO_AUTH_TOKEN}',
    blocked: false,
    why: 'an interpolation carries no value',
  },
  {
    line: 'SERVICE_NAME=moin',
    blocked: false,
    why: 'not a credential variable',
  },
  {
    line: 'TWILIO_AUTH_TOKEN=short',
    blocked: false,
    why: 'below the length threshold; too short to be a real token',
  },
];

/**
 * Builds a file around a line, with the line **below the first**.
 *
 * This is the whole point. The rule matched only a first-line value for as long as it existed,
 * and every real example file has its provider variables near the bottom.
 */
function fileAround(line: string): string {
  return [
    '# Local development environment',
    'NODE_ENV=development',
    'PORT=3000',
    '',
    line,
    '',
    'LOG_LEVEL=debug',
    '',
  ].join('\n');
}

export interface RuleCheck {
  readonly failures: string[];
  readonly checked: number;
}

/** Applies the rule the way gitleaks does: to the whole file, then the allowlist to the hit. */
function matches(rule: CustomRule, content: string): string | undefined {
  rule.regex.lastIndex = 0;
  const hit = rule.regex.exec(content)?.[0];
  if (hit === undefined) {
    return undefined;
  }
  // gitleaks applies a rule-scoped allowlist with regexTarget = "line" to the matched line.
  const line = content.split('\n').find((candidate) => candidate.includes(hit.trimStart())) ?? hit;
  return rule.allowlist.some((allowed) => {
    allowed.lastIndex = 0;
    return allowed.test(line);
  })
    ? undefined
    : hit;
}

export function check(configPath?: string): RuleCheck {
  const rule = loadRule(configPath);
  const failures: string[] = [];

  for (const example of EXAMPLES) {
    const hit = matches(rule, fileAround(example.line));
    if (example.blocked && hit === undefined) {
      failures.push(`should be caught but was not (${example.why}): ${example.line}`);
    }
    if (!example.blocked && hit !== undefined) {
      failures.push(`should be permitted but was caught (${example.why}): ${example.line}`);
    }
  }

  // The defect this check was written for, asserted directly rather than inferred from the set.
  const blockedExample = EXAMPLES.find((e) => e.blocked);
  if (blockedExample !== undefined) {
    const firstLineOnly = matches(rule, blockedExample.line);
    const belowFirstLine = matches(rule, fileAround(blockedExample.line));
    if (firstLineOnly !== undefined && belowFirstLine === undefined) {
      failures.push(
        'the rule matches only on the first line of a file: gitleaks scans whole files, ' +
          'so the pattern needs the `m` flag — this is the defect the P02.06.07 control found',
      );
    }
  }

  return { failures, checked: EXAMPLES.length };
}

function main(): number {
  let result: RuleCheck;
  try {
    result = check();
  } catch (error) {
    console.error(`gitleaks rule check could not run: ${String(error)}`);
    return 1;
  }

  if (result.failures.length > 0) {
    console.error(`Custom gitleaks rule "${RULE_ID}" does not behave as intended:`);
    for (const failure of result.failures) console.error(`  - ${failure}`);
    console.error('');
    return 1;
  }
  console.log(
    `gitleaks rules: "${RULE_ID}" self-test passed, ${String(result.checked)} executable examples.`,
  );
  return 0;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}

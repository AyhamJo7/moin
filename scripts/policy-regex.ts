/**
 * Translate the Python `re` patterns in `.claude/policy/no-ai-mentions.json` into JavaScript
 * `RegExp` objects.
 *
 * The policy file is the single source of truth for A-22 and is founder-owned: it is read, never
 * rewritten to suit this script. Python and JavaScript regex syntax overlap almost completely for
 * the constructs the policy uses; the two that differ are handled here.
 *
 *   - Inline flag groups. Python writes `(?i)` / `(?im)` at the start of a pattern; JavaScript has
 *     no inline flag syntax and takes flags as a separate argument.
 *   - Astral escapes. Python writes `\U0001F916`; JavaScript writes `\u{1F916}` and needs the `u`
 *     flag to read it as one code point.
 *
 * Anything else the policy might grow (named groups, lookbehind, character classes) is already
 * compatible, and an incompatible pattern fails loudly at load time rather than silently matching
 * nothing — a policy that quietly stops matching is worse than one that refuses to load.
 */

const INLINE_FLAGS = /^\(\?([aimsux]+)\)/;
const ASTRAL_ESCAPE = /\\U([0-9A-Fa-f]{8})/g;

export interface PolicyPattern {
  readonly id: string;
  readonly regex: string;
  readonly why: string;
}

export interface Policy {
  readonly patterns: readonly PolicyPattern[];
  readonly block_examples: readonly string[];
  readonly allow_examples: readonly string[];
}

export interface CompiledPattern {
  readonly id: string;
  readonly why: string;
  readonly regex: RegExp;
}

/** Python `re` pattern source and flags -> a JavaScript RegExp. */
export function toJsRegExp(source: string, id: string): RegExp {
  let body = source;
  const flags = new Set<string>();

  const inline = INLINE_FLAGS.exec(body);
  if (inline?.[1] !== undefined) {
    body = body.slice(inline[0].length);
    for (const flag of inline[1]) {
      // `x` (verbose) and `a` (ASCII) have no JavaScript equivalent; the policy does not use them.
      if (flag === 'i' || flag === 'm' || flag === 's' || flag === 'u') {
        flags.add(flag);
      } else {
        throw new Error(`pattern ${id}: inline flag (?${flag}) has no JavaScript equivalent`);
      }
    }
  }

  if (ASTRAL_ESCAPE.test(body)) {
    ASTRAL_ESCAPE.lastIndex = 0;
    body = body.replace(ASTRAL_ESCAPE, (_match, hex: string) => `\\u{${hex.replace(/^0+/, '')}}`);
    flags.add('u');
  }

  try {
    return new RegExp(body, [...flags].join(''));
  } catch (cause) {
    throw new Error(
      `pattern ${id} is not usable as a JavaScript regular expression: ${String(cause)}`,
      {
        cause,
      },
    );
  }
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isPatternArray(value: unknown): value is PolicyPattern[] {
  return (
    Array.isArray(value) &&
    value.every((item): boolean => {
      if (typeof item !== 'object' || item === null) return false;
      const record = item as Record<string, unknown>;
      return (
        typeof record['id'] === 'string' &&
        typeof record['regex'] === 'string' &&
        typeof record['why'] === 'string'
      );
    })
  );
}

/**
 * Validate the parsed policy file. This is a trust boundary: the file is founder-owned and
 * machine-read, so a malformed one must stop the check rather than silently produce a checker
 * that matches nothing.
 */
export function parsePolicy(raw: unknown): Policy {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('policy file is not an object');
  }
  const record = raw as Record<string, unknown>;
  if (!isPatternArray(record['patterns']) || record['patterns'].length === 0) {
    throw new Error(
      'policy contains no usable patterns — refusing to run a check that can never fail',
    );
  }
  if (!isStringArray(record['block_examples']) || !isStringArray(record['allow_examples'])) {
    throw new Error('policy is missing its executable block_examples / allow_examples');
  }
  return {
    patterns: record['patterns'],
    block_examples: record['block_examples'],
    allow_examples: record['allow_examples'],
  };
}

export function compile(policy: Policy): CompiledPattern[] {
  return policy.patterns.map((p) => ({ id: p.id, why: p.why, regex: toJsRegExp(p.regex, p.id) }));
}

/** Every pattern that matches `text`. */
export function violations(text: string, patterns: readonly CompiledPattern[]): CompiledPattern[] {
  return patterns.filter((p) => p.regex.test(text));
}

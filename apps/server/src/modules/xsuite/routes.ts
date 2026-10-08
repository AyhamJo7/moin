/**
 * Reconstruct served routes from Fastify's `printRoutes` tree (P06.13.02).
 *
 * The printer emits a compressed radix tree: each line is `branch-marker + label +
 * optional ' (METHOD, …)' suffix`. Labels are radix FRAGMENTS, not path segments —
 * shared prefixes collapse mid-word (`invit` + `e`, `s` + `tep-up`), and a trailing
 * slash (`support/`, `ations/`, `/`) marks a fragment that continues deeper.
 *
 * Reconstruction keeps a stack of `{ path, fragment }` per tree level, where `depth`
 * is one per 4-char indent group (`│   ` and `    ` are both one level — the bar
 * occupies a slot in its group, so counting bars separately double-counts):
 *
 * - pop the stack to the parent depth, then join: a child of an UNTERMINATED
 *   fragment (methodless, no trailing slash) concatenates DIRECTLY (`s`+`tep-up`,
 *   `invit`+`e`); otherwise slash-join with `//` collapse (`:id`+`/revoke`).
 * - a label WITH methods emits one `METHOD path` row per method (minus HEAD/OPTIONS:
 *   Nest/Fastify adorn every GET with HEAD automatically; they are not routes) and
 *   pushes a terminated node; a label WITHOUT methods pushes an unterminated
 *   fragment and emits nothing.
 * - the root `/` line resets the stack.
 *
 * Version-sensitive by construction: an empty reconstruction fails the coverage test
 * rather than passing vacuously, and a format change that parses differently fails
 * the set comparison loudly.
 */

const LINE = /^([│\s]*)(?:[├└]── )?(.*?)(?:\s+\(([A-Z, ]+)\))?\s*$/;

function depthOf(prefix: string): number {
  return Math.floor(prefix.length / 4);
}

interface StackNode {
  readonly path: string;
  /** True while the path may still grow by direct concatenation (radix fragment). */
  readonly fragment: boolean;
}

export function reconstructRoutes(printed: string): Set<string> {
  const served = new Set<string>();
  const stack: StackNode[] = [];
  for (const line of printed.split('\n')) {
    if (line.trim() === '') continue;
    const match = LINE.exec(line);
    if (match === null) continue;
    const depth = depthOf(match[1] ?? '');
    const label = (match[2] ?? '').trim();
    if (label === '/' && depth === 0) {
      stack.length = 0;
      stack.push({ path: '', fragment: false });
      continue;
    }
    while (stack.length > depth) stack.pop();
    const top = stack[stack.length - 1] ?? null;
    const parent = top;
    const base = parent?.path ?? '';
    // A methodless label WITHOUT a trailing slash is a radix fragment ONLY when a
    // deeper line continues it (direct concat). A parametric segment (`:id`) or any
    // label whose next sibling-or-deeper line does not extend it is a complete
    // segment — but "continues it" is known only in hindsight. Rule that works both
    // ways: `:params` and `/`-leading labels are always complete segments
    // (slash-join); other methodless labels are fragments (direct concat). The
    // printer splits mid-word (`invit`+`e`) but never splits AT a `/` or `:` boundary
    // except into complete segments.
    const completeSegment = label.startsWith(':') || label.startsWith('/');
    let joined: string;
    if (parent?.fragment === true && !completeSegment) {
      joined = `${base}${label}`;
    } else if (base === '') {
      joined = `/${label.replace(/^\//, '')}`;
    } else {
      joined = `${base}${label.startsWith('/') || base.endsWith('/') ? '' : '/'}${label}`;
    }
    const full = joined.replace(/([^:])\/\//g, '$1/');
    const methods = match[3];
    if (methods === undefined) {
      // Fragments stay open for direct concat; complete segments (`:params`,
      // `/`-leading) close — their children slash-join.
      stack.push({ path: full, fragment: !completeSegment });
      continue;
    }
    stack.push({ path: full, fragment: false });
    for (const method of methods.split(',').map((m) => m.trim())) {
      if (method !== '' && method !== 'HEAD' && method !== 'OPTIONS') {
        served.add(`${method} ${full}`);
      }
    }
  }
  return served;
}

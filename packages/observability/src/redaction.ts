/**
 * INV-12 — no personal data in logs, metrics, traces, analytics or push payloads.
 *
 * This is an **allowlist**, not a denylist, and that choice is the whole point. A denylist
 * redacts the fields someone remembered to name: it protects `phone` and `email`, and then a
 * later commit logs `{ caller }` or `{ contact }` and ships a caller's phone number to the log
 * aggregator, with nothing failing. An allowlist inverts the default — a field nobody has
 * classified is redacted, so the failure mode of forgetting is "harder to debug", not "personal
 * data leaked to a third-party processor".
 *
 * What is allowed is deliberately narrow: identifiers, which are opaque, and operational
 * measurements. Anything that carries a human's name, number, address, message content or
 * transcript is not on this list and cannot be added without a privacy review (QG-12).
 *
 * Residual risk, recorded rather than hidden: `msg` is a developer-authored string and is passed
 * through. A template literal such as `` `no contact for ${phone}` `` defeats every allowlist,
 * because by then the personal data *is* the message. That is a review and lint concern, not
 * something this module can catch — which is also why `console.*` is banned in production code,
 * since it bypasses this path entirely.
 */

export const REDACTED = '[redacted]';

/**
 * Structured fields that may appear in a log line.
 *
 * Identifiers are included because they are opaque surrogate keys: they identify a row, and only
 * someone who can already query the database can resolve one to a person. They are still personal
 * data under the GDPR (pseudonymous, not anonymous), which is why they are scoped to what
 * operations genuinely needs to correlate a request.
 */
export const ALLOWED_FIELDS: ReadonlySet<string> = new Set([
  // Emitted by pino itself.
  'level',
  'time',
  'msg',
  'pid',
  'hostname',

  // Which deployment produced the line.
  'service',
  'role',
  'env',
  'version',
  'imageDigest',

  // Correlation.
  'requestId',
  'correlationId',
  'traceId',
  'spanId',
  'jobId',
  'attempt',

  // Opaque domain identifiers.
  'organisationId',
  'locationId',
  'userId',
  'sessionId',
  'callId',
  'conversationId',
  'contactId',
  'taskId',
  'leadId',
  'appointmentId',
  'knowledgeItemId',
  'templateId',
  'idempotencyKey',

  // Operational measurements and outcomes.
  'method',
  'route',
  'statusCode',
  'durationMs',
  'count',
  'outcome',
  'reason',
  'provider',
  'queue',
  'event',
  'from',
  'to',
]);

/** Error shape that is safe to log: the type and where it happened, never the message. */
const ALLOWED_ERROR_FIELDS: ReadonlySet<string> = new Set(['type', 'code']);

/** A V8 stack frame line: leading whitespace, then `at `. */
const STACK_FRAME = /^\s+at\s/;

const MAX_DEPTH = 8;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Replace every value whose key is not allowlisted with `[redacted]`, recursively.
 *
 * `from` and `to` are allowlisted as routing labels (a queue name, a channel), never as phone
 * numbers or email addresses — the E.164 and email value objects in `@moin/kernel` are not
 * loggable, and passing one here yields `[redacted]` because it is not a string.
 */
export function redactToAllowlist(input: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return REDACTED;

  if (Array.isArray(input)) {
    return input.map((item) => redactToAllowlist(item, depth + 1));
  }
  if (!isPlainObject(input)) {
    return input;
  }

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (key === 'err' || key === 'error') {
      out[key] = redactError(value);
      continue;
    }
    if (!ALLOWED_FIELDS.has(key)) {
      out[key] = REDACTED;
      continue;
    }
    out[key] =
      isPlainObject(value) || Array.isArray(value) ? redactToAllowlist(value, depth + 1) : value;
  }
  return out;
}

/**
 * An error's `message` is not logged: it routinely echoes the input that caused it, which is how
 * a caller's phone number or a contact's email ends up in a log line nobody meant to write.
 */
function redactError(value: unknown): unknown {
  if (value instanceof Error) {
    return { type: value.name, stack: safeStack(value.stack), message: REDACTED };
  }
  if (!isPlainObject(value)) return REDACTED;

  const out: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value)) {
    if (key === 'stack') {
      out[key] = safeStack(typeof inner === 'string' ? inner : undefined);
      continue;
    }
    out[key] = ALLOWED_ERROR_FIELDS.has(key) ? inner : REDACTED;
  }
  return out;
}

/**
 * Keep the call frames, drop the header.
 *
 * A V8 stack begins with `<Name>: <message>` before the first frame, so logging `err.stack`
 * verbatim reintroduces exactly the message that is withheld above — the first version of this
 * module did, and its own test caught it. Frames are code locations and carry no personal data.
 */
function safeStack(stack: string | undefined): string | undefined {
  if (stack === undefined) return undefined;
  const frames = stack.split('\n').filter((line) => STACK_FRAME.test(line));
  return frames.length > 0 ? frames.join('\n') : undefined;
}

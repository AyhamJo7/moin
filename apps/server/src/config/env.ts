/**
 * Configuration loading (P02.03.03) — fail fast, and never log a secret.
 *
 * Two rules shape this module.
 *
 * **Fail at startup, not at 03:00.** A missing `DATABASE_URL` that surfaces on the first request
 * is an outage; the same mistake caught during boot is a failed deploy that never takes traffic.
 * Everything is validated once, eagerly, before the application is constructed.
 *
 * **INV-15: secrets live in AWS Secrets Manager, referenced by ARN.** The error path is where
 * that invariant usually dies — a validation library's default message happily prints the value
 * it rejected, and a malformed connection string with a password in it lands in the boot log,
 * which is shipped off-host. So errors here report the *variable name and what was wrong with the
 * shape*, never the value, and `describeConfig()` exists so a human can see the resolved
 * configuration without the secrets in it.
 */

import { z } from 'zod';

const NODE_ENVS = ['development', 'test', 'staging', 'production'] as const;
const ROLES = ['api', 'voice', 'worker', 'migrate'] as const;
const LOG_LEVELS = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'] as const;

export type ServerRole = (typeof ROLES)[number];

/**
 * Marks a variable as holding, or capable of holding, a credential. Its value is never echoed —
 * not in an error, not in a debug dump, not in a startup banner.
 *
 * Secrecy is declared on the schema rather than in a parallel list. A hand-maintained set beside
 * the schema drifts the first time someone adds a key and forgets the other file, and that first
 * miss leaks a credential into the boot log (INV-15). Here, forgetting means the key is simply
 * not marked, which `env.test.ts` fails on.
 */
const SECRET_KEYS = new Set<string>();
function secret<T extends z.ZodType>(name: string, schema_: T): T {
  SECRET_KEYS.add(name);
  return schema_;
}

const baseSchema = z.object({
  NODE_ENV: z.enum(NODE_ENVS).default('development'),
  SERVICE_NAME: z.string().min(1).default('moin'),
  SERVER_ROLE: z.enum(ROLES),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
  LOG_PRETTY: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  APP_VERSION: z.string().min(1).optional(),
  IMAGE_DIGEST: z
    .string()
    .regex(/^sha256:[0-9a-f]{64}$/, 'must be a sha256 image digest')
    .optional(),

  DATABASE_URL: secret('DATABASE_URL', z.url({ protocol: /^postgres(ql)?$/ })),
  REDIS_URL: secret('REDIS_URL', z.url({ protocol: /^rediss?$/ }).optional()),

  SHUTDOWN_GRACE_MS: z.coerce.number().int().min(0).max(120_000).default(15_000),

  /**
   * How long to keep serving after SIGTERM before closing the listener. Must be at least the
   * target group's deregistration delay, or the load balancer is still routing to a closed
   * listener (INV-19).
   */
  DRAIN_MS: z.coerce.number().int().min(0).max(120_000).default(5_000),
});

const schema = baseSchema.superRefine((value, ctx) => {
  // `pino-pretty` is a devDependency and is absent from the runtime image, so LOG_PRETTY=true
  // on a deployed task would throw inside pino during boot and produce a crash loop. The
  // comment in the logger said "never enabled outside local development"; nothing enforced it.
  if (value.LOG_PRETTY && (value.NODE_ENV === 'staging' || value.NODE_ENV === 'production')) {
    ctx.addIssue({
      code: 'custom',
      path: ['LOG_PRETTY'],
      message:
        'pretty logging is development-only: the transport it needs is not installed in the ' +
        'runtime image, and human-formatted logs are not machine-parseable in production',
    });
  }
});

export type Config = Readonly<z.infer<typeof schema>>;

export class ConfigurationError extends Error {
  readonly problems: readonly string[];

  constructor(problems: readonly string[]) {
    super(
      `configuration is invalid:\n${problems.map((p) => `  - ${p}`).join('\n')}\n` +
        'No value is shown above on purpose: these variables can carry credentials (INV-15).',
    );
    this.name = 'ConfigurationError';
    this.problems = problems;
  }
}

/**
 * Validate `source` (defaults to `process.env`) or throw.
 *
 * The thrown error names each offending variable and the shape that was expected. It never
 * contains the rejected value, which is why the messages are assembled here instead of being
 * taken from the validation library.
 */
export function loadConfig(source: NodeJS.ProcessEnv = process.env): Config {
  const result = schema.safeParse(source);
  if (result.success) {
    return Object.freeze(result.data);
  }

  const problems = result.error.issues.map((issue) => {
    const name = issue.path.map(String).join('.') || '(root)';
    const detail = SECRET_KEYS.has(name) ? describeWithoutValue(issue.code) : issue.message;
    return `${name}: ${detail}`;
  });
  throw new ConfigurationError(problems);
}

/**
 * Zod's own messages are safe for most codes, but a few (`invalid_format`, `invalid_value`) can
 * quote the input. For secret-bearing variables we substitute a shape-only description rather
 * than trusting a library's message not to echo a password.
 */
function describeWithoutValue(code: string): string {
  switch (code) {
    case 'invalid_type':
      return 'is missing';
    case 'invalid_format':
      return 'is set but is not a well-formed URL of the expected scheme';
    default:
      return 'is set but is not valid';
  }
}

/** Every key the schema knows about, so a test can assert each one is classified. */
export function configKeys(): readonly string[] {
  return Object.keys(baseSchema.shape);
}

/** Keys marked as secret-bearing. */
export function secretKeys(): ReadonlySet<string> {
  return SECRET_KEYS;
}

/** The resolved configuration with every secret-bearing value replaced, safe to log or print. */
export function describeConfig(config: Config): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(config)) {
    out[key] = SECRET_KEYS.has(key) ? '[redacted]' : value;
  }
  return out;
}

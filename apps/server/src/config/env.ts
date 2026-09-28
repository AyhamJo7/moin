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
 * Variables holding, or capable of holding, a credential. Their values are never echoed — not in
 * an error, not in a debug dump, not in a startup banner.
 */
const SECRET_BEARING = new Set([
  'DATABASE_URL',
  'REDIS_URL',
  'AWS_SECRETS_MANAGER_ARN',
  'OIDC_CLIENT_SECRET',
  'S3_SECRET_ACCESS_KEY',
  'S3_ACCESS_KEY_ID',
]);

const schema = z.object({
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

  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  REDIS_URL: z.url({ protocol: /^rediss?$/ }).optional(),

  SHUTDOWN_GRACE_MS: z.coerce.number().int().min(0).max(120_000).default(15_000),
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
    const detail = SECRET_BEARING.has(name) ? describeWithoutValue(issue.code) : issue.message;
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

/** The resolved configuration with every secret-bearing value replaced, safe to log or print. */
export function describeConfig(config: Config): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(config)) {
    out[key] = SECRET_BEARING.has(key) ? '[redacted]' : value;
  }
  return out;
}

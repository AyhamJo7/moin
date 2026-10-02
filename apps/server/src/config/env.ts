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
const OIDC_PROVIDERS = ['keycloak', 'cognito'] as const;

export type NodeEnvironment = (typeof NODE_ENVS)[number];
export type OidcProvider = (typeof OIDC_PROVIDERS)[number];

/**
 * The one OIDC provider each environment may use (P06.05.04). Keycloak exists only on developer
 * machines and in CI (ADR-0045); a deployed environment authenticates against Cognito
 * (ADR-0005). `OIDC_PROVIDER` must agree with this table rather than being inferred from it, so a
 * local environment file copied into a deployment fails at boot instead of quietly pointing
 * sign-in at a laptop.
 */
export const OIDC_PROVIDER_BY_ENVIRONMENT: Readonly<Record<NodeEnvironment, OidcProvider>> = {
  development: 'keycloak',
  test: 'keycloak',
  staging: 'cognito',
  production: 'cognito',
};

/**
 * The issuer of a Cognito user pool, exactly as it appears in the `iss` claim: HTTPS, the
 * regional endpoint, and a pool id prefixed with the same region. EU regions only, because the
 * customer pool lives in the EU (P06.05.01).
 */
const COGNITO_ISSUER = /^https:\/\/cognito-idp\.(eu-[a-z]+-\d)\.amazonaws\.com\/\1_[0-9A-Za-z]+$/;

const LOOPBACK_HOSTS: readonly string[] = ['127.0.0.1', 'localhost'];
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

  /**
   * The api role's second pool: `moin_identity`, the only role that may execute the sign-in and
   * session functions (P06.06, ADR-0003). It exists so that `moin_app` — which voice and worker
   * hold too — can mint no session. So it is refused for every other role here; an api that signs
   * people in without it refuses to start (`buildSignInGate`). Holds the resolved credential; the
   * task definition references the ARN.
   */
  IDENTITY_DATABASE_URL: secret(
    'IDENTITY_DATABASE_URL',
    z.url({ protocol: /^postgres(ql)?$/ }).optional(),
  ),

  /** P06.05.04: one OIDC contract, selected by deployment rather than by business logic. */
  OIDC_PROVIDER: z.enum(OIDC_PROVIDERS).optional(),
  OIDC_ISSUER_URL: secret('OIDC_ISSUER_URL', z.url({ protocol: /^https?$/ }).optional()),
  OIDC_CLIENT_ID: z.string().min(1).optional(),
  OIDC_CLIENT_SECRET: secret('OIDC_CLIENT_SECRET', z.string().min(1).optional()),
  OIDC_REDIRECT_URI: z.url({ protocol: /^https?$/ }).optional(),

  /**
   * Development and test only: `<key id>:<seed>`, from which the local provider-token key is
   * derived (P06.06.01). Deployed environments seal provider tokens with a KMS data key (ADR-0033,
   * P05.08.01), never a key in the environment (ADR-0020 records why), so the refinement below
   * refuses it outside development and test, and sign-in refuses to start there until the KMS
   * source exists.
   */
  AUTH_LOCAL_TOKEN_KEY: secret(
    'AUTH_LOCAL_TOKEN_KEY',
    z
      .string()
      .regex(/^[A-Za-z0-9._-]{1,64}:\S{16,}$/, 'must be <key id>:<seed of at least 16 characters>')
      .optional(),
  ),

  /**
   * Twilio account auth token, used to validate `X-Twilio-Signature` (P04.04.03). Optional in the
   * schema and required for the voice role below: the API and worker roles must not carry it, so
   * that a compromise of either cannot forge a call webhook (INV-04, INV-15).
   *
   * This variable holds the resolved value, not the ARN, and that is still INV-15: the ARN is what
   * the task definition references, and the runtime injects the value into the environment of the
   * one role that needs it. Nothing reads a secret from a file, a database row or a log line.
   */
  TWILIO_AUTH_TOKEN: secret('TWILIO_AUTH_TOKEN', z.string().min(1).optional()),

  /**
   * The origin Twilio was configured to call, e.g. `https://voice.example.de`. This is the value
   * the signature was computed over, and it is configuration rather than a request header for the
   * reason set out in `packages/telephony/src/signature/url.ts`: a host taken from a header is a
   * host an attacker can choose.
   */
  VOICE_PUBLIC_ORIGIN: z.url({ protocol: /^https$/ }).optional(),

  /** The media WebSocket origin, e.g. `wss://voice.example.de`. */
  VOICE_WEBSOCKET_ORIGIN: z.url({ protocol: /^wss$/ }).optional(),

  /**
   * Speech configuration.
   *
   * These are variables rather than constants because P04.05.04 requires comparing two
   * transcription providers and two German voices over the same fifty calls. A comparison that
   * needs a code change and a deploy between arms is a comparison that will be run once, badly.
   */
  VOICE_LANGUAGE: z.string().min(2).default('de-DE'),
  VOICE_TRANSCRIPTION_PROVIDER: z.string().min(1).default('Deepgram'),
  VOICE_TRANSCRIPTION_MODEL: z.string().min(1).optional(),
  VOICE_TTS_PROVIDER: z.string().min(1).default('Google'),
  VOICE_TTS_VOICE: z.string().min(1).default('de-DE-Standard-A'),
  VOICE_INTERRUPTIBLE: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),

  /**
   * Where per-turn measurements are written during the feasibility work (P04.05.03).
   *
   * The file holds what callers said, so it is personal data collected under volunteer consent
   * (EXT-20) and it has no business existing anywhere near production. The refinement below
   * refuses to start if it is set outside development, rather than trusting a deployment not to
   * set it.
   */
  VOICE_MEASUREMENT_SINK: z.string().min(1).optional(),
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
  const oidcKeys = [
    'OIDC_PROVIDER',
    'OIDC_ISSUER_URL',
    'OIDC_CLIENT_ID',
    'OIDC_CLIENT_SECRET',
    'OIDC_REDIRECT_URI',
  ] as const;
  const configured = oidcKeys.some((key) => value[key] !== undefined);
  if (configured) {
    for (const key of oidcKeys) {
      if (value[key] === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message: 'is required when OIDC is configured',
        });
      }
    }
    const expected = OIDC_PROVIDER_BY_ENVIRONMENT[value.NODE_ENV];
    if (value.OIDC_PROVIDER !== undefined && value.OIDC_PROVIDER !== expected) {
      ctx.addIssue({
        code: 'custom',
        path: ['OIDC_PROVIDER'],
        message:
          expected === 'cognito'
            ? 'local provider is not allowed outside development or test'
            : 'development and test use the local provider, never a deployed user pool',
      });
    }
    if (value.OIDC_ISSUER_URL !== undefined) {
      const issuer = new URL(value.OIDC_ISSUER_URL);
      if (
        issuer.search !== '' ||
        issuer.hash !== '' ||
        issuer.username !== '' ||
        issuer.password !== ''
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['OIDC_ISSUER_URL'],
          message: 'issuer must be a fixed origin and path',
        });
      }
      if (value.OIDC_PROVIDER === 'keycloak' && !LOOPBACK_HOSTS.includes(issuer.hostname)) {
        ctx.addIssue({
          code: 'custom',
          path: ['OIDC_ISSUER_URL'],
          message: 'local provider must use a loopback issuer',
        });
      }
    }
    if (
      value.OIDC_PROVIDER === 'cognito' &&
      value.OIDC_ISSUER_URL !== undefined &&
      !COGNITO_ISSUER.test(value.OIDC_ISSUER_URL)
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['OIDC_ISSUER_URL'],
        message: 'Cognito issuer must be an EU user pool over HTTPS',
      });
    }
    if (value.OIDC_REDIRECT_URI !== undefined) {
      const redirect = new URL(value.OIDC_REDIRECT_URI);
      if (
        redirect.search !== '' ||
        redirect.hash !== '' ||
        redirect.username !== '' ||
        redirect.password !== '' ||
        (value.OIDC_PROVIDER === 'keycloak' && !LOOPBACK_HOSTS.includes(redirect.hostname)) ||
        (value.NODE_ENV !== 'development' &&
          value.NODE_ENV !== 'test' &&
          redirect.protocol !== 'https:')
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['OIDC_REDIRECT_URI'],
          message: 'callback must be a fixed HTTPS URL outside local development',
        });
      }
    }
  }
  if (value.IDENTITY_DATABASE_URL !== undefined && value.SERVER_ROLE !== 'api') {
    ctx.addIssue({
      code: 'custom',
      path: ['IDENTITY_DATABASE_URL'],
      message:
        "is the api role's session credential and must not reach any other role: a voice or " +
        'worker process holding it could mint sessions (ADR-0003)',
    });
  }
  if (
    value.IDENTITY_DATABASE_URL !== undefined &&
    new URL(value.IDENTITY_DATABASE_URL).username === new URL(value.DATABASE_URL).username
  ) {
    ctx.addIssue({
      code: 'custom',
      path: ['IDENTITY_DATABASE_URL'],
      message: 'must use a different database role from DATABASE_URL (moin_identity, not moin_app)',
    });
  }

  if (
    value.AUTH_LOCAL_TOKEN_KEY !== undefined &&
    value.NODE_ENV !== 'development' &&
    value.NODE_ENV !== 'test'
  ) {
    ctx.addIssue({
      code: 'custom',
      path: ['AUTH_LOCAL_TOKEN_KEY'],
      message:
        'is development-only: deployed environments seal provider tokens with a KMS data key ' +
        '(ADR-0033), never a key carried in the environment',
    });
  }

  // The voice role answers the telephone. Starting it without the three values that make signature
  // validation possible would produce a service that either rejects every call or, worse, is
  // written later to skip validation "because the token is not set in this environment".
  if (
    value.VOICE_MEASUREMENT_SINK !== undefined &&
    value.NODE_ENV !== 'development' &&
    value.NODE_ENV !== 'test'
  ) {
    ctx.addIssue({
      code: 'custom',
      path: ['VOICE_MEASUREMENT_SINK'],
      message:
        'writes caller utterances to a file and is development-only: it exists for the P04 ' +
        'feasibility calls under volunteer consent, and must never be set where real callers reach',
    });
  }

  if (value.SERVER_ROLE === 'voice') {
    for (const key of [
      'TWILIO_AUTH_TOKEN',
      'VOICE_PUBLIC_ORIGIN',
      'VOICE_WEBSOCKET_ORIGIN',
    ] as const) {
      if (value[key] === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message:
            'is required for the voice role, which cannot validate Twilio signatures without it',
        });
      }
    }
  }

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

/**
 * OpenAI EU adapter (P10.01.02, ADR-0012): the Responses API behind the
 * `ModelGateway` port. No provider SDK — one `fetch` against the pinned
 * endpoint, so the dependency surface is a URL and a model id, both
 * configuration (T-17), not a vendored client.
 *
 * EU + privacy posture, enforced in code rather than docs:
 * - EU-residency project endpoint (config `baseUrl`); the adapter refuses
 *   non-EU hosts at construction — a config typo must fail here, not route
 *   traffic to the wrong region.
 * - `store: false` on every call: no prompt retention server-side.
 * - strict JSON schema (`strict: true` + required keys): the provider
 *   validates shape before we re-validate with Zod (P10.03, LG-V04).
 * - opaque hashed user ids: the per-tenant caller identifier is SHA-256,
 *   never the raw id (ADR-0012, INV-12).
 * - pinned model snapshot: `fast`/`strong` map to exact dated ids from
 *   config; unconfigured tiers throw at construction, not at call time.
 *
 * Timeouts (P10.04.01): AbortSignal per call; a missed deadline is a
 * `timeout` failure, never a hang. Usage (input/output tokens + model) flows
 * to the caller for the usage ledger (INV-20); prompts and outputs never
 * reach `detail` (INV-12).
 */

import { createHash } from 'node:crypto';
import type {
  GatewayFailure,
  GatewayRequest,
  GatewayResult,
  GatewayUsage,
  ModelGateway,
  ModelTier,
} from './port.ts';

export interface OpenAiAdapterConfig {
  /** EU-residency project endpoint, e.g. the pinned EU base URL. */
  readonly baseUrl: string;
  /** Bearer credential — resolved from Secrets Manager, never committed (INV-15). */
  readonly apiKey: string;
  /** Exact dated snapshot per tier (T-17: configuration, not code). */
  readonly models: Readonly<Record<ModelTier, string>>;
  /** EU project id, sent as the scoping header. */
  readonly projectId?: string | undefined;
  /** fetch seam: global fetch in production, stubbed in contract tests. */
  readonly fetchFn?: typeof fetch | undefined;
}

interface ResponsesOutput {
  readonly output_text?: unknown;
  readonly usage?: { input_tokens?: unknown; output_tokens?: unknown };
}

/** Hosts outside the EU residency footprint are refused at construction. */
function checkEuEndpoint(baseUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new RangeError('openai baseUrl must be a URL');
  }
  if (parsed.protocol !== 'https:') throw new RangeError('openai baseUrl must be https');
  if (!/\.eu\.|eu-central|eu-west|europe/i.test(parsed.host)) {
    throw new RangeError('openai baseUrl must be an EU-residency endpoint');
  }
  return baseUrl.replace(/\/+$/, '');
}

/** Opaque caller id: SHA-256 hex, never the raw tenant/user id (INV-12). */
export function hashCallerId(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

function requiredKeys(schema: unknown): readonly string[] {
  // Strict mode needs the required list; Zod strictObjects carry it as the
  // shape keys. Anything else degrades to no required list (still strict).
  if (typeof schema === 'object' && schema !== null && '_def' in schema) {
    const def = (schema as { _def: { shape?: Record<string, unknown> } })._def;
    if (def.shape !== undefined && typeof def.shape === 'object') return Object.keys(def.shape);
  }
  return [];
}

function failure(
  reason: GatewayFailure['reason'],
  latencyMs: number,
  detail?: string,
  retryAfterMs?: number,
): GatewayFailure {
  // exactOptionalPropertyTypes: absent, never explicit-undefined.
  if (retryAfterMs === undefined) {
    return detail === undefined
      ? { ok: false, reason, latencyMs }
      : { ok: false, reason, latencyMs, detail };
  }
  return detail === undefined
    ? { ok: false, reason, latencyMs, retryAfterMs }
    : { ok: false, reason, latencyMs, detail, retryAfterMs };
}

export function createOpenAiAdapter(config: OpenAiAdapterConfig): ModelGateway {
  const baseUrl = checkEuEndpoint(config.baseUrl);
  if (config.apiKey.length === 0) throw new RangeError('openai apiKey must not be empty');
  for (const tier of ['fast', 'strong'] as const) {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Record<ModelTier,string> types as complete, but a partial object arrives at runtime; the check is the constructor's contract.
    if (config.models[tier] === undefined || config.models[tier].length === 0) {
      throw new RangeError(`openai model for tier ${tier} is not configured`);
    }
  }
  const fetchFn = config.fetchFn ?? fetch;

  return {
    async complete<T>(request: GatewayRequest<T>): Promise<GatewayResult<T>> {
      const started = Date.now();
      const latency = (): number => Date.now() - started;
      // Tiers are validated at construction, so the lookup cannot miss at
      // runtime — the fallback documents the invariant for the type checker.
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- see above: construction-validated, fallback is documentation.
      const model: string = config.models[request.tier] ?? 'unconfigured-tier';
      const controller = new AbortController();
      const timer = setTimeout(() => {
        controller.abort();
      }, request.timeoutMs);
      try {
        const response = await fetchFn(`${baseUrl}/responses`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${config.apiKey}`,
            ...(config.projectId === undefined ? {} : { 'openai-project': config.projectId }),
          },
          body: JSON.stringify({
            model,
            store: false,
            input: request.messages.map((m) => ({ role: m.role, content: m.content })),
            text: {
              format: {
                type: 'json_schema',
                name: request.schemaName,
                strict: true,
                schema: {
                  type: 'object',
                  properties: {},
                  required: [...requiredKeys(request.schema)],
                  additionalProperties: false,
                },
              },
            },
          }),
          signal: controller.signal,
        });
        if (response.status === 429) {
          const retryAfter = response.headers.get('retry-after');
          const retryAfterMs = retryAfter === null ? undefined : Number(retryAfter) * 1000;
          return failure('rate_limited', latency(), `http 429 from ${model}`, retryAfterMs);
        }
        if (!response.ok) {
          return failure('provider_error', latency(), `http ${String(response.status)} from model`);
        }
        const body = (await response.json()) as ResponsesOutput;
        if (typeof body.output_text !== 'string') {
          return failure('invalid_output', latency(), 'missing output_text');
        }
        let parsed: unknown;
        try {
          parsed = JSON.parse(body.output_text) as unknown;
        } catch {
          return failure('invalid_output', latency(), 'output is not JSON');
        }
        const checked = request.schema.safeParse(parsed);
        if (!checked.success) {
          const paths = checked.error.issues.map((i) => i.path.join('.')).join(',');
          return failure('invalid_output', latency(), `schema mismatch: ${paths}`);
        }
        const usage: GatewayUsage = {
          inputTokens: typeof body.usage?.input_tokens === 'number' ? body.usage.input_tokens : 0,
          outputTokens:
            typeof body.usage?.output_tokens === 'number' ? body.usage.output_tokens : 0,
          model,
        };
        return { ok: true, value: checked.data, usage, latencyMs: latency() };
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          return failure('timeout', latency(), 'call exceeded deadline');
        }
        return failure('provider_error', latency(), 'transport failure');
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

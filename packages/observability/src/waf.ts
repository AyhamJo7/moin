/**
 * WAF rules and rate limits (P17.03.01, engineering shapes only): managed
 * rule shapes (SQLi/XSS/rate-based, no live AWS calls) plus per-endpoint
 * rate limits. Tuning against E2E traffic and the ZAP baseline ride the
 * staging verification (P17.03.02).
 */

export type WafRuleKind = 'sqli' | 'xss' | 'rate-based';

export interface WafRule {
  readonly kind: WafRuleKind;
  readonly action: 'block' | 'count';
  readonly priority: number;
}

/** Managed rule set: SQLi + XSS block, rate-based counts for tuning. */
export function wafRules(): readonly WafRule[] {
  return [
    { kind: 'sqli', action: 'block', priority: 1 },
    { kind: 'xss', action: 'block', priority: 2 },
    { kind: 'rate-based', action: 'count', priority: 3 },
  ];
}

export interface RateLimit {
  readonly endpoint: string;
  readonly requestsPerMinute: number;
}

/** Per-endpoint rate limits (webhooks generous, auth tight). */
export function rateLimits(): readonly RateLimit[] {
  return [
    { endpoint: '/api/webhooks/twilio', requestsPerMinute: 600 },
    { endpoint: '/api/auth/*', requestsPerMinute: 60 },
    { endpoint: '/api/*', requestsPerMinute: 300 },
  ];
}

/** True when the endpoint carries an explicit limit. */
export function limitPresent(endpoint: string): boolean {
  return rateLimits().some((limit) => limit.endpoint === endpoint);
}

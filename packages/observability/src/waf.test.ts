/**
 * WAF rules (P17.03): shapes + limits-present.
 */
import { describe, expect, it } from 'vitest';
import { limitPresent, rateLimits, wafRules } from './waf.ts';

describe('waf rules and rate limits', () => {
  it('shapes SQLi/XSS/rate-based rules', () => {
    const kinds = wafRules().map((rule) => rule.kind);
    expect(kinds).toEqual(['sqli', 'xss', 'rate-based']);
    for (const rule of wafRules()) expect(['block', 'count']).toContain(rule.action);
  });

  it('presents a limit per endpoint', () => {
    expect(limitPresent('/api/webhooks/twilio')).toBe(true);
    expect(limitPresent('/api/auth/*')).toBe(true);
    expect(limitPresent('/api/*')).toBe(true);
    expect(limitPresent('/unknown')).toBe(false);
    for (const limit of rateLimits()) expect(limit.requestsPerMinute).toBeGreaterThan(0);
  });
});

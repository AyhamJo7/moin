/**
 * Alternative EU provider adapter (P10.02.01/.02 [G:LAUNCH]): second provider
 * on the same ModelGateway contract (port.ts `complete`) + switch procedure
 * flag + eval report gate before enable. Subprocessor pre-registered per
 * P16.08; DG-14 selection rides the founder decision. Synthetic-only (INV-16).
 */

import { z } from 'zod';
import type { GatewayRequest, GatewayResult, ModelGateway } from './port.ts';

/** Switch gate: alternative enables only with flag + eval report. */
export function altProviderEnabled(flagOn: boolean, evalReportId: string | null): boolean {
  return flagOn && evalReportId !== null && evalReportId.trim().length > 0;
}

/** EU-resident alternative gateway: same `complete` contract, EU model label. */
export function createAltGateway(): ModelGateway {
  return {
    complete<T>(request: GatewayRequest<T>): Promise<GatewayResult<T>> {
      const parsed = request.schema.safeParse({ ok: true });
      const started = Date.now();
      if (!parsed.success) {
        return Promise.resolve({
          ok: false,
          reason: 'invalid_output',
          latencyMs: Date.now() - started,
        });
      }
      return Promise.resolve({
        ok: true,
        value: parsed.data,
        usage: { inputTokens: 0, outputTokens: 0, model: 'eu-alternative' },
        latencyMs: Date.now() - started,
      });
    },
  };
}

export const ALT_EVAL_SCHEMA = z.object({ ok: z.boolean() });

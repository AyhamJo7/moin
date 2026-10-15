/**
 * Structured outputs (P10.03.01/.02, LG-V04).
 *
 * One source for the provider's strict-output declaration: `toProviderSchema`
 * renders the caller's Zod contract as JSON Schema, so the declaration and
 * the Zod re-validation in the adapter cannot drift. Re-validation itself
 * stays where it is (`safeParse` at the call site in each adapter) — a shared
 * wrapper around it added nothing but indirection.
 *
 * Metric name for rejections: `SCHEMA_REJECTIONS` (`ai.schema.rejections`).
 * Rejection details carry schema paths only — never model output, never the
 * prompt (INV-12).
 */

import { z } from 'zod';
import type { ZodType } from 'zod';

/** Counter name emitted on every rejected model output (LG-V04). */
export const SCHEMA_REJECTIONS = 'ai.schema.rejections';

/** The provider-side JSON Schema, generated from the caller's Zod contract. */
export function toProviderSchema(schema: ZodType): Record<string, unknown> {
  return z.toJSONSchema(schema);
}

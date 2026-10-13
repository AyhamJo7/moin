/**
 * Voice config snapshot cache (P11.01.02).
 *
 * Per-tenant voice config (business name for disclosure, enabled intents,
 * template binding, limits, flags) is cached in process with a version
 * check: entries older than 60 s revalidate against the loader. Staleness
 * above the bound is a cache miss, never a silent serve — the loader runs
 * and the fresh snapshot replaces the entry.
 */

export interface VoiceConfig {
  readonly businessName: string;
  readonly enabledIntents: readonly string[];
  readonly templateKey: string;
  readonly templateVersion: string;
  readonly limits: Readonly<Record<string, number>>;
  readonly flags: Readonly<Record<string, boolean>>;
  readonly version: number;
}

/** Maximum entry age before revalidation (P11.01.02: ≤ 60 s staleness). */
export const CONFIG_MAX_AGE_MS = 60_000;

export interface VoiceConfigCache {
  readonly get: (
    tenantId: string,
    load: (tenantId: string) => Promise<VoiceConfig>,
    now?: number,
  ) => Promise<VoiceConfig>;
  readonly invalidate: (tenantId: string) => void;
}

export function createVoiceConfigCache(): VoiceConfigCache {
  const entries = new Map<string, { config: VoiceConfig; at: number }>();
  return {
    async get(tenantId, load, now = Date.now()) {
      const entry = entries.get(tenantId);
      if (entry !== undefined && now - entry.at < CONFIG_MAX_AGE_MS) return entry.config;
      const config = await load(tenantId);
      entries.set(tenantId, { config, at: now });
      return config;
    },
    invalidate(tenantId) {
      entries.delete(tenantId);
    },
  };
}

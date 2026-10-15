/** Voice config cache (P11.01.02/.04): hit, 60 s revalidation, invalidation. */
import { describe, expect, it, vi } from 'vitest';
import { CONFIG_MAX_AGE_MS, createVoiceConfigCache } from './voice-config.ts';
import type { VoiceConfig } from './voice-config.ts';

const CONFIG: VoiceConfig = {
  businessName: 'Musterrestaurant',
  enabledIntents: ['faq_hours'],
  templateKey: 'restaurant',
  templateVersion: 'v1',
  limits: {},
  flags: {},
  version: 3,
};

describe('voice config cache', () => {
  it('serves fresh entries without reloading; revalidates past 60 s', async () => {
    expect(CONFIG_MAX_AGE_MS).toBe(60_000);
    const cache = createVoiceConfigCache();
    const load = vi.fn(() => Promise.resolve(CONFIG));
    await expect(cache.get('t1', load, 0)).resolves.toStrictEqual(CONFIG);
    await expect(cache.get('t1', load, 59_999)).resolves.toStrictEqual(CONFIG);
    expect(load).toHaveBeenCalledOnce();
    await expect(cache.get('t1', load, 60_000)).resolves.toStrictEqual(CONFIG);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('invalidation on config change drops the entry', async () => {
    const cache = createVoiceConfigCache();
    const load = vi.fn(() => Promise.resolve(CONFIG));
    await cache.get('t1', load, 0);
    cache.invalidate('t1');
    await cache.get('t1', load, 1);
    expect(load).toHaveBeenCalledTimes(2);
  });
});

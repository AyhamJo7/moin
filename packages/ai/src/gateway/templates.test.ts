/**
 * Template system (P10.09.04/.06, INV-14/18): invalid templates rejected,
 * out-of-bounds overrides rejected, bindings deterministic. Synthetic only.
 */
import { describe, expect, it } from 'vitest';
import { bindTemplate, loadTemplate, RESTAURANT_V1 } from './templates.ts';
import type { TemplatePackage } from './templates.ts';

describe('template system', () => {
  it('loads the restaurant v1 skeleton with a stable hash', () => {
    const first = loadTemplate(RESTAURANT_V1);
    const second = loadTemplate(RESTAURANT_V1);
    expect(first).toStrictEqual(second);
    expect('hash' in first && first.hash).toMatch(/^[0-9a-f]{12}$/);
  });

  it('rejects sensitive-use and tenant-specific intents (INV-14/18)', () => {
    const sensitive: TemplatePackage = {
      ...RESTAURANT_V1,
      intents: {
        ...RESTAURANT_V1.intents,
        emotion_recognition: { slots: [], required: [], critical: false },
      },
    };
    expect(loadTemplate(sensitive)).toMatchObject({ error: expect.stringContaining('sensitive') });
    const tenantScoped: TemplatePackage = {
      ...RESTAURANT_V1,
      intents: {
        ...RESTAURANT_V1.intents,
        tenant_acme_vip: { slots: [], required: [], critical: false },
      },
    };
    expect(loadTemplate(tenantScoped)).toMatchObject({
      error: expect.stringContaining('tenant-specific'),
    });
    expect(loadTemplate({ ...RESTAURANT_V1, key: '' })).toMatchObject({
      error: expect.stringContaining('key'),
    });
  });

  it('rejects out-of-bounds overrides: unknown, critical, thresholds', () => {
    expect(bindTemplate(RESTAURANT_V1, { disableIntents: ['nope'] })).toMatchObject({
      error: expect.stringContaining('unknown'),
    });
    expect(bindTemplate(RESTAURANT_V1, { disableIntents: ['faq_hours'] })).toMatchObject({
      error: expect.stringContaining('critical'),
    });
    expect(bindTemplate(RESTAURANT_V1, { thresholds: { conf: 5 } })).toMatchObject({
      error: expect.stringContaining('bounds'),
    });
  });

  it('bindings resolve deterministically', () => {
    const over = { disableIntents: ['faq_menu'], wording: { greeting: 'Hallo!' } } as const;
    const a = bindTemplate(RESTAURANT_V1, over);
    const b = bindTemplate(RESTAURANT_V1, over);
    expect(a).toStrictEqual(b);
    expect(a).toMatchObject({
      key: 'restaurant',
      responses: { greeting: 'Hallo!' },
    });
    // toStrictEqual above pins the error branch absent; the cast documents it.
    const bound = a as unknown as { enabledIntents: Set<string> };
    expect(bound.enabledIntents.has('faq_menu')).toBe(false);
    expect(bound.enabledIntents.has('faq_hours')).toBe(true);
  });
});

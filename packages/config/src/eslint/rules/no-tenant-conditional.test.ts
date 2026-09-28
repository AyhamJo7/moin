import { RuleTester } from 'eslint';
import tsParser from '@typescript-eslint/parser';
import { describe, it } from 'vitest';
import { noTenantConditional } from './no-tenant-conditional.ts';

RuleTester.describe = describe;
RuleTester.it = it;

const ruleTester = new RuleTester({
  languageOptions: { parser: tsParser, ecmaVersion: 2024, sourceType: 'module' },
});

ruleTester.run('no-tenant-conditional', noTenantConditional, {
  valid: [
    // Configuration, not a code path — this is the pattern the rule exists to push people towards.
    'const greeting = settings.greetingTemplate;',
    'if (features.voicemailTranscription) { transcribe(); }',
    'if (template.vertical === "restaurant") { applyRestaurantRules(); }',
    // A tenant id compared to another value, not a hard-coded identity.
    'if (organisationId === session.organisationId) { allow(); }',
    'if (orgId !== request.orgId) { deny(); }',
    // Non-tenant identifiers that merely contain an id.
    'if (contactId === "abc") { merge(); }',
    'switch (channel) { case "voice": break; default: break; }',
  ],
  invalid: [
    {
      code: 'if (organisationId === "org_gurlitt") { useSpecialGreeting(); }',
      errors: [{ messageId: 'tenantComparison', data: { name: 'organisationId' } }],
    },
    {
      code: 'if (orgId === "gurlitt") { skipConfirmation(); }',
      errors: [{ messageId: 'tenantComparison' }],
    },
    {
      code: 'const isThem = "org_123" === tenant.organisation_id;',
      errors: [{ messageId: 'tenantComparison' }],
    },
    {
      code: 'if (ctx.tenantId !== "t_42") { normalPath(); }',
      errors: [{ messageId: 'tenantComparison' }],
    },
    {
      code: 'switch (organisationId) { case "a": break; default: break; }',
      errors: [{ messageId: 'tenantSwitch' }],
    },
    {
      code: 'if (session["orgId"] === "gurlitt") { hack(); }',
      errors: [{ messageId: 'tenantComparison' }],
    },
  ],
});

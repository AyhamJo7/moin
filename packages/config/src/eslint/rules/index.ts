import type { Rule } from 'eslint';
import { noTenantConditional } from './no-tenant-conditional.ts';
import { noDirectDbAccess } from './no-direct-db-access.ts';

/**
 * The repository's own lint rules, exposed as an ESLint plugin.
 *
 * Both rules are authored and tested in P02.02.05 but are switched on repository-wide only in
 * P06.03, when the tenant wrapper and the first tenant tables exist. Until then they run against
 * their own fixtures, so the rule logic is under test long before it guards production code — a
 * rule that is written and never exercised is a comment with extra steps.
 */
export const rules: Record<string, Rule.RuleModule> = {
  'no-tenant-conditional': noTenantConditional,
  'no-direct-db-access': noDirectDbAccess,
};

export const moinPlugin = {
  meta: { name: '@moin/config', version: '0.0.0' },
  rules,
};

export { noTenantConditional, noDirectDbAccess };

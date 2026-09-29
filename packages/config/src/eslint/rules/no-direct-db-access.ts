/**
 * INV-01 / INV-02 support — every query runs inside the tenant wrapper.
 *
 * Row-level security only protects rows the connection is actually scoped to. A query issued on a
 * bare pool handle runs without `set_config('app.organisation_id', ...)`, so RLS either denies
 * everything (a confusing outage) or, on a table where someone forgot `FORCE ROW LEVEL SECURITY`,
 * returns another tenant's rows. Neither failure shows up in a single-tenant test.
 *
 * `withTenant(orgId, fn)` and `withSystemWork(claimFn)` (P06.03, P06.14) are the only sanctioned
 * entry points. This rule reports a query issued on a database handle outside one of them.
 *
 * `packages/db` and `packages/testing` are exempt by default: they are where the wrapper and the
 * test harness are implemented, so they necessarily hold raw handles.
 *
 * Authored and tested in P02.02.05; switched on repository-wide in P06.03.
 */

import type { Rule } from 'eslint';
import type { Node } from 'estree';

const DEFAULT_HANDLES = ['db', 'pool', 'client', 'sql', 'database', 'connection'];
const DEFAULT_QUERY_METHODS = ['query', 'execute', 'unsafe', 'transaction', 'begin'];
const DEFAULT_ALLOWED_PATHS = ['packages/db/', 'packages/testing/'];
const WRAPPERS = new Set(['withTenant', 'withSystemWork']);

interface Options {
  readonly handles?: readonly string[];
  readonly queryMethods?: readonly string[];
  readonly allowedPaths?: readonly string[];
}

function calleeName(node: Node): string | undefined {
  if (node.type !== 'CallExpression') return undefined;
  const callee = node.callee;
  if (callee.type === 'Identifier') return callee.name;
  if (
    callee.type === 'MemberExpression' &&
    !callee.computed &&
    callee.property.type === 'Identifier'
  ) {
    return callee.property.name;
  }
  return undefined;
}

export const noDirectDbAccess: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow database access outside the tenant wrapper (withTenant / withSystemWork)',
    },
    schema: [
      {
        type: 'object',
        properties: {
          handles: { type: 'array', items: { type: 'string' } },
          queryMethods: { type: 'array', items: { type: 'string' } },
          allowedPaths: { type: 'array', items: { type: 'string' } },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      outsideWrapper:
        '`{{handle}}.{{method}}(...)` runs outside the tenant wrapper, so no tenant context is set and row-level security cannot scope it (INV-01, INV-02). Wrap the work in `withTenant(organisationId, ...)`, or `withSystemWork(...)` for work that genuinely spans tenants.',
    },
  },

  create(context) {
    const options = (context.options[0] ?? {}) as Options;
    const handles = new Set(options.handles ?? DEFAULT_HANDLES);
    const methods = new Set(options.queryMethods ?? DEFAULT_QUERY_METHODS);
    const allowedPaths = options.allowedPaths ?? DEFAULT_ALLOWED_PATHS;

    const filename = context.filename.split('\\').join('/');
    if (allowedPaths.some((prefix) => filename.includes(prefix))) return {};

    return {
      CallExpression(node) {
        const callee = node.callee;
        if (callee.type !== 'MemberExpression' || callee.computed) return;
        if (callee.property.type !== 'Identifier' || !methods.has(callee.property.name)) return;
        if (callee.object.type !== 'Identifier' || !handles.has(callee.object.name)) return;

        // Lexically inside withTenant(...) / withSystemWork(...)? Then the context is set.
        const enclosing = context.sourceCode.getAncestors(node);
        const wrapped = enclosing.some((ancestor) => {
          const name = calleeName(ancestor);
          return name !== undefined && WRAPPERS.has(name);
        });
        if (wrapped) return;

        context.report({
          node,
          messageId: 'outsideWrapper',
          data: { handle: callee.object.name, method: callee.property.name },
        });
      },
    };
  },
};

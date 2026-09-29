/**
 * INV-18 — onboarding is configuration only: no tenant-specific code paths.
 *
 * The failure this prevents is not hypothetical. A single `if (orgId === 'gurlitt')` shipped to
 * fix one customer's edge case is invisible to every test that uses a different tenant, survives
 * every code review that greps for the customer's name and not the id, and quietly makes the
 * product unsellable to customer number two. Configuration is the supported way to differ:
 * tenant settings, feature flags, templates.
 *
 * The rule reports a comparison between a tenant-identifying expression and a string literal, and
 * a `switch` on one. It deliberately does not try to detect data-driven branching — that is the
 * correct pattern.
 *
 * Authored and tested in P02.02.05; switched on repository-wide in P06.03, once the tenant
 * wrapper it assumes actually exists.
 */

import type { Rule } from 'eslint';
import type { Node } from 'estree';

const DEFAULT_TENANT_IDENTIFIERS = '^(org|organisation|organization|tenant)(_?id)?$';
const COMPARISON_OPERATORS = new Set(['==', '===', '!=', '!==']);

interface Options {
  readonly tenantIdentifierPattern?: string;
}

/** The trailing name of an identifier or member expression: `a.b.orgId` -> `orgId`. */
function tailName(node: Node): string | undefined {
  if (node.type === 'Identifier') return node.name;
  if (node.type === 'MemberExpression' && !node.computed && node.property.type === 'Identifier') {
    return node.property.name;
  }
  if (
    node.type === 'MemberExpression' &&
    node.computed &&
    node.property.type === 'Literal' &&
    typeof node.property.value === 'string'
  ) {
    return node.property.value;
  }
  return undefined;
}

function isStringLiteral(node: Node): boolean {
  return node.type === 'Literal' && typeof node.value === 'string';
}

export const noTenantConditional: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow branching on a tenant identifier or tenant name (INV-18: onboarding is configuration only)',
    },
    schema: [
      {
        type: 'object',
        properties: { tenantIdentifierPattern: { type: 'string' } },
        additionalProperties: false,
      },
    ],
    messages: {
      tenantComparison:
        'Branching on the tenant identifier `{{name}}` creates a tenant-specific code path (INV-18). Express the difference as tenant configuration, a feature flag or a template instead.',
      tenantSwitch:
        'Switching on the tenant identifier `{{name}}` creates tenant-specific code paths (INV-18). Express the difference as tenant configuration, a feature flag or a template instead.',
    },
  },

  create(context) {
    const options = (context.options[0] ?? {}) as Options;
    const pattern = new RegExp(options.tenantIdentifierPattern ?? DEFAULT_TENANT_IDENTIFIERS, 'i');

    const tenantSide = (node: Node): string | undefined => {
      const name = tailName(node);
      return name !== undefined && pattern.test(name) ? name : undefined;
    };

    return {
      BinaryExpression(node) {
        if (!COMPARISON_OPERATORS.has(node.operator)) return;
        const left = node.left.type === 'PrivateIdentifier' ? undefined : tenantSide(node.left);
        const right = tenantSide(node.right);
        const name =
          left !== undefined && isStringLiteral(node.right)
            ? left
            : right !== undefined &&
                node.left.type !== 'PrivateIdentifier' &&
                isStringLiteral(node.left)
              ? right
              : undefined;
        if (name !== undefined) {
          context.report({ node, messageId: 'tenantComparison', data: { name } });
        }
      },

      SwitchStatement(node) {
        const name = tenantSide(node.discriminant);
        if (name !== undefined) {
          context.report({ node: node.discriminant, messageId: 'tenantSwitch', data: { name } });
        }
      },
    };
  },
};

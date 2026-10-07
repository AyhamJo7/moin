/**
 * The RBAC decision table (P06.07.01, PLAN Authorisation matrix).
 *
 * Roles are `owner` / `admin` / `staff` (the membership row, ours — never provider claims);
 * `integration_admin` and `billing_admin` are additive permissions on top. Capabilities name
 * what the matrix rows allow; the guard maps routes to capabilities, services map state
 * transitions to them. One table, so a reviewer reads the policy in one place.
 *
 * Sensitive capabilities additionally require fresh MFA: the step-up guard owns that axis
 * (P06.06.04) — this table answers "may this role" and never "did they re-verify".
 */

export const ROLES = ['owner', 'admin', 'staff'] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSIONS = ['integration_admin', 'billing_admin'] as const;
export type Permission = (typeof PERMISSIONS)[number];

/**
 * Capabilities the matrix grants. Management capabilities are exercised by P06.08 routes;
 * `session:step-up` and `session:sign-out-others` exist so today's session routes already
 * declare what they need and the matrix test covers every role against them.
 */
export const CAPABILITIES = [
  'session:step-up',
  'session:sign-out-others',
  'users:manage',
  'users:manage-owners',
  'integrations:manage',
  'billing:manage',
  'knowledge:edit',
  'knowledge:approve',
  'data:export-erase',
  'tenant:terminate',
  'support:grant',
] as const;
export type Capability = (typeof CAPABILITIES)[number];

interface Grant {
  readonly roles: readonly Role[];
  readonly permissions?: readonly Permission[];
}

/**
 * The matrix. A capability lists the roles that hold it, plus — for the two admin-plus
 * capabilities — the permission that extends it beyond owners. Reading order matches the PLAN
 * table: owner first, then who else.
 */
const MATRIX: Readonly<Record<Capability, Grant>> = {
  'session:step-up': { roles: ['owner', 'admin', 'staff'] },
  'session:sign-out-others': { roles: ['owner', 'admin', 'staff'] },
  'users:manage': { roles: ['owner', 'admin'] },
  'users:manage-owners': { roles: ['owner'] },
  'integrations:manage': { roles: ['owner'], permissions: ['integration_admin'] },
  'billing:manage': { roles: ['owner'], permissions: ['billing_admin'] },
  'knowledge:edit': { roles: ['owner', 'admin'] },
  'knowledge:approve': { roles: ['owner', 'admin'] },
  'data:export-erase': { roles: ['owner', 'admin'] },
  'tenant:terminate': { roles: ['owner'] },
  'support:grant': { roles: ['owner', 'admin'] },
};

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}

export function isPermission(value: unknown): value is Permission {
  return typeof value === 'string' && (PERMISSIONS as readonly string[]).includes(value);
}

/**
 * Whether a membership with `role` and `permissions` holds `capability`. Unknown roles hold
 * nothing (fail closed); unknown permissions grant nothing. Pure, so the matrix test can
 * exhaust it without a database.
 */
export function may(role: string, permissions: readonly string[], capability: Capability): boolean {
  const grant = MATRIX[capability];
  if (grant.roles.includes(role as Role)) return true;
  const extended = grant.permissions;
  if (extended === undefined) return false;
  return permissions.some(
    (permission) => isPermission(permission) && extended.includes(permission),
  );
}

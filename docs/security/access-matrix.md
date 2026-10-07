# Access matrix (P06.07, Authorisation)

Decision: ADR-0005 · Enforcement: guards → services → RLS · Review: QG-09

## The matrix

| Capability                | Owner | Admin | Staff | +IntegrationAdmin | +BillingAdmin |
| ------------------------- | ----- | ----- | ----- | ----------------- | ------------- |
| `session:step-up`         | yes   | yes   | yes   | —                 | —             |
| `session:sign-out-others` | yes   | yes   | yes   | —                 | —             |
| `users:manage`            | yes   | yes   | no    | —                 | —             |
| `users:manage-owners`     | yes   | no    | no    | —                 | —             |
| `integrations:manage`     | yes   | no    | no    | yes               | —             |
| `billing:manage`          | yes   | no    | no    | —                 | yes           |
| `knowledge:edit`          | yes   | yes   | no    | —                 | —             |
| `knowledge:approve`       | yes   | yes   | no    | —                 | —             |
| `data:export-erase`       | yes   | yes   | no    | —                 | —             |
| `tenant:terminate`        | yes   | no    | no    | —                 | —             |
| `support:grant`           | yes   | yes   | no    | —                 | —             |

The table is code (`domain/roles.ts`, pinned by `roles.test.ts`). Sensitive rows additionally
require fresh MFA via the step-up guard (P06.06.04); this table answers "may this role" and never
"did they re-verify".

## The three layers (P06.07.02)

1. **Guards** (`@Require(...)` + `RequireRoleGuard`, after `SessionMembershipGuard`): static
   role/permission checks from our own membership row — never provider claims.
2. **Services** (`requireCapability`, ownership and state checks): a route that forgot its
   `@Require` still refuses in depth.
3. **RLS** (FORCE RLS, tenant policies): the database refuses cross-tenant rows whatever the
   application decided.

## 404 where existence would leak (P06.07.03)

- No session or unusable session → **401** (the guard).
- Authenticated, in-tenant, insufficient role → **403** `/problems/forbidden` (the role guard).
- Missing **or** forbidden **resource** → **404**: services return `undefined` for both and
  controllers map it without distinguishing. A 403 here would name what exists.
- No resource routes exist yet (P06.08+); the rule binds them. The cross-tenant suite (P06.13)
  will exercise tenant-A × tenant-B ids on every route.

## Last owner (P06.07.04)

An organisation always has at least one active owner. The application refuses the removal,
demotion or disablement (P06.08 service checks); migration 0017's `memberships_last_owner`
trigger is the structural backstop — any `UPDATE`/`DELETE` leaving zero active owners fails
with `integrity_constraint_violation`, pinned by digest and trigger checks in the catalog.

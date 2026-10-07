/**
 * Declares the capabilities a route needs (P06.07.02).
 *
 * `@Require('users:manage')` on a handler (or controller) is read by `RequireRoleGuard`
 * via the reflector. Undecorated routes need no capability beyond an active membership —
 * the session guard already established that. All of the listed capabilities must hold.
 */
import { SetMetadata } from '@nestjs/common';
import type { Capability } from '../domain/roles.ts';

export const CAPABILITIES_KEY = 'moin:capabilities';

export function Require(...capabilities: readonly Capability[]): MethodDecorator & ClassDecorator {
  return SetMetadata(CAPABILITIES_KEY, capabilities);
}

import type { SignInService } from './application/sign-in.service.ts';

/**
 * Sign-in, when this environment has an OIDC client. Absent configuration is a gate rather than a
 * boot failure, because the configuration loader has already refused every *partial* setting:
 * "not configured" here can only mean "this deployment does not sign anyone in", and the routes
 * answer 503 rather than pretending otherwise.
 */
export interface SignInGate {
  readonly service: SignInService | undefined;
}

export const SIGN_IN = Symbol('SIGN_IN');
export const SESSIONS = Symbol('SESSIONS');
export const IDENTITY_CLOCK = Symbol('IDENTITY_CLOCK');
export const REQUEST_CONTEXTS = Symbol('REQUEST_CONTEXTS');
export const CONTEXT_CLOCK = Symbol('CONTEXT_CLOCK');

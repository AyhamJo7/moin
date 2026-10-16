/**
 * Tenant provisioning via CLI from template (P18.03.01/.03, engineering
 * shape): template@version + plan + caps → idempotent request key, and the
 * pilot entitlement set (minutes cap 300, hard cap on, SMS cap). The live
 * provision path (P06.04), number routes (P18.03.02) and the health check
 * (P18.03.04) ride separately.
 */

export interface ProvisionRequest {
  readonly template: string;
  readonly plan: string;
  readonly earlyAccess: boolean;
}

const TEMPLATE_RE = /^[a-z]+@\d+\.x$/;

/** True when the request is well-formed: template@version + known plan. */
export function provisionValid(request: ProvisionRequest): boolean {
  if (!TEMPLATE_RE.test(request.template)) return false;
  return request.plan === 'pilot' || request.plan === 'standard';
}

/** Idempotency key: stable per template + plan + early-access flag. */
export function provisionKey(request: ProvisionRequest): string {
  return `provision:${request.template}:${request.plan}:${request.earlyAccess ? 'ea' : 'noea'}`;
}

export interface PilotEntitlements {
  readonly minutesCap: number;
  readonly hardCapOn: boolean;
  readonly smsCap: number;
}

/** Pilot entitlements (P18.03.03): 300 minutes, hard cap on, SMS capped. */
export function pilotEntitlements(): PilotEntitlements {
  return { minutesCap: 300, hardCapOn: true, smsCap: 100 };
}

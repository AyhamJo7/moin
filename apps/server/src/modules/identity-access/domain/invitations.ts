/**
 * Invitations: issuance and acceptance (P06.08.01, P06.08.02, INV-01, INV-02, INV-09, INV-11, INV-12).
 *
 * Issuance is a tenant write: the caller's organisation comes from the guarded session scope
 * (INV-02), never from the request. The raw token is 256 bits from the platform CSPRNG
 * (`randomSecret`); the database keeps only its SHA-256 digest, and the raw value is returned
 * to the issuer exactly once, at creation, for out-of-band delivery. Actual email delivery rides
 * P14 (blocked on EXT-09 SES): until then the issuer delivers the invite link themselves, and
 * the German template below is what they send — rendered in tests, never logged (INV-12).
 *
 * Acceptance binds a verified provider identity to the membership: the subject and the
 * lower-cased verified email come from `parseIdentityClaims` (verified-email-only by
 * construction), and `app.accept_invitation` matches the address exactly against the stored
 * invitation (INV-09). Outcomes are coarse by design: the caller learns `accepted` or one
 * refusal, never which half of a pair was wrong.
 */

import { randomUUID } from 'node:crypto';
import type { TenantClient } from '@moin/db';
import { digestOf, isSecretValue, randomSecret } from './secret-values.ts';

export const INVITATION_TTL_DAYS = 7;

const MAX_EMAIL_LENGTH = 254;

/** Visible ASCII with exactly one @ and a dotted domain: the provisioning contract's shape. */
const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+[.][^@\s]+$/;

/** Closed role set, mirroring the memberships CHECK. */
const INVITABLE_ROLES = ['owner', 'admin', 'staff'] as const;
export type InvitableRole = (typeof INVITABLE_ROLES)[number];

/** Closed permission set, mirroring the memberships CHECK. */
const INVITABLE_PERMISSIONS = ['integration_admin', 'billing_admin'] as const;

export interface IssueInvitationInput {
  readonly organisationId: string;
  readonly email: string;
  readonly role: string;
  readonly permissions?: readonly string[] | undefined;
  readonly createdBy?: string | undefined;
}

export interface IssuedInvitation {
  /** The raw 256-bit token, for out-of-band delivery. Returned once, never stored, never logged. */
  readonly token: string;
  readonly invitationId: string;
  readonly expiresAt: Date;
}

export type AcceptOutcome =
  | 'accepted'
  | 'already_accepted'
  | 'consumed'
  | 'revoked'
  | 'expired'
  | 'email_mismatch'
  | 'not_found';

export interface AcceptedInvitation {
  readonly outcome: AcceptOutcome;
  readonly membershipId?: string | undefined;
  readonly userId?: string | undefined;
}

export class InvitationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvitationError';
  }
}

function normalisedEmail(raw: string): string {
  const email = raw.trim().toLowerCase();
  if (email.length < 3 || email.length > MAX_EMAIL_LENGTH || !EMAIL_PATTERN.test(email)) {
    throw new InvitationError('email is not valid');
  }
  return email;
}

function checkedRole(raw: string): InvitableRole {
  if (!(INVITABLE_ROLES as readonly string[]).includes(raw)) {
    throw new InvitationError('role is not valid');
  }
  return raw as InvitableRole;
}

function checkedPermissions(raw: readonly string[] | undefined): readonly string[] {
  const permissions = raw ?? [];
  for (const permission of permissions) {
    if (!(INVITABLE_PERMISSIONS as readonly string[]).includes(permission)) {
      throw new InvitationError('permission is not valid');
    }
  }
  if (new Set(permissions).size !== permissions.length) {
    throw new InvitationError('permissions are duplicated');
  }
  return [...permissions];
}

/**
 * Issue an invitation in the caller's organisation. Runs inside the caller's `withTenant`
 * transaction; the organisation id is the guarded session's own, never a caller claim.
 */
export async function issueInvitation(
  client: Pick<TenantClient, 'query'>,
  input: IssueInvitationInput,
): Promise<IssuedInvitation> {
  const email = normalisedEmail(input.email);
  const role = checkedRole(input.role);
  const permissions = checkedPermissions(input.permissions);
  const token = randomSecret();
  const invitationId = randomUUID();
  const result = await client.query<{ expires_at: Date }>(
    `insert into invitations
       (organisation_id, id, token_hash, email, role, permissions, expires_at, created_by)
     values ($1, $2, $3, $4, $5, $6::text[], now() + make_interval(days => $7), $8::uuid)
     returning expires_at`,
    [
      input.organisationId,
      invitationId,
      digestOf(token),
      email,
      role,
      `{${permissions.join(',')}}`,
      INVITATION_TTL_DAYS,
      input.createdBy ?? null,
    ],
  );
  const expiresAt = result.rows[0]?.expires_at;
  if (expiresAt === undefined) throw new InvitationError('invitation was not issued');
  return { token, invitationId, expiresAt };
}

/**
 * Accept an invitation: consume the token, bind the verified identity, create the membership.
 * The subject and verified email come from the provider-neutral identity (verified-email-only);
 * the function matches the address exactly and enforces single use, revocation and expiry by
 * the database clock. Runs inside the acceptor's `withTenant`.
 */
export async function acceptInvitation(
  client: Pick<TenantClient, 'query'>,
  invitationId: string,
  token: string,
  subject: string,
  verifiedEmail: string,
): Promise<AcceptedInvitation> {
  if (!isSecretValue(token)) return { outcome: 'not_found' };
  const email = normalisedEmail(verifiedEmail);
  const result = await client.query<{
    membership_id: string | null;
    user_id: string | null;
    outcome: AcceptOutcome;
  }>(
    'select membership_id, user_id, outcome from app.accept_invitation($1::uuid, $2::bytea, $3::text, $4::citext)',
    [invitationId, digestOf(token), subject, email],
  );
  const row = result.rows[0];
  if (row === undefined) throw new InvitationError('invitation accept returned no row');
  return {
    outcome: row.outcome,
    ...(row.membership_id === null ? {} : { membershipId: row.membership_id }),
    ...(row.user_id === null ? {} : { userId: row.user_id }),
  };
}

/**
 * Cancel an outstanding invitation. The invitation must belong to the caller's organisation
 * (RLS via withTenant); already-consumed rows stay consumed — revocation never un-accepts.
 */
export async function revokeInvitation(
  client: Pick<TenantClient, 'query'>,
  invitationId: string,
): Promise<boolean> {
  const result = await client.query<{ n: number }>(
    `update invitations set revoked_at = now()
      where id = $1::uuid and accepted_at is null and revoked_at is null
      returning 1 as n`,
    [invitationId],
  );
  return (result.rows[0]?.n ?? 0) === 1;
}

const INVITE_PATH = '/invite/accept';

/**
 * The German invitation message (P06.08.01). Rendered for the issuer's out-of-band delivery
 * until P14 owns sending; exercised by tests, never logged. The link carries the invitation id
 * and the raw token — both unguessable, single-use, 7-day.
 */
export function renderInvitationEmail(input: {
  readonly organisationName: string;
  readonly invitationId: string;
  readonly token: string;
  readonly appOrigin: string;
}): { subject: string; text: string } {
  const link = `${input.appOrigin}${INVITE_PATH}?id=${input.invitationId}&token=${input.token}`;
  return {
    subject: `Einladung zu ${input.organisationName} auf moin`,
    text: [
      `Hallo,`,
      ``,
      `Sie wurden eingeladen, der Organisation „${input.organisationName}“ auf moin beizutreten.`,
      ``,
      `Bitte öffnen Sie diesen Link innerhalb von 7 Tagen, um die Einladung anzunehmen:`,
      link,
      ``,
      `Der Link ist nur einmal verwendbar und läuft nach 7 Tagen ab. Wenn Sie diese Einladung nicht erwartet haben, ignorieren Sie diese Nachricht einfach.`,
      ``,
      `Viele Grüße`,
      `Ihr moin-Team`,
    ].join('\n'),
  };
}

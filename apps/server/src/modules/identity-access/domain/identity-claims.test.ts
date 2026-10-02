/**
 * P06.05.04: one identity, whichever provider signed it in.
 *
 * The Keycloak payload has the shape the local realm issues (asserted against a live token in
 * `config/oidc-realm.integration.test.ts`). The Cognito payload follows the documented Cognito ID
 * token; it is not evidence about Cognito itself, which P06.05.05 verifies in staging.
 */
import { evidenceTest } from '@moin/testing';
import { describe, expect, it } from 'vitest';
import { IdentityClaimsError, parseIdentityClaims } from './identity-claims.ts';

const SUBJECT = '6f1c2a9e-3b4d-4e5f-8a7b-9c0d1e2f3a4b';
const EMAIL = 'inhaber@musterrestaurant.example';

const KEYCLOAK_ID_TOKEN = {
  exp: 1_790_000_300,
  iat: 1_790_000_000,
  auth_time: 1_790_000_000,
  jti: 'onrtac:5d1e2f3a-0000-4000-8000-000000000001',
  iss: 'http://127.0.0.1:8080/realms/moin-local',
  aud: 'moin-web',
  sub: SUBJECT,
  typ: 'ID',
  azp: 'moin-web',
  sid: '0b9d8c7e-0000-4000-8000-000000000002',
  at_hash: 'x4Gq0uZp1pYk9eWm2sQd3A',
  email_verified: true,
  email: EMAIL,
  preferred_username: EMAIL,
};

const COGNITO_ID_TOKEN = {
  sub: SUBJECT,
  aud: '1example23456789abcdefghij',
  email_verified: true,
  token_use: 'id',
  auth_time: 1_790_000_000,
  iss: 'https://cognito-idp.eu-central-1.amazonaws.com/eu-central-1_Example12',
  'cognito:username': SUBJECT,
  exp: 1_790_003_600,
  iat: 1_790_000_000,
  // Cognito keeps the address as entered; Keycloak lower-cases it. Both are the same person.
  email: 'Inhaber@MusterRestaurant.example',
  jti: 'a1b2c3d4-0000-4000-8000-000000000003',
  origin_jti: 'a1b2c3d4-0000-4000-8000-000000000004',
};

/** Claims that would decide tenancy or permissions if anything trusted them. */
const AUTHORIZATION_CLAIMS = {
  organisation_id: '00000000-0000-4000-8000-0000000000aa',
  tenant_id: '00000000-0000-4000-8000-0000000000bb',
  location_id: '00000000-0000-4000-8000-0000000000cc',
  role: 'owner',
  roles: ['owner', 'admin'],
  permissions: ['integration_admin', 'billing_admin'],
  integration_admin: true,
  billing_admin: true,
  realm_access: { roles: ['owner'] },
  resource_access: { 'moin-web': { roles: ['admin'] } },
  groups: ['owner'],
  'cognito:groups': ['owner'],
  'custom:organisation_id': '00000000-0000-4000-8000-0000000000aa',
  'custom:role': 'owner',
};

function without(claims: Record<string, unknown>, ...names: string[]): Record<string, unknown> {
  return Object.fromEntries(Object.entries(claims).filter(([name]) => !names.includes(name)));
}

function problemsOf(claims: unknown): readonly string[] {
  try {
    parseIdentityClaims(claims);
  } catch (error) {
    expect(error).toBeInstanceOf(IdentityClaimsError);
    return (error as IdentityClaimsError).problems;
  }
  return expect.unreachable('claims must be rejected');
}

describe('the identity-claims contract', () => {
  it('normalises a Keycloak ID token to the canonical identity', () => {
    expect(parseIdentityClaims(KEYCLOAK_ID_TOKEN)).toStrictEqual({
      subject: SUBJECT,
      email: EMAIL,
    });
  });

  evidenceTest('normalises a Cognito ID token to the same identity as Keycloak', () => {
    const fromKeycloak = parseIdentityClaims(KEYCLOAK_ID_TOKEN);
    const fromCognito = parseIdentityClaims(COGNITO_ID_TOKEN);
    expect(fromCognito).toStrictEqual(fromKeycloak);
    expect(Object.keys(fromCognito).sort()).toStrictEqual(['email', 'subject']);
  });

  evidenceTest('ignores tenant, role and permission claims from either provider', () => {
    for (const token of [KEYCLOAK_ID_TOKEN, COGNITO_ID_TOKEN]) {
      const identity = parseIdentityClaims({ ...token, ...AUTHORIZATION_CLAIMS });
      expect(identity).toStrictEqual({ subject: SUBJECT, email: EMAIL });
      expect(Object.keys(identity).sort()).toStrictEqual(['email', 'subject']);
    }
  });

  it('returns a frozen identity', () => {
    expect(Object.isFrozen(parseIdentityClaims(KEYCLOAK_ID_TOKEN))).toBe(true);
  });

  evidenceTest('refuses a token without a subject', () => {
    expect(() => parseIdentityClaims(without(KEYCLOAK_ID_TOKEN, 'sub'))).toThrow(
      IdentityClaimsError,
    );
  });

  evidenceTest('refuses an unverified email', () => {
    expect(() => parseIdentityClaims({ ...COGNITO_ID_TOKEN, email_verified: false })).toThrow(
      IdentityClaimsError,
    );
  });

  it.each(['sub', 'email', 'email_verified'] as const)('rejects a token without %s', (claim) => {
    expect(problemsOf(without(KEYCLOAK_ID_TOKEN, claim)).join(' ')).toContain(claim);
  });

  it('rejects an unverified or not-literally-verified email', () => {
    for (const value of [false, 'true', 1, null]) {
      expect(problemsOf({ ...KEYCLOAK_ID_TOKEN, email_verified: value })).toStrictEqual([
        'email_verified: must be true',
      ]);
    }
  });

  it('does not take the subject or email from provider-specific aliases', () => {
    const problems = problemsOf({
      ...without(COGNITO_ID_TOKEN, 'sub', 'email'),
      'cognito:username': SUBJECT,
      preferred_username: EMAIL,
      username: EMAIL,
      upn: EMAIL,
    });
    expect(problems.join(' ')).toContain('sub');
    expect(problems.join(' ')).toContain('email');
  });

  it.each([
    ['an empty subject', { sub: '' }],
    ['a subject with whitespace', { sub: 'abc def' }],
    ['a subject with a control character', { sub: 'abc\u0000' }],
    ['an overlong subject', { sub: 'a'.repeat(256) }],
    ['a numeric subject', { sub: 42 }],
    ['an array subject', { sub: [SUBJECT] }],
    ['an object subject', { sub: { id: SUBJECT } }],
    ['a malformed email', { email: 'not-an-email' }],
    ['an email with a display name', { email: `Maria <${EMAIL}>` }],
    ['an overlong email', { email: `${'a'.repeat(250)}@x.de` }],
    ['an array email', { email: [EMAIL] }],
    ['an email list', { email: `${EMAIL},other@example.de` }],
  ])('rejects %s', (_label, override) => {
    expect(problemsOf({ ...KEYCLOAK_ID_TOKEN, ...override }).length).toBeGreaterThan(0);
  });

  it.each([
    ['nothing', undefined],
    ['null', null],
    ['a string', 'eyJhbGciOiJSUzI1NiJ9.e30.sig'],
    ['an array', [KEYCLOAK_ID_TOKEN]],
  ])('rejects %s instead of a claims object', (_label, input) => {
    expect(problemsOf(input).length).toBeGreaterThan(0);
  });

  it('never quotes a claim value in the error', () => {
    const secretish = 'maria.private@example.de';
    try {
      parseIdentityClaims({ ...KEYCLOAK_ID_TOKEN, email: `${secretish} `, email_verified: false });
      expect.unreachable('claims must be rejected');
    } catch (error) {
      expect((error as Error).message).not.toContain(secretish);
      expect((error as IdentityClaimsError).problems.join(' ')).not.toContain(secretish);
    }
  });
});

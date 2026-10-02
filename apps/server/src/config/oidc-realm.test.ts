/**
 * P06.05.04: the committed local realm (ADR-0045) issues the identity-claims contract and nothing
 * an authorization decision could be taken from.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { evidenceTest } from '@moin/testing';
import { describe, expect, it } from 'vitest';

const realmSchema = z.looseObject({
  clients: z.array(
    z.looseObject({
      clientId: z.string(),
      publicClient: z.boolean(),
      standardFlowEnabled: z.boolean(),
      implicitFlowEnabled: z.boolean().optional(),
      directAccessGrantsEnabled: z.boolean(),
      attributes: z.record(z.string(), z.string()),
      defaultClientScopes: z.array(z.string()).optional(),
      optionalClientScopes: z.array(z.string()).optional(),
    }),
  ),
  users: z.array(
    z.looseObject({
      email: z.string(),
      emailVerified: z.boolean(),
    }),
  ),
});

type Realm = z.infer<typeof realmSchema>;

/**
 * Keycloak's built-in client scopes that emit the contract: `basic` carries `sub` (Keycloak 25
 * moved it out of the implicit token body), `email` carries `email` and `email_verified`.
 */
const CONTRACT_SCOPES = ['basic', 'email'];

/** The clients whose tokens must have the shape the application parses. */
const CLIENTS = ['moin-web', 'moin-tests'];

function readRealm(): Realm {
  const path = resolve(import.meta.dirname, '../../../../docker/keycloak/realm-moin-local.json');
  return realmSchema.parse(JSON.parse(readFileSync(path, 'utf8')) as unknown);
}

function client(realm: Realm, clientId: string): Realm['clients'][number] {
  const found = realm.clients.find((item) => item.clientId === clientId);
  if (found === undefined) {
    throw new Error(`realm has no client ${clientId}`);
  }
  return found;
}

describe('the local browser OIDC client', () => {
  it('requires authorization code with S256 PKCE and has no password grant', () => {
    expect(client(readRealm(), 'moin-web')).toMatchObject({
      publicClient: false,
      standardFlowEnabled: true,
      implicitFlowEnabled: false,
      directAccessGrantsEnabled: false,
      attributes: { 'pkce.code.challenge.method': 'S256' },
    });
  });
});

describe('the local realm claims shape', () => {
  evidenceTest(
    'gives the browser client exactly the scopes of the identity-claims contract',
    () => {
      expect(client(readRealm(), 'moin-web')).toMatchObject({
        defaultClientScopes: CONTRACT_SCOPES,
        optionalClientScopes: [],
      });
    },
  );

  it.each(CLIENTS)('gives %s exactly the scopes of the identity-claims contract', (clientId) => {
    // Listed explicitly and with no optional scopes: an omitted list falls back to the realm
    // defaults, which include `profile`, `roles` and `web-origins`.
    expect(client(readRealm(), clientId)).toMatchObject({
      defaultClientScopes: CONTRACT_SCOPES,
      optionalClientScopes: [],
    });
  });

  it('issues fixture tokens with the browser client claims shape', () => {
    // The live-token test authenticates through moin-tests; it proves moin-web's shape only
    // while both clients map the same claims.
    const realm = readRealm();
    const [web, tests] = CLIENTS.map((clientId) => client(realm, clientId));
    expect(tests?.defaultClientScopes).toStrictEqual(web?.defaultClientScopes);
    expect(tests?.optionalClientScopes).toStrictEqual(web?.optionalClientScopes);
    expect(tests?.['protocolMappers']).toStrictEqual(web?.['protocolMappers']);
  });

  evidenceTest(
    'defines no roles, groups, custom scopes or mappers that could reach a token',
    () => {
      const realm = readRealm();
      for (const key of ['roles', 'groups', 'clientScopes', 'defaultDefaultClientScopes']) {
        expect(realm[key], `realm.${key}`).toBeUndefined();
      }
      for (const item of realm.clients) {
        expect(item['protocolMappers'], `${item.clientId}.protocolMappers`).toBeUndefined();
      }
      for (const user of realm.users) {
        for (const key of ['realmRoles', 'clientRoles', 'groups', 'attributes']) {
          expect(user[key], `${user.email}.${key}`).toBeUndefined();
        }
      }
    },
  );

  it('gives every fixture user a verified email', () => {
    for (const user of readRealm().users) {
      expect(user.emailVerified, user.email).toBe(true);
    }
  });
});

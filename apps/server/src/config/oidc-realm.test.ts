/** P06.05.04: a broken local client must not pass the auth-code and PKCE contract. */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { describe, expect, it } from 'vitest';

const realmSchema = z.object({
  clients: z.array(
    z.object({
      clientId: z.string(),
      publicClient: z.boolean(),
      standardFlowEnabled: z.boolean(),
      implicitFlowEnabled: z.boolean().optional(),
      directAccessGrantsEnabled: z.boolean(),
      attributes: z.record(z.string(), z.string()),
    }),
  ),
});

function readRealm(): z.infer<typeof realmSchema> {
  const path = resolve(import.meta.dirname, '../../../../docker/keycloak/realm-moin-local.json');
  return realmSchema.parse(JSON.parse(readFileSync(path, 'utf8')) as unknown);
}

describe('the local browser OIDC client', () => {
  it('requires authorization code with S256 PKCE and has no password grant', () => {
    const client = readRealm().clients.find((item) => item.clientId === 'moin-web');
    expect(client).toMatchObject({
      publicClient: false,
      standardFlowEnabled: true,
      implicitFlowEnabled: false,
      directAccessGrantsEnabled: false,
      attributes: { 'pkce.code.challenge.method': 'S256' },
    });
  });
});

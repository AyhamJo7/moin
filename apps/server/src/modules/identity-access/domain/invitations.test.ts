import { describe, expect } from 'vitest';
import { evidenceTest } from '@moin/testing';
import {
  INVITATION_TTL_DAYS,
  InvitationError,
  issueInvitation,
  renderInvitationEmail,
} from './invitations.ts';

describe('invitation email (P06.08.01)', () => {
  evidenceTest('the invitation is a German message with a single-use link', () => {
    expect(INVITATION_TTL_DAYS).toBe(7);
    const rendered = renderInvitationEmail({
      organisationName: 'Gasthaus Gurlitt',
      invitationId: '11111111-1111-4111-8111-111111111111',
      token: 'abcdefghijklmnopqrstuvwxyz0123456789ABCDEF-_X',
      appOrigin: 'http://localhost:3000',
    });
    expect(rendered.subject).toContain('Gasthaus Gurlitt');
    // German body, expiry named, no English fallback.
    expect(rendered.text).toContain('innerhalb von 7 Tagen');
    expect(rendered.text).toContain('nur einmal verwendbar');
    expect(rendered.text).toContain(
      'http://localhost:3000/invite/accept?id=11111111-1111-4111-8111-111111111111&token=abcdefghijklmnopqrstuvwxyz0123456789ABCDEF-_X',
    );
  });
});

describe('issuing an invitation bounds what it confers (G09 M1, domain boundary)', () => {
  const ORG = '11111111-1111-4111-8111-111111111111';

  /** A client that fails the test if anything is written, and a counter for the audit hook. */
  function untouchedStore() {
    const queries: string[] = [];
    let audits = 0;
    return {
      client: {
        query: (text: string): never => {
          queries.push(text);
          throw new Error('the store must not be reached');
        },
      },
      queries,
      audit: (): Promise<void> => {
        audits += 1;
        return Promise.resolve();
      },
      audits: () => audits,
    };
  }

  const refused: readonly (readonly [string, string, readonly string[], readonly string[]])[] = [
    ['an admin without permissions, billing_admin', 'admin', [], ['billing_admin']],
    ['an admin without permissions, integration_admin', 'admin', [], ['integration_admin']],
    [
      'a billing holder asking for integration_admin',
      'admin',
      ['billing_admin'],
      ['integration_admin'],
    ],
    ['staff asking for billing_admin', 'staff', [], ['billing_admin']],
    ['an unknown role', 'ghost', ['billing_admin'], ['billing_admin']],
  ];

  for (const [label, role, held, requested] of refused) {
    evidenceTest(`refuses ${label} before any insert or audit`, async () => {
      const store = untouchedStore();
      await expect(
        issueInvitation(store.client, {
          organisationId: ORG,
          email: 'neu@example.test',
          role: 'staff',
          permissions: requested,
          grantor: { role, permissions: held },
          audit: store.audit,
        }),
      ).rejects.toBeInstanceOf(InvitationError);
      expect(store.queries).toHaveLength(0);
      expect(store.audits()).toBe(0);
    });
  }
});

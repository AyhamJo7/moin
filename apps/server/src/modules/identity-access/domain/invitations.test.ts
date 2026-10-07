import { describe, expect } from 'vitest';
import { evidenceTest } from '@moin/testing';
import { INVITATION_TTL_DAYS, renderInvitationEmail } from './invitations.ts';

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

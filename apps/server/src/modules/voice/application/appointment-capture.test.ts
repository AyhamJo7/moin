/**
 * Appointment-request capture: slot loop in order, read-back, ready
 * request, two-strikes escalation.
 */
import { describe, expect, it } from 'vitest';
import { appointmentTurn, readBackAppointment } from './appointment-capture.ts';

describe('appointment capture', () => {
  it('asks missing slots in order, then reports ready with read-back', () => {
    expect(appointmentTurn({}, 0)).toStrictEqual({ step: 'ask', slot: 'date' });
    expect(appointmentTurn({ date: 'Samstag' }, 0)).toStrictEqual({
      step: 'ask',
      slot: 'time',
    });
    expect(appointmentTurn({ date: 'Samstag', time: '19 Uhr' }, 0)).toStrictEqual({
      step: 'ask',
      slot: 'partySize',
    });
    expect(appointmentTurn({ date: 'Samstag', time: '19 Uhr', partySize: '4' }, 0)).toStrictEqual({
      step: 'ask',
      slot: 'contact',
    });
    expect(
      appointmentTurn({ date: 'Samstag', time: '19 Uhr', partySize: '4', contact: '+49151' }, 0),
    ).toStrictEqual({
      step: 'ready',
      date: 'Samstag',
      time: '19 Uhr',
      partySize: '4',
      contact: '+49151',
    });
    expect(readBackAppointment('Samstag', '19 Uhr', '4')).toContain('Samstag um 19 Uhr für 4');
  });

  it('escalates after two unfilled attempts (INV-06)', () => {
    expect(appointmentTurn({}, 1)).toStrictEqual({ step: 'ask', slot: 'date' });
    expect(appointmentTurn({}, 2)).toStrictEqual({
      step: 'escalate',
      reason: 'slots-unfilled',
    });
  });
});

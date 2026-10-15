/**
 * Initial voice tools (P10.08.05): captureCallback, createLead,
 * createAppointmentRequest, escalate, endCall. Transfer rides P11.10,
 * booking P20 — their names are absent here on purpose, so the guard's
 * tenant→allowed step rejects them until those phases land.
 */

import { z } from 'zod';
import { defineTool } from './tools.ts';

const phoneSchema = z.strictObject({ callbackPhone: z.string().min(6) });

export const captureCallback = defineTool({
  name: 'captureCallback',
  schema: phoneSchema,
  permission: 'ai:callback',
  channels: ['voice'],
  // Shape (length) is the schema's job; the precondition is dialability.
  preconditions: [(args) => /^[+\d][\d\s./-]*$/.test(args.callbackPhone)],
  requiresApproval: false,
  sanitiseAudit: () => ({ phone: '[phone]' }),
});

export const createLead = defineTool({
  name: 'createLead',
  schema: z.strictObject({ callerName: z.string().min(1), note: z.string().max(200) }),
  permission: 'ai:lead',
  channels: ['voice', 'web'],
  preconditions: [(args) => args.callerName.trim().length > 0],
  requiresApproval: false,
  sanitiseAudit: (args) => ({ callerName: `${args.callerName.charAt(0)}.` }),
});

export const createAppointmentRequest = defineTool({
  name: 'createAppointmentRequest',
  schema: z.strictObject({
    callerName: z.string().min(1),
    ownerId: z.string().min(1),
    slot: z.string().min(1),
  }),
  permission: 'ai:appointment',
  channels: ['voice'],
  preconditions: [(args) => args.slot.trim().length > 0],
  ownerOf: (args) => args.ownerId,
  requiresApproval: true,
  sanitiseAudit: (args) => ({ callerName: `${args.callerName.charAt(0)}.`, slot: args.slot }),
});

export const escalate = defineTool({
  name: 'escalate',
  schema: z.strictObject({ reason: z.string().min(1) }),
  permission: 'ai:escalate',
  channels: ['voice', 'web', 'staff'],
  preconditions: [],
  requiresApproval: false,
  sanitiseAudit: (args) => ({ reason: args.reason }),
});

export const endCall = defineTool({
  name: 'endCall',
  schema: z.strictObject({ summary: z.string().max(200) }),
  permission: 'ai:call',
  channels: ['voice'],
  preconditions: [],
  requiresApproval: false,
  sanitiseAudit: () => ({}),
});

export const VOICE_TOOLS = [
  captureCallback,
  createLead,
  createAppointmentRequest,
  escalate,
  endCall,
] as const;

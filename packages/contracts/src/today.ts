/**
 * The owner's Today view and the simulated inbound call that feeds it (P13.02, P12.09.01).
 *
 * One schema per wire shape, imported by both sides: the API parses its own response through
 * `todayResponseSchema` before sending it, and the owner app parses what it receives with the
 * same schema, so a drift between them fails a test instead of rendering a wrong task.
 */

import { z } from 'zod';

/**
 * The session cookie the API sets at sign-in (`__Host-`: Secure, Path=/, no Domain). The owner
 * app forwards only this cookie when it reads on the owner's behalf; the API's session policy
 * defines it, and the slice's integration test pins the two together.
 */
export const SESSION_COOKIE_NAME = '__Host-moin_sid';

/** The authenticated Today read. The tenant is the session's own; the route takes no id. */
export const TODAY_PATH = '/api/today';

/** Development and test only: the synthetic call boundary (P11.16 stands in for it later). */
export const SIMULATED_CALL_PATH = '/api/dev/simulated-calls';

/** Most tasks the Today view returns; older open work stays reachable once P13.03 lists it. */
export const TODAY_TASK_LIMIT = 100;

/** The tasks.title CHECK bound (migration 0025), in characters (code points). */
export const TASK_TITLE_MAX_LENGTH = 72;

/** Longest caller utterance the simulator accepts (characters, after normalisation). */
export const UTTERANCE_MAX_LENGTH = 500;

const E164 = /^\+[1-9][0-9]{6,14}$/;

export const taskStatusSchema = z.enum(['open', 'in_progress', 'waiting', 'done', 'cancelled']);
export const taskTypeSchema = z.enum(['callback', 'review', 'booking', 'follow_up', 'general']);
export const taskPrioritySchema = z.enum(['low', 'normal', 'high', 'urgent']);

export const todayTaskSchema = z.strictObject({
  id: z.uuid(),
  // 1..72 characters as the tasks.title CHECK counts them (code points, not UTF-16 units).
  title: z
    .string()
    .min(1)
    .refine((title) => Array.from(title).length <= TASK_TITLE_MAX_LENGTH, 'at most 72 characters'),
  type: taskTypeSchema.nullable(),
  status: taskStatusSchema,
  priority: taskPrioritySchema,
  createdAt: z.iso.datetime(),
  /** The optimistic-lock version the next action on this task must present (P07.13). */
  version: z.number().int().positive(),
  /** The number the call came from, when the task came from a call; null otherwise. */
  callerNumber: z.string().regex(E164).nullable(),
});

export const todayResponseSchema = z.strictObject({
  /** Urgent first, then newest first. */
  tasks: z.array(todayTaskSchema).max(TODAY_TASK_LIMIT),
  /** More live tasks exist than were returned: no section may be called empty. */
  truncated: z.boolean(),
});

/** Owner actions on one task (P13.03.02). The tenant is the session's own; routes take an id only. */
export const taskPath = (taskId: string): string => `/api/tasks/${taskId}`;
export const taskCompletePath = (taskId: string): string => `${taskPath(taskId)}/complete`;

/** The synchronizer-token header and cookie the owner app echoes on every mutation. */
export const CSRF_HEADER_NAME = 'x-csrf-token';
export const CSRF_COOKIE_NAME = '__Host-moin_csrf';

/** `POST /api/tasks/:id/complete`: the version the owner saw, never a status or a tenant. */
export const completeTaskRequestSchema = z.strictObject({
  version: z.number().int().positive(),
});

/** One task as the owner's app reads it after an action or on a direct look-up. */
export const taskStateSchema = z.strictObject({
  id: z.uuid(),
  status: taskStatusSchema,
  version: z.number().int().positive(),
});

export type CompleteTaskRequest = z.infer<typeof completeTaskRequestSchema>;
export type TaskState = z.infer<typeof taskStateSchema>;

export type TodayTask = z.infer<typeof todayTaskSchema>;
export type TodayResponse = z.infer<typeof todayResponseSchema>;

/**
 * One completed simulated call. `to` is the dialled business number: it alone selects the
 * tenant, through the same number routes a real call uses. Nothing in the body names a tenant.
 */
export const simulatedCallSchema = z.strictObject({
  callSid: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/, 'must be 8–64 URL-safe characters'),
  from: z.string().max(32),
  to: z.string().regex(E164, 'must be an E.164 number'),
  utterance: z
    .string()
    .min(1)
    .max(UTTERANCE_MAX_LENGTH * 2),
});

export type SimulatedCall = z.infer<typeof simulatedCallSchema>;

export const simulatedCallResultSchema = z.strictObject({
  /** The task carrying the request; null only when it was erased after acceptance. */
  taskId: z.uuid().nullable(),
  /** True when this call's request was already accepted: nothing was written. */
  replayed: z.boolean(),
});

export type SimulatedCallResult = z.infer<typeof simulatedCallResultSchema>;

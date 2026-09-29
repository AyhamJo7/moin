/**
 * Provider tokens for the health module.
 *
 * Kept beside the module rather than inside the controller: a token declared in the file that
 * consumes it makes every other consumer import the controller to reach it.
 */
export const READINESS_CHECKS = Symbol('READINESS_CHECKS');
export const SHUTDOWN_STATE = Symbol('SHUTDOWN_STATE');

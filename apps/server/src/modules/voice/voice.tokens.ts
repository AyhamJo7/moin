/** Injection tokens for the voice module, in their own file so modules do not import each other's. */
export const SESSION_TOKENS = Symbol('SESSION_TOKENS');
export const CLOCK = Symbol('CLOCK');
export const MEASUREMENT_SINK = Symbol('MEASUREMENT_SINK');

/**
 * The single tenant the feasibility spike runs as.
 *
 * Resolving a tenant from the dialled number is P07.03, and building it now would mean building a
 * number registry before the number exists. A constant is honest about that; a lookup that always
 * returns the same row would not be.
 */
export const FEASIBILITY_TENANT_ID = '00000000-0000-4000-8000-000000000000';

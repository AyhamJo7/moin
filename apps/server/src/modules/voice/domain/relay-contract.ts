/**
 * Names shared by the TwiML the controller emits and the WebSocket handler that reads them back.
 *
 * They live here rather than in either of those files because both sides must agree, and a
 * constant that only one side owns is a constant the other side eventually spells differently.
 */

/** The `<Parameter>` name carrying the single-use session token. */
export const SESSION_TOKEN_PARAMETER = 'sessionToken';

/** The path the media WebSocket is served on, appended to `VOICE_WEBSOCKET_ORIGIN`. */
export const RELAY_PATH = '/voice/relay';

/**
 * How long a connection may stay unauthenticated.
 *
 * Twilio sends `setup` immediately. A socket that has not authenticated within this window is
 * either broken or not Twilio, and leaving it open costs a file descriptor per attempt.
 */
export const SETUP_TIMEOUT_MS = 10_000;

/** WebSocket close codes in the private range, so they cannot collide with protocol codes. */
export const CLOSE_UNAUTHENTICATED = 4401;
export const CLOSE_SETUP_TIMEOUT = 4408;
export const CLOSE_NORMAL = 1000;

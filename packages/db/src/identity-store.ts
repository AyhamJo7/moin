/**
 * The sign-in and session store (P06.06.01, P06.06.02, ADR-0005).
 *
 * The runtime role holds no privilege on `users`, `auth_transactions`, `sessions` or `memberships`;
 * it may only execute the seven session functions (migrations 0012/0014). This module is the only
 * caller of those functions,
 * and each method is one call, so what the database guarantees — single-use transactions, a fixed
 * absolute lifetime, final revocation, no session without an active user — is exactly what a
 * caller gets.
 *
 * Every secret crosses this boundary as a SHA-256 digest or as ciphertext. Nothing here sees a raw
 * session token, `state`, nonce, PKCE verifier or provider token, so nothing here can leak one.
 *
 * Global identity work, not tenant work: it runs on a pool connection outside `withTenant`
 * because a session is resolved *before* any organisation is known (Data Architecture:
 * `resolve_session(token_hash)` precedes knowing which tenant applies).
 */

import type { Pool } from 'pg';

/** SHA-256 digests are 32 bytes; anything else is a caller bug, refused before the database. */
const DIGEST_BYTES = 32;

export type RotationReason = 'step_up' | 'privilege_change';

export interface NewAuthTransaction {
  readonly stateHash: Buffer;
  readonly bindingHash: Buffer;
  readonly nonceHash: Buffer;
  readonly verifierSealed: Buffer;
  readonly keyId: string;
  readonly returnTo: string;
}

export interface ConsumedAuthTransaction {
  readonly nonceHash: Buffer;
  readonly verifierSealed: Buffer;
  readonly keyId: string;
  readonly returnTo: string;
}

export interface NewSession {
  readonly subject: string;
  readonly tokenHash: Buffer;
  readonly sessionId: string;
  readonly providerTokensSealed: Buffer;
  readonly keyId: string;
  /** The session the browser presented at sign-in, if any; it is revoked as superseded. */
  readonly replacedHash?: Buffer | undefined;
}

export interface SessionGrant {
  readonly sessionId: string;
  readonly userId: string;
  readonly absoluteExpiresAt: Date;
}

export interface ResolvedSession {
  readonly sessionId: string;
  readonly userId: string;
  readonly idleExpiresAt: Date;
  readonly absoluteExpiresAt: Date;
}

/** One active membership of a resolved session: the org the request may act for (P06.06.03). */
export interface ActiveMembership {
  readonly organisationId: string;
  readonly role: string;
  readonly permissions: readonly string[];
}

/** A valid session plus every active membership of its user (P06.06.03, FS-16). */
export interface RequestContext {
  readonly sessionId: string;
  readonly userId: string;
  readonly memberships: readonly ActiveMembership[];
  readonly idleExpiresAt: Date;
  readonly absoluteExpiresAt: Date;
}

export interface IdentityStore {
  beginAuthTransaction(input: NewAuthTransaction): Promise<void>;
  /** Deletes the transaction on any presentation of its state; returns it only if it is usable. */
  consumeAuthTransaction(
    stateHash: Buffer,
    bindingHash: Buffer,
  ): Promise<ConsumedAuthTransaction | undefined>;
  /** Undefined when the subject has no active user: sign-in never provisions one. */
  beginSession(input: NewSession): Promise<SessionGrant | undefined>;
  /** Undefined when the presented session is not valid now, or was rotated concurrently. */
  rotateSession(
    tokenHash: Buffer,
    newTokenHash: Buffer,
    newSessionId: string,
    reason: RotationReason,
  ): Promise<SessionGrant | undefined>;
  resolveSession(tokenHash: Buffer): Promise<ResolvedSession | undefined>;
  /**
   * Session validity plus active memberships in one call (P06.06.03): one row per active
   * membership of a valid session's user, or no rows when the session is expired, revoked, or
   * its user inactive — or when the user holds no active membership (removed/disabled, FS-16).
   */
  resolveRequestContext(tokenHash: Buffer): Promise<RequestContext | undefined>;
  revokeSession(tokenHash: Buffer): Promise<boolean>;
}

function digest(value: Buffer): Buffer {
  if (value.length !== DIGEST_BYTES) {
    throw new TypeError('expected a 32-byte SHA-256 digest');
  }
  return value;
}

interface GrantRow extends Record<string, unknown> {
  readonly session_id: string;
  readonly user_id: string;
  readonly absolute_expires_at: Date;
}

function grant(row: GrantRow | undefined): SessionGrant | undefined {
  return row === undefined
    ? undefined
    : {
        sessionId: row.session_id,
        userId: row.user_id,
        absoluteExpiresAt: row.absolute_expires_at,
      };
}

export function createIdentityStore(pool: Pool): IdentityStore {
  return {
    async beginAuthTransaction(input) {
      await pool.query(
        'select app.begin_sign_in($1::bytea, $2::bytea, $3::bytea, $4::bytea, $5::text, $6::text)',
        [
          digest(input.stateHash),
          digest(input.bindingHash),
          digest(input.nonceHash),
          input.verifierSealed,
          input.keyId,
          input.returnTo,
        ],
      );
    },

    async consumeAuthTransaction(stateHash, bindingHash) {
      const result = await pool.query<{
        nonce_hash: Buffer;
        verifier_sealed: Buffer;
        key_id: string;
        return_to: string;
      }>(
        'select nonce_hash, verifier_sealed, key_id, return_to from app.consume_sign_in($1::bytea, $2::bytea)',
        [digest(stateHash), digest(bindingHash)],
      );
      const row = result.rows[0];
      return row === undefined
        ? undefined
        : {
            nonceHash: row.nonce_hash,
            verifierSealed: row.verifier_sealed,
            keyId: row.key_id,
            returnTo: row.return_to,
          };
    },

    async beginSession(input) {
      const result = await pool.query<GrantRow>(
        'select session_id, user_id, absolute_expires_at from app.begin_session($1::text, $2::bytea, $3::uuid, $4::bytea, $5::text, $6::bytea)',
        [
          input.subject,
          digest(input.tokenHash),
          input.sessionId,
          input.providerTokensSealed,
          input.keyId,
          input.replacedHash === undefined ? null : digest(input.replacedHash),
        ],
      );
      return grant(result.rows[0]);
    },

    async rotateSession(tokenHash, newTokenHash, newSessionId, reason) {
      const result = await pool.query<GrantRow>(
        'select session_id, user_id, absolute_expires_at from app.rotate_session($1::bytea, $2::bytea, $3::uuid, $4::text)',
        [digest(tokenHash), digest(newTokenHash), newSessionId, reason],
      );
      return grant(result.rows[0]);
    },

    async resolveSession(tokenHash) {
      const result = await pool.query<{
        session_id: string;
        user_id: string;
        idle_expires_at: Date;
        absolute_expires_at: Date;
      }>(
        'select session_id, user_id, idle_expires_at, absolute_expires_at from app.resolve_session($1::bytea)',
        [digest(tokenHash)],
      );
      const row = result.rows[0];
      return row === undefined
        ? undefined
        : {
            sessionId: row.session_id,
            userId: row.user_id,
            idleExpiresAt: row.idle_expires_at,
            absoluteExpiresAt: row.absolute_expires_at,
          };
    },

    async revokeSession(tokenHash) {
      const result = await pool.query<{ revoked: boolean }>(
        'select app.revoke_session($1::bytea) as revoked',
        [digest(tokenHash)],
      );
      return result.rows[0]?.revoked === true;
    },

    async resolveRequestContext(tokenHash) {
      const result = await pool.query<{
        session_id: string;
        user_id: string;
        organisation_id: string;
        role: string;
        permissions: string[];
        idle_expires_at: Date;
        absolute_expires_at: Date;
      }>(
        'select session_id, user_id, organisation_id, role, permissions, idle_expires_at, absolute_expires_at from app.resolve_request_context($1::bytea)',
        [digest(tokenHash)],
      );
      const first = result.rows[0];
      if (first === undefined) return undefined;
      return {
        sessionId: first.session_id,
        userId: first.user_id,
        memberships: result.rows.map((row) => ({
          organisationId: row.organisation_id,
          role: row.role,
          permissions: row.permissions,
        })),
        idleExpiresAt: first.idle_expires_at,
        absoluteExpiresAt: first.absolute_expires_at,
      };
    },
  };
}

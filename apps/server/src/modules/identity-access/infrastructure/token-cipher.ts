/**
 * Authenticated encryption for provider tokens and PKCE verifiers at rest (P06.06.01).
 *
 * AES-256-GCM from the platform, nothing designed here. Each seal draws a fresh 96-bit IV from the
 * CSPRNG; with random IVs a key stays safe for well over the 2^32 seals NIST SP 800-38D allows,
 * far beyond the sign-in volume of this product before a key rotation. The associated data binds
 * each ciphertext to what it belongs to (one session family, one pending sign-in), so a sealed
 * value copied into another row fails to open rather than decrypting as someone else's.
 *
 * Layout: `iv (12) ‖ ciphertext ‖ tag (16)`. The key id is stored beside it, never the key: a
 * keyring holds several keys so one can be retired without losing what it sealed.
 *
 * ## Where the key comes from
 *
 * Deployed environments must seal with a KMS data key (ADR-0033, P05.08.01): access then sits in
 * CloudTrail and is revocable by key policy, and the key is never in an environment variable —
 * the alternative ADR-0020 rejects. That source does not exist yet, so `resolveTokenCipher`
 * **refuses** staging and production outright. Development and test derive a key from
 * `AUTH_LOCAL_TOKEN_KEY` with HKDF; the result is fine for local data and worthless anywhere else,
 * which is why the configuration loader refuses the variable outside development and test.
 */

import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { ConfigurationError, type Config } from '../../../config/env.ts';

const ALGORITHM = 'aes-256-gcm';
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_ID = /^[A-Za-z0-9._-]{1,64}$/;
const LOCAL_KEY_SALT = 'moin/local-token-key/v1';

/** Raised for any value that does not open: wrong key, wrong context, truncated or tampered. */
export class SealedValueError extends Error {
  override readonly name = 'SealedValueError';
}

export interface Sealed {
  readonly keyId: string;
  readonly sealed: Buffer;
}

export class TokenCipher {
  readonly #keys: ReadonlyMap<string, Buffer>;
  readonly #activeKeyId: string;

  /** `keys` maps key id to 32 key bytes; `activeKeyId` seals, every key opens. */
  constructor(keys: ReadonlyMap<string, Buffer>, activeKeyId: string) {
    for (const [id, key] of keys) {
      if (!KEY_ID.test(id) || key.length !== KEY_BYTES) {
        throw new ConfigurationError(['token cipher: every key needs a valid id and 32 bytes']);
      }
    }
    if (!keys.has(activeKeyId)) {
      throw new ConfigurationError(['token cipher: the active key is not in the keyring']);
    }
    this.#keys = new Map([...keys].map(([id, key]) => [id, Buffer.from(key)]));
    this.#activeKeyId = activeKeyId;
  }

  seal(plaintext: string, context: string): Sealed {
    const key = this.#keys.get(this.#activeKeyId);
    if (key === undefined) {
      throw new SealedValueError('active key unavailable');
    }
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_BYTES });
    cipher.setAAD(Buffer.from(context, 'utf8'));
    const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return {
      keyId: this.#activeKeyId,
      sealed: Buffer.concat([iv, body, cipher.getAuthTag()]),
    };
  }

  open(value: Sealed, context: string): string {
    const key = this.#keys.get(value.keyId);
    if (key === undefined || value.sealed.length < IV_BYTES + TAG_BYTES + 1) {
      throw new SealedValueError('sealed value does not open');
    }
    const iv = value.sealed.subarray(0, IV_BYTES);
    const tag = value.sealed.subarray(value.sealed.length - TAG_BYTES);
    const body = value.sealed.subarray(IV_BYTES, value.sealed.length - TAG_BYTES);
    try {
      const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: TAG_BYTES });
      decipher.setAAD(Buffer.from(context, 'utf8'));
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
    } catch {
      // The library's message says nothing useful and nothing harmful; one error for every cause
      // keeps it that way, so a caller cannot tell a wrong key from a flipped bit.
      throw new SealedValueError('sealed value does not open');
    }
  }
}

/** The cipher this environment seals with, or a `ConfigurationError` when none may be used. */
export function resolveTokenCipher(config: Config): TokenCipher {
  if (config.NODE_ENV !== 'development' && config.NODE_ENV !== 'test') {
    throw new ConfigurationError([
      'provider-token encryption: deployed environments seal with a KMS data key (ADR-0033, ' +
        'P05.08.01), which is not built yet, so sign-in refuses to start here',
    ]);
  }
  const local = config.AUTH_LOCAL_TOKEN_KEY;
  if (local === undefined) {
    throw new ConfigurationError([
      'AUTH_LOCAL_TOKEN_KEY: sign-in needs a local token key in development and test',
    ]);
  }
  const separator = local.indexOf(':');
  const keyId = local.slice(0, separator);
  const seed = local.slice(separator + 1);
  const key = Buffer.from(
    hkdfSync('sha256', Buffer.from(seed, 'utf8'), LOCAL_KEY_SALT, keyId, KEY_BYTES),
  );
  return new TokenCipher(new Map([[keyId, key]]), keyId);
}

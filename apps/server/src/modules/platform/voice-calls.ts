/**
 * Tenant transactions for the voice role (ROADMAP S1, P11.02.04, INV-01, INV-03, INV-11).
 *
 * Lives in `platform/`, the one place allowed to hold the raw tenant pool, so the voice
 * controller and the relay never touch a pool. The organisation each call enters is the one the
 * dialled number's route resolved to (inbound) or the one the single-use session token was minted
 * for (relay): never anything from the request body.
 */

import { Inject, Injectable } from '@nestjs/common';
import {
  ingestCall,
  recordCallDisclosure,
  recordDisclosurePlayback,
  spokenBusinessName,
  withTenant,
  type DisclosurePlayback,
} from '@moin/db';
import type { Pool } from '@moin/db/pool';
import { TENANT_POOL } from './tenant-pool.module.ts';

export interface InboundCall {
  readonly organisationId: string;
  readonly callSid: string;
  readonly from?: string | undefined;
  readonly to?: string | undefined;
  readonly disclosureVersion: string;
}

export interface RecordedInbound {
  /** False when this CallSid was already stored: the webhook is a provider retry. */
  readonly created: boolean;
  /** The disclosure version stored for the call (the first one issued). */
  readonly disclosureVersion: string;
  /** The name the disclosure speaks, from the tenant. */
  readonly businessName: string;
}

@Injectable()
export class VoiceCalls {
  constructor(@Inject(TENANT_POOL) private readonly pool: Pool | null) {}

  /**
   * Stores the call and the disclosure it is issued in one transaction, idempotent by CallSid
   * (the database is the dedup: a retry finds the row and writes nothing), and reads the name the
   * disclosure speaks.
   */
  recordInbound(call: InboundCall): Promise<RecordedInbound> {
    return withTenant(this.#pool(), call.organisationId, async (client) => {
      const { call: stored, created } = await ingestCall(client, {
        providerCallSid: call.callSid,
        fromNumber: call.from,
        toNumber: call.to,
      });
      const disclosureVersion = await recordCallDisclosure(
        client,
        stored.id,
        call.disclosureVersion,
      );
      const businessName = await spokenBusinessName(client);
      return { created, disclosureVersion, businessName };
    });
  }

  /** Records playback evidence; false when the call has no issued disclosure in this tenant. */
  recordPlayback(
    organisationId: string,
    callSid: string,
    outcome: DisclosurePlayback,
  ): Promise<boolean> {
    return withTenant(this.#pool(), organisationId, (client) =>
      recordDisclosurePlayback(client, callSid, outcome),
    );
  }

  #pool(): Pool {
    if (this.pool === null) throw new Error('no tenant pool: the role has no tenant database');
    return this.pool;
  }
}

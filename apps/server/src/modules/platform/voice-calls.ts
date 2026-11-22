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
  appendAuditEvent,
  confirmDisclosurePlayed,
  ingestCall,
  recordCallDisclosure,
  spokenBusinessName,
  withTenant,
  type IssuedDisclosure,
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
  /** The disclosure inputs stored for the call: the first ones issued, on every delivery. */
  readonly disclosure: IssuedDisclosure;
}

@Injectable()
export class VoiceCalls {
  constructor(@Inject(TENANT_POOL) private readonly pool: Pool | null) {}

  /**
   * Stores the call, its creation audit and the disclosure it is issued in one transaction,
   * idempotent by CallSid (the database is the dedup: a retry finds the rows, writes nothing and
   * gets the stored disclosure inputs back).
   */
  recordInbound(call: InboundCall): Promise<RecordedInbound> {
    return withTenant(this.#pool(), call.organisationId, async (client) => {
      const { call: stored, created } = await ingestCall(client, {
        providerCallSid: call.callSid,
        fromNumber: call.from,
        toNumber: call.to,
      });
      const disclosure = await recordCallDisclosure(client, stored.id, {
        version: call.disclosureVersion,
        businessName: await spokenBusinessName(client),
      });
      if (created) {
        await appendAuditEvent(client, {
          source: 'voice',
          operation: 'call.ingest',
          targetKind: 'call',
          targetId: stored.id,
          versions: { template: disclosure.version },
          result: 'succeeded',
        });
      }
      return { created, disclosure };
    });
  }

  /** Confirms the issued disclosure played; false when the call has none in this tenant. */
  confirm(organisationId: string, callSid: string): Promise<boolean> {
    return withTenant(this.#pool(), organisationId, (client) =>
      confirmDisclosurePlayed(client, callSid),
    );
  }

  #pool(): Pool {
    if (this.pool === null) throw new Error('no tenant pool: the role has no tenant database');
    return this.pool;
  }
}

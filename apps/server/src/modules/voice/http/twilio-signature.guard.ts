/**
 * The guard on every Twilio webhook (P04.04.03).
 *
 * This is the only thing between the voice endpoints and the internet. A request that reaches a
 * controller past this guard is treated as Twilio's, and everything downstream — minting a session
 * token, starting a call, recording an outcome — depends on that being true.
 *
 * Three properties are deliberate:
 *
 * **It fails closed.** Missing header, missing configuration, unparseable URL: rejected. There is
 * no development mode that skips validation, because that mode is what ends up enabled in staging
 * and then copied to production.
 *
 * **The response says nothing.** A 403 with no body. Telling an attacker whether the signature was
 * absent, malformed or merely wrong is a free oracle, and it is the log's job to say which.
 *
 * **The log line carries reason codes only.** The rejected body is a caller's utterance or a
 * phone number (INV-12).
 */

import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { Logger } from '@moin/observability';
import { reconstructRequestUrl, validateFormWebhook } from '@moin/telephony';
import { CONFIG } from '../../../config/config.module.ts';
import type { Config } from '../../../config/env.ts';
import { LOGGER } from '../../../observability/logger.module.ts';

/**
 * Normalises the parsed form body into the flat record the signature is computed over.
 *
 * The parser can yield an array when a parameter repeats. Twilio's voice webhooks do not repeat
 * parameters, so rather than invent a join, the last value wins and the signature check is what
 * notices if that assumption was ever wrong.
 */
function formParams(body: unknown): Record<string, string> {
  if (typeof body !== 'object' || body === null) {
    return {};
  }
  const params: Record<string, string> = {};
  for (const [name, value] of Object.entries(body as Record<string, unknown>)) {
    if (Array.isArray(value)) {
      const last: unknown = value.at(-1);
      params[name] = typeof last === 'string' ? last : String(last);
    } else {
      params[name] = typeof value === 'string' ? value : String(value);
    }
  }
  return params;
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  return Array.isArray(value) ? value[0] : value;
}

@Injectable()
export class TwilioSignatureGuard implements CanActivate {
  constructor(
    @Inject(CONFIG) private readonly config: Config,
    @Inject(LOGGER) private readonly logger: Logger,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const authToken = this.config.TWILIO_AUTH_TOKEN;
    const publicOrigin = this.config.VOICE_PUBLIC_ORIGIN;

    // Unreachable when the voice role started, because the configuration loader requires both.
    // Kept because "unreachable" is a claim about another file.
    if (authToken === undefined || publicOrigin === undefined) {
      this.logger.error(
        { route: request.routeOptions.url, reason: 'telephony-config-missing' },
        'rejected webhook',
      );
      throw new ForbiddenException();
    }

    const { url, mismatches } = reconstructRequestUrl({
      publicOrigin,
      originalUrl: request.url,
      forwardedProto: firstHeader(request.headers['x-forwarded-proto']),
      forwardedHost: firstHeader(request.headers['x-forwarded-host']),
    });

    // Not a rejection: the configured origin is what was used. But a proxy that disagrees with
    // configuration means one of the two is wrong, and the symptom is every webhook failing.
    for (const mismatch of mismatches) {
      this.logger.warn(
        { route: request.routeOptions.url, reason: `forwarded-${mismatch.field}-mismatch` },
        'proxy headers disagree with the configured public origin',
      );
    }

    const params = formParams(request.body);

    const verdict = validateFormWebhook({
      authToken,
      url,
      signature: firstHeader(request.headers['x-twilio-signature']),
      params,
    });

    if (!verdict.ok) {
      this.logger.warn(
        { route: request.routeOptions.url, reason: verdict.reason },
        'rejected an unsigned or badly signed webhook',
      );
      throw new ForbiddenException();
    }
    return true;
  }
}

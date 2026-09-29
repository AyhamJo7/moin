import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { withRequestContext, type RequestContext } from '@moin/observability';

/**
 * Inbound correlation header contract.
 *
 * Fixed here, before P11's webhooks each invent their own. A caller may propagate a correlation
 * id across a chain of services; `requestId` always identifies this one request and is never
 * taken from the caller, so a client cannot collide or forge another request's identity.
 */
export const CORRELATION_HEADER = 'x-correlation-id';

/** Bound so a caller cannot use the header as an unbounded write into every log line. */
const MAX_CORRELATION_LENGTH = 128;
const SAFE_CORRELATION = /^[A-Za-z0-9._:-]+$/;

/**
 * Put a request id and a correlation id in `AsyncLocalStorage` for the lifetime of each request.
 *
 * The storage seam existed from the start but nothing populated it, so every log line was missing
 * the one field that makes lines from a single request findable — which is the entire reason
 * P02.03.04 lists correlation ids. Doing it in `onRequest` means handlers, services and anything
 * they await inherit it without threading an argument through every signature.
 */
export function registerCorrelation(app: FastifyInstance): void {
  app.addHook('onRequest', (request, reply, done) => {
    const requestId = randomUUID();
    const inbound = request.headers[CORRELATION_HEADER];
    const candidate = Array.isArray(inbound) ? inbound[0] : inbound;
    const correlationId =
      typeof candidate === 'string' &&
      candidate.length > 0 &&
      candidate.length <= MAX_CORRELATION_LENGTH &&
      SAFE_CORRELATION.test(candidate)
        ? candidate
        : requestId;

    const context: RequestContext = { requestId, correlationId };
    // Echo it back so a caller can quote the id when reporting a problem.
    void reply.header(CORRELATION_HEADER, correlationId);
    withRequestContext(context, done);
  });
}

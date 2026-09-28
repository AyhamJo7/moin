/**
 * Whether this instance is draining.
 *
 * SIGTERM and load-balancer deregistration are concurrent, not ordered: ECS and Kubernetes both
 * keep routing to a task for the deregistration-delay window after the signal arrives. A process
 * that closes its listener immediately therefore produces a burst of connection failures on every
 * rolling deploy — 5xx on the owner app, and for the voice role a WebSocket torn down mid-call
 * (INV-19).
 *
 * So the flag is set first, `/readyz` starts answering 503, the load balancer drains this
 * instance, and only then does the listener close.
 */
export class ShutdownState {
  #shuttingDown = false;

  isShuttingDown(): boolean {
    return this.#shuttingDown;
  }

  beginShutdown(): void {
    this.#shuttingDown = true;
  }
}

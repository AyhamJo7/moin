// Violates: no-console (bypasses the Pino redaction allowlist — INV-12)
export function report(caller: string): void {
  console.log('caller', caller);
}

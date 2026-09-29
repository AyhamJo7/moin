// Violates: @typescript-eslint/no-explicit-any
export function parseCaller(payload: any): string {
  return payload.from;
}

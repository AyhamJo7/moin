// Violates: @typescript-eslint/no-floating-promises (a write that may never happen — INV-06)
async function persist(): Promise<void> {
  await Promise.resolve();
}

export function handle(): void {
  persist();
}

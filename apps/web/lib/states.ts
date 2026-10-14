/**
 * View states (P13.11.01/.02): every owner view resolves to one visible state —
 * loading skeleton, content, reassuring empty, or error with correlation id
 * and retry — at the phone-first layout tokens below (360 / 768 / 1280 px).
 * Pure resolvers; the components ride separately.
 */

export type ViewState = 'loading' | 'ready' | 'empty' | 'error';

/** Owner views with a states-present requirement (P13.01.02 nav + P13.02–.09). */
export type OwnerView = 'today' | 'inbox' | 'customers' | 'knowledge' | 'settings' | 'morning';

export const OWNER_VIEWS: readonly OwnerView[] = [
  'today',
  'inbox',
  'customers',
  'knowledge',
  'settings',
  'morning',
];

export interface ViewInput {
  readonly loading: boolean;
  readonly failed: boolean;
  readonly itemCount: number;
}

/** Resolve the visible state: failure first, then loading, then empty. */
export function resolveView(input: ViewInput): ViewState {
  if (input.failed) return 'error';
  if (input.loading) return 'loading';
  return input.itemCount > 0 ? 'ready' : 'empty';
}

/** Retry is offered only from the error state. */
export function canRetry(state: ViewState): boolean {
  return state === 'error';
}

/** Resolve every owner view from its loader input (states-present per view). */
export function resolveViews(
  inputs: Readonly<Record<OwnerView, ViewInput>>,
): Readonly<Record<OwnerView, ViewState>> {
  return {
    today: resolveView(inputs.today),
    inbox: resolveView(inputs.inbox),
    customers: resolveView(inputs.customers),
    knowledge: resolveView(inputs.knowledge),
    settings: resolveView(inputs.settings),
    morning: resolveView(inputs.morning),
  };
}

/** Error line with correlation id and retry (P13.11.01). */
export function errorLine(correlationId: string): string {
  return `Etwas ist schiefgelaufen (${correlationId}). Bitte erneut versuchen.`;
}

/** Offline notice (P13.11.01). */
export function offlineLine(): string {
  return 'Keine Verbindung. Geprüft wird automatisch erneut.';
}

/** Phone-first layout tokens (P13.11.02): max content width per breakpoint. */
export const LAYOUT_TOKENS = {
  phonePx: 360,
  tabletPx: 768,
  desktopPx: 1280,
} as const;

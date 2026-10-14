/**
 * View states (P13.11.01): every owner view resolves to one visible state —
 * loading skeleton, content, reassuring empty, or error with correlation id
 * and retry. Pure resolver; the components and the PWA manifest ride
 * separately.
 */

export type ViewState = 'loading' | 'ready' | 'empty' | 'error';

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

/**
 * A plain `it` test that tries to make itself evidence through `@moin/testing` (P06.10.07).
 *
 * Neither test here uses `evidenceTest`. The first replays the sequence an independent review
 * reproduced while the package root exported the wrapper's capabilities: catch a genuine matcher
 * failure `M`, open eligibility, confirm `M`, then fail with an unrelated `E`. Every capability is
 * looked up at run time, so this file compiles whether or not the package exposes them, and the
 * names it found are put into the terminal message for the reporter to carry.
 *
 * `mutation-reporter.realvitest.test.ts` asserts both are `NOT_ELIGIBLE` and that nothing was found.
 */
import { expect, it } from 'vitest';
import * as testing from '@moin/testing';

/** Everything that would let a test open eligibility, confirm a value or write provenance. */
const CAPABILITIES = [
  'beginEvidence',
  'confirmTerminal',
  'installMatcherRecorder',
  'installProbe',
  'openInvocation',
  'closeInvocation',
  'matcherFailures',
] as const;

/** Subpaths a consumer might try. The package's `exports` map must refuse every one. */
const DEEP_IMPORTS = [
  '@moin/testing/src/mutation/evidence-state.ts',
  '@moin/testing/src/mutation/evidence-state',
  '@moin/testing/mutation/evidence-state',
  '@moin/testing/internal',
  '@moin/testing/probe',
  '@moin/testing/package.json',
] as const;

function caughtMatcherFailure(): unknown {
  try {
    expect(1).toBe(2);
  } catch (error) {
    return error;
  }
  throw new Error('unreachable: the matcher was supposed to fail');
}

async function reachableCapabilities(): Promise<string[]> {
  const found: string[] = [];
  const root = testing as unknown as Record<string, unknown>;
  for (const name of CAPABILITIES) {
    if (name in root) found.push(`@moin/testing:${name}`);
  }
  for (const specifier of DEEP_IMPORTS) {
    let module: Record<string, unknown>;
    try {
      module = (await import(/* @vite-ignore */ specifier)) as Record<string, unknown>;
    } catch {
      continue;
    }
    found.push(`${specifier}:resolved`);
    for (const name of CAPABILITIES) {
      if (name in module) found.push(`${specifier}:${name}`);
    }
  }
  return found;
}

it('a plain test replays the capability exploit through the public API', async () => {
  const matcherObject = caughtMatcherFailure();
  const root = testing as unknown as Record<string, unknown>;
  const begin = root['beginEvidence'];
  const confirm = root['confirmTerminal'];
  if (typeof begin === 'function') (begin as () => void)();
  if (typeof confirm === 'function') (confirm as (value: unknown) => void)(matcherObject);
  const found = await reachableCapabilities();
  throw new Error(
    `ordinary terminal failure; capabilities reached: ${found.length === 0 ? 'none' : found.join(', ')}`,
  );
});

it('a plain test catches a genuine matcher object and throws something else', () => {
  caughtMatcherFailure();
  throw new Error('ordinary terminal failure');
});

it('a plain test tries to wrap itself by registering an evidence test inside its body', () => {
  const matcherObject = caughtMatcherFailure();
  let refused = 'no';
  try {
    testing.evidenceTest('a nested evidence test that would rethrow the caught object', () => {
      throw matcherObject;
    });
  } catch {
    refused = 'yes';
  }
  throw new Error(`ordinary terminal failure; nested registration refused: ${refused}`);
});

/**
 * Runbook presence (P15.09.01): the four runbooks exist with non-empty
 * trigger/symptom/steps/verify sections.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const RUNBOOKS = ['dlq-replay', 'queue-backlog', 'kill-switches', 'model-change'] as const;

describe('pilot runbooks', () => {
  it('ships trigger/symptom/steps/verify in every runbook', () => {
    for (const name of RUNBOOKS) {
      const body = readFileSync(new URL(`../docs/runbooks/${name}.md`, import.meta.url), 'utf8');
      for (const section of ['## Trigger', '## Symptom', '## Steps', '## Verify']) {
        expect(body, `${name} must carry ${section}`).toContain(section);
      }
      const steps = body.slice(body.indexOf('## Steps'));
      expect(steps.split('\n').filter((line) => /^\d+\./.test(line.trim())).length).toBeGreaterThan(
        0,
      );
    }
  });
});

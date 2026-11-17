import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { excluded, parseDockerignore, touchesImage } from './image-inputs.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const RULES = parseDockerignore(readFileSync(resolve(ROOT, '.dockerignore'), 'utf8'));
const WORKFLOW = readFileSync(resolve(ROOT, '.github/workflows/container-scan.yml'), 'utf8');

describe('which changes are image inputs (P02.06.03, C3)', () => {
  it('a change outside the build context is not an input', () => {
    for (const path of [
      'docs/architecture/global-tables.md',
      'ROADMAP.md',
      'NEXT.md',
      'PLAN.md',
      '.claude/hooks/policy_guard.py',
      '.github/workflows/verify.yml',
      'infrastructure/envs/dev/main.tf',
      'apps/web/node_modules/x/index.js',
    ]) {
      expect(touchesImage([path], RULES), path).toBe(false);
    }
  });

  it('application code, packages, the lockfile and the Dockerfile are inputs', () => {
    for (const path of [
      'apps/server/src/main.ts',
      'apps/web/app/page.tsx',
      'packages/db/migrations/0083_auth_abuse_bounds.sql',
      'packages/kernel/src/index.ts',
      'pnpm-lock.yaml',
      'package.json',
      'apps/server/Dockerfile',
      '.dockerignore',
      'scripts/check-server-image-roles.sh',
      'docker-compose.yml',
    ]) {
      expect(touchesImage([path], RULES), path).toBe(true);
    }
  });

  it('follows the dockerignore reading: root-only globs and negation', () => {
    // `*.md` matches at the root only, and `!README.md` puts the root README back.
    expect(excluded('CONTRIBUTING.md', RULES)).toBe(true);
    expect(excluded('README.md', RULES)).toBe(false);
    expect(excluded('apps/web/README.md', RULES)).toBe(false);
    // `**/dist` matches at any depth, and a directory rule covers everything beneath it.
    expect(excluded('packages/db/dist/index.js', RULES)).toBe(true);
    expect(excluded('docs/a/b/c.md', RULES)).toBe(true);
  });

  it('reads patterns as Docker cleans them: trailing and leading slashes do not matter', () => {
    const rules = parseDockerignore('docs/\n/infrastructure\n./evals/\n');
    expect(excluded('docs/a.md', rules)).toBe(true);
    expect(excluded('infrastructure/main.tf', rules)).toBe(true);
    expect(excluded('evals/x.json', rules)).toBe(true);
    // A directory put back with a trailing slash is back in the context, so its files are inputs.
    const reincluded = parseDockerignore('docs\n!docs/\n');
    expect(touchesImage(['docs/architecture/global-tables.md'], reincluded)).toBe(true);
  });

  it('a pattern this script cannot read like Docker makes every change an input', () => {
    for (const unsupported of ['docs/[ab]*', 'docs/?.md', '{docs,evals}', 'docs\\x']) {
      const rules = parseDockerignore(`docs\n${unsupported}\n`);
      expect(touchesImage(['docs/a.md'], rules), unsupported).toBe(true);
    }
    // The real file uses only the supported subset, so it does not trip this.
    expect(touchesImage(['docs/a.md'], RULES)).toBe(false);
  });

  it('the scan workflow is an input although the build context excludes it', () => {
    expect(excluded('.github/workflows/container-scan.yml', RULES)).toBe(true);
    expect(touchesImage(['.github/workflows/container-scan.yml'], RULES)).toBe(true);
  });

  it('one input among many changes is enough; no change is no input', () => {
    expect(touchesImage(['docs/a.md', 'ROADMAP.md', 'apps/server/src/main.ts'], RULES)).toBe(true);
    expect(touchesImage([], RULES)).toBe(false);
  });

  it('every step after the input decision in the image job is guarded by it', () => {
    // A step left unguarded would run, or fail, on a change the decision skipped; a guard on the
    // decision itself would hide the decision.
    const job = WORKFLOW.slice(WORKFLOW.indexOf('  image:'), WORKFLOW.indexOf('  container-scan:'));
    const steps = job.split('\n      - ').slice(1);
    const decision = steps.findIndex((step) => step.includes('id: inputs'));
    expect(decision).toBeGreaterThan(0);
    const after = steps.slice(decision + 1);
    expect(after.length).toBeGreaterThan(5);
    // Every check runs on `== 'true'`; only the note that the image was skipped runs on the
    // opposite, so an inverted guard on a check fails here.
    for (const step of after) {
      const title = step.split('\n')[0] ?? '';
      const guard = title.includes('No image input changed')
        ? "if: steps.inputs.outputs.image != 'true'"
        : "if: steps.inputs.outputs.image == 'true'";
      expect(step, title).toContain(guard);
    }
    expect(after.filter((step) => step.includes("image != 'true'"))).toHaveLength(1);
    // Pushes to main and the schedule always build and scan.
    expect(steps[decision]).toContain('EVENT: ${{ github.event_name }}');
    expect(steps[decision]).toContain(`if [ "$EVENT" != 'pull_request' ]; then`);
    expect(steps[decision]).toContain('echo "image=true" >> "$GITHUB_OUTPUT"');
  });
});

/**
 * P02.01.03 / A-22: reject AI-tool mentions and tool attribution in PR titles, PR bodies, commit
 * messages and tag messages.
 *
 * The rules come from `.claude/policy/no-ai-mentions.json`, which is also what the local hook
 * enforces, so a change to the policy moves the hook and CI together. Scope is tools and
 * attribution, never the product domain: `feat(ai): ...` and "play the AI disclosure (INV-03)" are
 * correct and must pass.
 *
 *   node scripts/check-no-ai-mentions.ts --text "feat(api): add health route"
 *   node scripts/check-no-ai-mentions.ts --file pr-body.txt --file pr-title.txt
 *   node scripts/check-no-ai-mentions.ts --commits origin/main..HEAD
 *   node scripts/check-no-ai-mentions.ts --self-test
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { compile, violations, type CompiledPattern, type Policy } from './policy-regex.ts';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const POLICY_PATH = resolve(REPO_ROOT, '.claude/policy/no-ai-mentions.json');

interface Source {
  readonly label: string;
  readonly text: string;
}

function loadPolicy(): Policy {
  return JSON.parse(readFileSync(POLICY_PATH, 'utf8')) as Policy;
}

function commitMessages(range: string): Source[] {
  let out: string;
  try {
    out = execFileSync('git', ['log', '--format=%H%x00%B%x1e', range], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch {
    throw new Error(`cannot read commits for range ${JSON.stringify(range)}: no such revision range`);
  }
  return out
    .split('\x1e')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry) => {
      const [sha = '', body = ''] = entry.split('\x00');
      return { label: `commit ${sha.slice(0, 12)}`, text: body };
    });
}

function parseArgs(argv: readonly string[]): { sources: Source[]; selfTest: boolean } {
  const sources: Source[] = [];
  let selfTest = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const value = argv[i + 1];
    switch (arg) {
      case '--self-test':
        selfTest = true;
        break;
      case '--text':
        if (value === undefined) throw new Error('--text needs a value');
        sources.push({ label: 'text', text: value });
        i += 1;
        break;
      case '--file':
        if (value === undefined) throw new Error('--file needs a path');
        sources.push({ label: value, text: readFileSync(value, 'utf8') });
        i += 1;
        break;
      case '--commits':
        if (value === undefined) throw new Error('--commits needs a revision range');
        sources.push(...commitMessages(value));
        i += 1;
        break;
      default:
        throw new Error(`unknown argument: ${arg}`);
    }
  }
  return { sources, selfTest };
}

/**
 * The policy's own examples are executable: every `block_examples` entry must be caught and every
 * `allow_examples` entry must pass. This is what stops the check from degrading into a no-op — a
 * pattern that silently stops matching fails here instead of in a merged commit.
 */
function selfTest(policy: Policy, patterns: readonly CompiledPattern[]): string[] {
  const failures: string[] = [];
  for (const example of policy.block_examples) {
    if (violations(example, patterns).length === 0) {
      failures.push(`block example is NOT caught: ${JSON.stringify(example)}`);
    }
  }
  for (const example of policy.allow_examples) {
    const hits = violations(example, patterns);
    if (hits.length > 0) {
      failures.push(
        `allow example is wrongly caught by ${hits.map((h) => h.id).join(', ')}: ${JSON.stringify(example)}`,
      );
    }
  }
  return failures;
}

function main(): number {
  const { sources, selfTest: runSelfTest } = parseArgs(process.argv.slice(2));
  const policy = loadPolicy();
  const patterns = compile(policy);

  if (runSelfTest) {
    const failures = selfTest(policy, patterns);
    if (failures.length > 0) {
      console.error('no-ai-mentions self-test failed:');
      for (const failure of failures) console.error(`  - ${failure}`);
      return 1;
    }
    console.log(
      `no-ai-mentions self-test passed: ${patterns.length} patterns, ` +
        `${policy.block_examples.length} blocked and ${policy.allow_examples.length} allowed examples`,
    );
  }

  if (sources.length === 0) {
    if (runSelfTest) return 0;
    console.error('nothing to check: pass --text, --file, --commits or --self-test');
    return 2;
  }

  let failed = false;
  for (const source of sources) {
    for (const hit of violations(source.text, patterns)) {
      failed = true;
      console.error(`${source.label}: blocked by ${hit.id} — ${hit.why}`);
    }
  }
  if (failed) {
    console.error(
      '\nA-22: commits, tags and pull requests never mention AI coding tools or carry tool ' +
        'attribution. Product-domain uses such as `feat(ai):` or "AI disclosure" are fine. ' +
        'Rules: .claude/policy/no-ai-mentions.json',
    );
    return 1;
  }
  console.log(`no-ai-mentions: ${sources.length} source(s) clean`);
  return 0;
}

try {
  process.exitCode = main();
} catch (error) {
  console.error(`check-no-ai-mentions: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 2;
}

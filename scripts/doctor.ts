/**
 * `pnpm doctor` — check that this machine can actually run the stack (P02.04.05).
 *
 * Written because the failures it catches all present identically: "something is wrong with my
 * setup". Node on the wrong major, Docker Desktop not started, port 5432 already taken by a
 * system Postgres, a `.env` missing a key that was added last week. Each produces a different
 * confusing error several minutes into `pnpm dev:up`, and each is a one-line answer here.
 *
 * It reports **every** problem rather than stopping at the first, because fixing four things one
 * error at a time is four restarts.
 */

import { execFileSync } from 'node:child_process';
import { createConnection } from 'node:net';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

interface Check {
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
  /** What to do about it. Omitted when the check passed. */
  readonly fix?: string;
}

const REQUIRED_NODE_MAJOR = 24;
const REQUIRED_PNPM_MAJOR = 10;

/** Ports the local stack binds, and what would be listening if one is taken. */
const PORTS: readonly { port: number; service: string }[] = [
  { port: 5432, service: 'postgres' },
  { port: 6379, service: 'valkey' },
  { port: 9324, service: 'sqs (elasticmq)' },
  { port: 9090, service: 's3 (s3mock)' },
  { port: 1025, service: 'mail (smtp)' },
  { port: 8025, service: 'mail (ui)' },
  { port: 8080, service: 'oidc (keycloak)' },
  { port: 3000, service: 'web' },
];

function run(command: string, args: readonly string[]): string | undefined {
  try {
    return execFileSync(command, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 15_000,
    }).trim();
  } catch {
    return undefined;
  }
}

function checkNode(): Check {
  const major = Number.parseInt(process.versions.node.split('.')[0] ?? '0', 10);
  const ok = major === REQUIRED_NODE_MAJOR;
  return {
    name: 'node',
    ok,
    detail: `v${process.versions.node}`,
    ...(ok
      ? {}
      : {
          fix:
            `Node ${String(REQUIRED_NODE_MAJOR)} is required (.nvmrc). Run \`nvm use\`. ` +
            'A different major silently changes type-stripping and ESM resolution behaviour.',
        }),
  };
}

function checkPnpm(): Check {
  const version = run('pnpm', ['--version']);
  if (version === undefined) {
    return {
      name: 'pnpm',
      ok: false,
      detail: 'not found',
      fix: 'Run `corepack enable`. The version is pinned by `packageManager` in package.json.',
    };
  }
  const major = Number.parseInt(version.split('.')[0] ?? '0', 10);
  const ok = major === REQUIRED_PNPM_MAJOR;
  return {
    name: 'pnpm',
    ok,
    detail: version,
    ...(ok
      ? {}
      : { fix: `pnpm ${String(REQUIRED_PNPM_MAJOR)} is required. Run \`corepack enable\`.` }),
  };
}

function checkDocker(): Check {
  const version = run('docker', ['--version']);
  if (version === undefined) {
    return { name: 'docker', ok: false, detail: 'not installed', fix: 'Install Docker Desktop.' };
  }
  const server = run('docker', ['info', '--format', '{{.ServerVersion}}']);
  if (server === undefined || server.length === 0) {
    return {
      name: 'docker',
      ok: false,
      detail: 'client present, daemon unreachable',
      fix:
        'Start Docker Desktop. On WSL2 also enable integration for this distribution ' +
        '(Settings → Resources → WSL integration). Every datastore the stack needs is a container.',
    };
  }
  return { name: 'docker', ok: true, detail: `daemon ${server}` };
}

/** Is something already listening? A free port refuses the connection. */
function probePort(port: number): Promise<boolean> {
  return new Promise((resolvePromise) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    const settle = (inUse: boolean): void => {
      socket.destroy();
      resolvePromise(inUse);
    };
    socket.setTimeout(500);
    socket.once('connect', () => {
      settle(true);
    });
    socket.once('timeout', () => {
      settle(false);
    });
    socket.once('error', () => {
      settle(false);
    });
  });
}

async function checkPorts(): Promise<Check> {
  const stackRunning = run('docker', ['compose', 'ps', '--quiet']) ?? '';
  const taken: string[] = [];
  for (const { port, service } of PORTS) {
    if (await probePort(port)) taken.push(`${String(port)} (${service})`);
  }
  if (taken.length === 0 || stackRunning.length > 0) {
    return {
      name: 'ports',
      ok: true,
      detail: stackRunning.length > 0 ? 'in use by the local stack, which is running' : 'all free',
    };
  }
  return {
    name: 'ports',
    ok: false,
    detail: `in use by something else: ${taken.join(', ')}`,
    fix:
      'Stop whatever holds them, or run `pnpm dev:down` if an older stack is still up. ' +
      'A system Postgres on 5432 is the usual cause, and it will accept connections with the ' +
      'wrong schema rather than failing clearly.',
  };
}

/**
 * Compare `.env` against `.env.example` by key.
 *
 * Only key names are read, never values: this output is meant to be pasteable into an issue.
 */
function checkEnv(): Check {
  const examplePath = resolve(REPO_ROOT, '.env.example');
  const envPath = resolve(REPO_ROOT, '.env');
  if (!existsSync(envPath)) {
    return {
      name: 'env',
      ok: false,
      detail: 'no .env',
      fix: 'Run `cp .env.example .env`. Every value in the example is a development-only fake.',
    };
  }
  const keys = (path: string): Set<string> =>
    new Set(
      readFileSync(path, 'utf8')
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.startsWith('#'))
        .map((line) => line.split('=')[0]?.trim() ?? '')
        .filter((key) => key.length > 0),
    );
  const missing = [...keys(examplePath)].filter((key) => !keys(envPath).has(key));
  if (missing.length === 0) return { name: 'env', ok: true, detail: 'every example key present' };
  return {
    name: 'env',
    ok: false,
    detail: `missing ${String(missing.length)}: ${missing.join(', ')}`,
    fix: 'Copy the missing keys from `.env.example`. They were probably added by a recent change.',
  };
}

function checkInstall(): Check {
  const ok = existsSync(resolve(REPO_ROOT, 'node_modules', '.pnpm'));
  return {
    name: 'dependencies',
    ok,
    detail: ok ? 'installed' : 'node_modules missing',
    ...(ok ? {} : { fix: 'Run `pnpm install --frozen-lockfile`.' }),
  };
}

async function main(): Promise<number> {
  const checks: Check[] = [
    checkNode(),
    checkPnpm(),
    checkDocker(),
    checkInstall(),
    checkEnv(),
    await checkPorts(),
  ];

  const width = Math.max(...checks.map((check) => check.name.length));
  for (const check of checks) {
    console.log(`${check.ok ? '  ok  ' : ' FAIL '} ${check.name.padEnd(width)}  ${check.detail}`);
  }

  const failures = checks.filter((check) => !check.ok);
  if (failures.length === 0) {
    console.log('\nEverything this machine needs is in place.');
    return 0;
  }

  console.log('');
  for (const failure of failures) {
    console.log(`${failure.name}: ${failure.fix ?? 'see above'}`);
  }
  return 1;
}

process.exitCode = await main();

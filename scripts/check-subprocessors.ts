/**
 * P04.10.04 — every data flow is accounted for in the subprocessor register.
 *
 * The register is the document a customer's data-protection officer reads. Its failure mode is
 * not being wrong on the day it is written: it is a provider added three phases later, by someone
 * who did not know the file existed.
 *
 * So the register is tied to the diagram. Every flow in `docs/architecture/data-flow.md` must
 * appear either in a party's `flows` cell or in the explicit "stays inside our own systems" list.
 * A new flow crossing to a new provider fails this check until the register names it — and
 * "absent" and "deliberately internal" cannot look the same, which is why the internal list is
 * explicit rather than inferred.
 *
 *   node scripts/check-subprocessors.ts
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { flows } from './check-dfd-coverage.ts';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REGISTER = join(REPO_ROOT, 'docs', 'privacy', 'subprocessors.md');

const STATUSES = new Set(['NOT_REQUESTED', 'REQUESTED', 'SIGNED', 'NOT_APPLICABLE']);

/**
 * A party row: | party | role | what | region | `DPA` | flows |
 * Consume each cell once, including its padding; values are trimmed below. Overlapping `\s*`
 * and cell captures backtrack over aligned headers whose fifth cell is not a quoted DPA status.
 * Cells stay on one physical line, as Markdown table rows do.
 */
const PARTY_ROW =
  /^\|([^|\r\n]+)\|([^|\r\n]*)\|([^|\r\n]*)\|([^|\r\n]*)\|[ \t]*`([A-Z_]+)`[ \t]*\|([^|\r\n]*)\|/gm;
/** An internal-flow row: | F5 | reason | */
const INTERNAL_ROW = /^\|\s*(F\d+)\s*\|\s*([^|]+?)\s*\|\s*$/gm;
const FLOW_ID = /F\d+/g;

export interface Party {
  readonly name: string;
  readonly region: string;
  readonly dpa: string;
  readonly flows: string[];
}

export function parties(registerPath: string = REGISTER): Party[] {
  const text = readFileSync(registerPath, 'utf8');
  // The status vocabulary table also matches the party shape loosely; requiring a backticked
  // status in the fifth column and a name in the first is what separates them.
  return [...text.matchAll(PARTY_ROW)]
    .filter((m) => STATUSES.has(m[5] ?? ''))
    .map((m) => ({
      name: (m[1] ?? '').replace(/[*_]/g, '').trim(),
      region: (m[4] ?? '').trim(),
      dpa: m[5] ?? '',
      flows: [...((m[6] ?? '').match(FLOW_ID) ?? [])],
    }));
}

export function internalFlows(registerPath: string = REGISTER): string[] {
  const text = readFileSync(registerPath, 'utf8');
  const section = text.split(/^## Flows that stay inside our own systems\s*$/m)[1] ?? '';
  const upToNextHeading = section.split(/^## /m)[0] ?? '';
  return [...upToNextHeading.matchAll(INTERNAL_ROW)].map((m) => m[1] ?? '');
}

export interface RegisterCoverage {
  readonly unaccountedFlows: string[];
  readonly registeredUnknownFlows: string[];
  readonly partiesWithoutRegion: string[];
  readonly bothProcessedAndInternal: string[];
  readonly parties: number;
  readonly flows: number;
}

export function coverage(registerPath?: string): RegisterCoverage {
  const all = flows().map((f) => f.id);
  const list = parties(registerPath);
  const processed = new Set(list.flatMap((p) => p.flows));
  const internal = new Set(internalFlows(registerPath));

  return {
    unaccountedFlows: all.filter((id) => !processed.has(id) && !internal.has(id)),
    // A register that cites a flow the diagram does not have is a register describing a system
    // that no longer exists.
    registeredUnknownFlows: [...new Set([...processed, ...internal])]
      .filter((id) => !all.includes(id))
      .sort(),
    partiesWithoutRegion: list
      .filter((p) => p.region === '' || p.region === '—')
      .map((p) => p.name),
    // Both lists claiming the same flow means one of them is wrong, and nothing else would say so.
    bothProcessedAndInternal: [...processed].filter((id) => internal.has(id)).sort(),
    parties: list.length,
    flows: all.length,
  };
}

function main(): number {
  const result = coverage();
  let failed = false;

  const problems: [string[], string, string][] = [
    [
      result.unaccountedFlows,
      'Data flows no subprocessor row covers, and which are not listed as internal:',
      '  Either a party processes it, or the register says it stays inside our systems (P04.10.04).',
    ],
    [
      result.registeredUnknownFlows,
      'Flows the register cites that the data-flow diagram does not contain:',
      '  The register is derived from the diagram; one of the two is out of date.',
    ],
    [
      result.partiesWithoutRegion,
      'Parties with no processing region:',
      '  The region is where processing happens, not where the company is registered.',
    ],
    [
      result.bothProcessedAndInternal,
      'Flows listed both as processed by a party and as internal:',
      '  One of the two rows is wrong.',
    ],
  ];

  for (const [items, heading, note] of problems) {
    if (items.length > 0) {
      failed = true;
      console.error(heading);
      for (const item of items) console.error(`  - ${item}`);
      console.error(`${note}\n`);
    }
  }

  if (failed) return 1;
  console.log(
    `subprocessor register: ${String(result.parties)} parties, ` +
      `all ${String(result.flows)} data flows accounted for.`,
  );
  return 0;
}

process.exitCode = main();

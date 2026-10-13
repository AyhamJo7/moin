/**
 * Knowledge eval set (P09.11 PILOT, LG-V06/LG-V07).
 *
 * Synthetic restaurant knowledge — a Musterrestaurant plus a Gurlitt-shaped
 * fictional variant (fictional name/address, same shape: hours, service area,
 * prices, allergen policy). Every answer passes the spoken lint (ADR-0014):
 * no URLs, digit runs spaced, ≤ 350 chars.
 *
 * Two surfaces:
 * - `seedEvalSet`: creates the cards via the public `createFaqCard` (drafts
 *   never seeded — INV-08; approval path untouched). Returns card ids keyed
 *   by expectation key.
 * - `runEvalSet`: asks every question via `findAnswer`, scores correct card
 *   selection (LG-V06) and correct abstention on off-catalogue + near-miss
 *   questions (LG-V07).
 *
 * Near-miss = same topic, different card (e.g. "Samstag offen?" vs the
 * Sunday card): the eval expects the *right* card or abstention, never the
 * wrong card. Off-catalogue = no card covers it: expects null.
 */

import { createFaqCard } from './faq.ts';
import { findAnswer } from './faq.ts';
import type { TenantClient } from './tenant.ts';

export interface EvalQuestion {
  readonly text: string;
  /** Expected card key from seedEvalSet, or null for must-abstain. */
  readonly expect: string | null;
  readonly kind: 'variant' | 'near-miss' | 'off-catalogue';
}

export interface EvalReport {
  readonly total: number;
  readonly correctSelection: number;
  readonly correctAbstention: number;
  readonly abstentionOpportunities: number;
  readonly failures: readonly string[];
}

interface CardDef {
  readonly key: string;
  readonly canonical: string;
  readonly variants: readonly string[];
  readonly spoken: string;
  readonly sensitivity?: string | undefined;
}

const MUSTER_CARDS: readonly CardDef[] = [
  {
    key: 'musterrestaurant-hours',
    canonical: 'Wann hat das Musterrestaurant geöffnet?',
    variants: ['Öffnungszeiten Musterrestaurant', 'Wann ist das Musterrestaurant offen?'],
    spoken: 'Montag bis Freitag elf bis zweiundzwanzig Uhr, Samstag siebzehn bis dreiundzwanzig Uhr.',
  },
  {
    key: 'musterrestaurant-dayoff',
    canonical: 'Hat das Musterrestaurant sonntags geöffnet?',
    variants: ['Sonntag offen Musterrestaurant', 'Ruhetag Musterrestaurant'],
    spoken: 'Sonntags geschlossen, unser Ruhetag ist Sonntag.',
  },
  {
    key: 'musterrestaurant-area',
    canonical: 'Wohin liefert das Musterrestaurant?',
    variants: ['Liefergebiet Musterrestaurant', 'Liefern Sie nach Altona?'],
    spoken: 'Wir liefern in Eimsbüttel, Altona und der Neustadt.',
  },
  {
    key: 'musterrestaurant-allergen',
    canonical: 'Enthält die Lasagne Nüsse?',
    variants: ['Nussallergie Lasagne', 'Allergene in der Lasagne'],
    spoken: 'Die Lasagne enthält Walnüsse, bitte sagen Sie uns bei Allergien Bescheid.',
    sensitivity: 'sensitive',
  },
];

const GURLITT_CARDS: readonly CardDef[] = [
  {
    key: 'gurlitt-hours',
    canonical: 'Wann hat das Gurlitt-Haus geöffnet?',
    variants: ['Öffnungszeiten Gurlitt-Haus', 'Wann ist das Gurlitt-Haus offen?'],
    spoken: 'Dienstag bis Sonntag zwölf bis einundzwanzig Uhr, montags geschlossen.',
  },
  {
    key: 'gurlitt-dayoff',
    canonical: 'Hat das Gurlitt-Haus montags geöffnet?',
    variants: ['Montag offen Gurlitt-Haus', 'Ruhetag Gurlitt-Haus'],
    spoken: 'Montags geschlossen, unser Ruhetag ist Montag.',
  },
  {
    key: 'gurlitt-area',
    canonical: 'Wo liegt das Gurlitt-Haus?',
    variants: ['Adresse Gurlitt-Haus', 'Anfahrt Gurlitt-Haus'],
    spoken: 'Musterstraße eins zwei, zwei null drei fünf vier Hamburg.',
  },
  {
    key: 'gurlitt-price',
    canonical: 'Was kostet das Mittagsmenü im Gurlitt-Haus?',
    variants: ['Preis Mittagsmenü Gurlitt', 'Wie teuer ist das Mittagsmenü?'],
    spoken: 'Das Mittagsmenü kostet vierzehn Euro neunzig.',
    sensitivity: 'sensitive',
  },
];

/** All seeded cards, keyed by expectation key. */
export const EVAL_CARDS: readonly CardDef[] = [...MUSTER_CARDS, ...GURLITT_CARDS];

/**
 * Seed via the public boundary only. No approval path touched (cards serve
 * directly like every other FaqCard); ids returned keyed by card key.
 */
export async function seedEvalSet(
  client: TenantClient,
): Promise<Readonly<Record<string, string>>> {
  const ids: Record<string, string> = {};
  for (const card of EVAL_CARDS) {
    const created = await createFaqCard(client, {
      canonical: card.canonical,
      variants: [...card.variants],
      spoken: card.spoken,
      sensitivity: card.sensitivity,
    });
    ids[card.key] = created.id;
  }
  return ids;
}

/** Fixed question set: variants select, near-miss selects-or-abstains, off-catalogue abstains. */
export function evalQuestions(): readonly EvalQuestion[] {
  return [
    // Variants — must select the right card.
    { text: 'Öffnungszeiten Musterrestaurant', expect: 'musterrestaurant-hours', kind: 'variant' },
    { text: 'Sonntag offen Musterrestaurant', expect: 'musterrestaurant-dayoff', kind: 'variant' },
    { text: 'Liefern Sie nach Altona?', expect: 'musterrestaurant-area', kind: 'variant' },
    { text: 'Nussallergie Lasagne', expect: 'musterrestaurant-allergen', kind: 'variant' },
    { text: 'Öffnungszeiten Gurlitt-Haus', expect: 'gurlitt-hours', kind: 'variant' },
    { text: 'Montag offen Gurlitt-Haus', expect: 'gurlitt-dayoff', kind: 'variant' },
    { text: 'Adresse Gurlitt-Haus', expect: 'gurlitt-area', kind: 'variant' },
    { text: 'Preis Mittagsmenü Gurlitt', expect: 'gurlitt-price', kind: 'variant' },
    // Near-miss — right card or abstention, never the wrong card.
    { text: 'Sonntags geschlossen', expect: 'musterrestaurant-dayoff', kind: 'near-miss' },
    { text: 'Ruhetag Musterrestaurant', expect: 'musterrestaurant-dayoff', kind: 'near-miss' },
    { text: 'Montags geschlossen', expect: 'gurlitt-dayoff', kind: 'near-miss' },
    { text: 'Ruhetag Gurlitt-Haus', expect: 'gurlitt-dayoff', kind: 'near-miss' },
    // Off-catalogue — must abstain.
    { text: 'Bieten Sie Catering für Hochzeiten an?', expect: null, kind: 'off-catalogue' },
    { text: 'Haben Sie einen Hund im Restaurant?', expect: null, kind: 'off-catalogue' },
    { text: 'Nehmen Sie Reservierungen per Fax an?', expect: null, kind: 'off-catalogue' },
  ];
}

/**
 * Run the full set through findAnswer. A near-miss with an expectation counts
 * as selection; a null-expectation question counts as abstention. Selection
 * failures name the wrong card so the report is actionable.
 */
export async function runEvalSet(
  client: TenantClient,
  ids: Readonly<Record<string, string>>,
): Promise<EvalReport> {
  const questions = evalQuestions();
  let correctSelection = 0;
  let correctAbstention = 0;
  let abstentionOpportunities = 0;
  const failures: string[] = [];
  for (const q of questions) {
    const hit = await findAnswer(client, q.text);
    if (q.expect === null) {
      abstentionOpportunities += 1;
      if (hit === null) correctAbstention += 1;
      else failures.push(`no-abstain: "${q.text}" hit card ${hit.cardId}`);
    } else {
      const want = ids[q.expect];
      if (hit?.cardId === want) {
        correctSelection += 1;
        if (q.kind === 'near-miss') abstentionOpportunities += 0;
      } else if (hit === null && q.kind === 'near-miss') {
        // Abstention on a near-miss is acceptable (uncertainty escalates, T-22).
        correctAbstention += 1;
        abstentionOpportunities += 1;
      } else {
        failures.push(`misselection: "${q.text}" want ${q.expect} got ${hit?.cardId ?? 'null'}`);
      }
    }
  }
  return {
    total: questions.length,
    correctSelection,
    correctAbstention,
    abstentionOpportunities,
    failures,
  };
}

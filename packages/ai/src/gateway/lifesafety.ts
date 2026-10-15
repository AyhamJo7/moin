/**
 * Life-safety and scope guardrails (P10.11, INV-13/14, LG-V12).
 *
 * Detection is deterministic: a keyword/phrase lexicon OR the NLU
 * `emergency_suspected` flag routes to the deterministic EMERGENCY script
 * first — never LLM-worded advice (INV-13) — then an urgent task plus an
 * owner notification. False positives over-escalate by design: a burnt-toast
 * call that triggers the fire script costs a callback, a missed fire costs
 * everything.
 *
 * P10.11.03 (counsel review of the scripts, EXT-05) is WAITING_FOR_EXTERNAL:
 * the script texts below are engineering drafts, and `SCRIPTS_REVIEWED` stays
 * false until counsel signs — the guard appends the draft marker while it is.
 */

export type EmergencyCategory =
  'fire' | 'medical' | 'threat' | 'gas' | 'electrical' | 'water-electricity' | 'heating-vulnerable';

export const RESTAURANT_CATEGORIES: readonly EmergencyCategory[] = ['fire', 'medical', 'threat'];

export const HANDWERK_CATEGORIES: readonly EmergencyCategory[] = [
  'gas',
  'electrical',
  'water-electricity',
  'heating-vulnerable',
];

/** Counsel has NOT reviewed the scripts yet (EXT-05, P10.11.03). */
export const SCRIPTS_REVIEWED = false;

const LEXICON: Readonly<Record<EmergencyCategory, readonly string[]>> = {
  fire: ['feuer', 'brand', 'rauch', 'brennt'],
  medical: ['notarzt', 'bewusstlos', 'herzinfarkt', 'schlaganfall', 'blutung'],
  threat: ['bedrohung', 'angriff', 'waffe', 'einbrecher'],
  gas: ['gasgeruch', 'gasgeruches', 'gasleitung', 'gasnotruf'],
  electrical: ['stromschlag', 'funken', 'schmor'],
  'water-electricity': ['steckdose nass', 'wasser und strom', 'strom und wasser'],
  'heating-vulnerable': ['heizung', 'heizungsausfall', 'keine heizung'],
};

const SCRIPTS: Readonly<Record<EmergencyCategory, string>> = {
  fire: 'Bitte verlassen Sie sofort das Gebäude und rufen Sie 112 an.',
  medical: 'Bitte rufen Sie sofort 112 an und bleiben Sie bei der Person.',
  threat: 'Bitte bringen Sie sich in Sicherheit und rufen Sie 110 an.',
  gas: 'Bitte verlassen Sie sofort das Gebäude und rufen Sie 112 oder den Gasnotruf an. Kein Licht einschalten.',
  electrical: 'Bitte fassen Sie nichts an und rufen Sie 112 an.',
  'water-electricity': 'Bitte halten Sie Abstand zu Steckdosen und Wasser und rufen Sie 112 an.',
  'heating-vulnerable':
    'Bitte kümmern Sie sich um eine warme Unterkunft und rufen Sie den Notdienst an.',
};

export interface EmergencyHit {
  readonly category: EmergencyCategory;
  /** The deterministic script — counsel draft until SCRIPTS_REVIEWED. */
  readonly script: string;
  readonly draft: boolean;
}

/**
 * Match over the transcript; first category wins. A phrase must not be
 * followed by a letter — else `brauchen` trips the `rauch` rule and every
 * medical call mentioning "wir brauchen einen Notarzt" misroutes to fire.
 * Prefix compounds still match (`Küchenbrand`); genitives are listed
 * (`gasgeruches`). Menu words like `rauchig` stay quiet.
 */
export function detectEmergency(transcript: string): EmergencyHit | null {
  const lower = transcript.toLowerCase();
  const hit = (phrase: string): boolean => {
    const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`${escaped}(?![a-zäöüß])`).test(lower);
  };
  for (const [category, phrases] of Object.entries(LEXICON) as [
    EmergencyCategory,
    readonly string[],
  ][]) {
    if (phrases.some(hit)) {
      return { category, script: SCRIPTS[category], draft: !SCRIPTS_REVIEWED };
    }
  }
  return null;
}

/**
 * NLU-flag path: `emergency_suspected` escalates even when the lexicon finds
 * nothing (P10.11.02). Without a category the script is the general one.
 */
export function emergencyFromNlu(suspected: boolean): EmergencyHit | null {
  if (!suspected) return null;
  return {
    category: 'medical',
    script: 'Bitte rufen Sie sofort 112 an.',
    draft: !SCRIPTS_REVIEWED,
  };
}

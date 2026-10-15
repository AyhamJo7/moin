/**
 * Life-safety eval set (P10.11.05, LG-V12, INV-13): every category detected,
 * scripts deterministic (never LLM-worded), NLU-flag path escalates,
 * non-emergencies stay quiet, over-escalation acceptable. Synthetic only.
 */
import { describe, expect, it } from 'vitest';
import {
  detectEmergency,
  emergencyFromNlu,
  HANDWERK_CATEGORIES,
  RESTAURANT_CATEGORIES,
  SCRIPTS_REVIEWED,
} from './lifesafety.ts';
import type { EmergencyCategory } from './lifesafety.ts';

describe('life-safety guardrails', () => {
  it('detects every restaurant and Handwerk category (LG-V12)', () => {
    const cases: [string, EmergencyCategory][] = [
      ['Es brennt in der Küche, überall Rauch', 'fire'],
      ['Ein Gast ist bewusstlos, wir brauchen einen Notarzt', 'medical'],
      ['Ein Einbrecher ist im Lokal mit einer Waffe', 'threat'],
      ['Es riecht nach Gas aus der Gasleitung', 'gas'],
      ['Ich habe einen Stromschlag bekommen, es gab Funken', 'electrical'],
      ['Die Steckdose ist nass, Wasser und Strom', 'water-electricity'],
      ['Die Heizung ist ausgefallen und meine Mutter ist alt', 'heating-vulnerable'],
    ];
    for (const [transcript, category] of cases) {
      expect(detectEmergency(transcript)?.category, transcript).toBe(category);
    }
    expect(RESTAURANT_CATEGORIES).toStrictEqual(['fire', 'medical', 'threat']);
    expect(HANDWERK_CATEGORIES).toHaveLength(4);
  });

  it('scripts are deterministic template text, flagged draft until counsel (EXT-05)', () => {
    const hit = detectEmergency('Es brennt!');
    expect(hit?.script).toContain('112');
    expect(SCRIPTS_REVIEWED).toBe(false);
    expect(hit?.draft).toBe(true);
  });

  it('NLU emergency_suspected escalates even when the lexicon finds nothing', () => {
    expect(emergencyFromNlu(true)?.script).toContain('112');
    expect(emergencyFromNlu(false)).toBeNull();
  });

  it('non-emergencies stay quiet; over-escalation is acceptable', () => {
    expect(detectEmergency('Ich möchte einen Tisch für vier reservieren')).toBeNull();
    // True compounds still fire — over-escalation, accepted by design.
    expect(detectEmergency('Es gibt Küchenbrand, überall Rauch')?.category).toBe('fire');
  });
});

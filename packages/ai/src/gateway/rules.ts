/**
 * Owner rules model (P10.10, INV-10).
 *
 * A rule is data: trigger (intent, category, urgency, time window, channel,
 * caller known/unknown) → actions (priority, notify, assign, task type,
 * route-to-human). No branching, no code — evaluation is a pure function
 * over the interaction facts, most-specific match wins, ties by explicit
 * order (P10.10.02).
 *
 * `workflow_runs` persistence rides the DB side (P10.10.04): this module
 * returns the `WorkflowRun` record the caller stores, so every execution is
 * describable as a row without this module importing the database.
 */

export type RuleChannel = 'voice' | 'web' | 'staff' | 'any';
export type RuleUrgency = 'routine' | 'urgent' | 'emergency';

export interface RuleTrigger {
  readonly intent?: string;
  readonly category?: string;
  readonly urgency?: RuleUrgency;
  /** [fromHour, toHour) in Europe/Berlin; absent matches always. */
  readonly timeWindow?: readonly [number, number];
  readonly channel?: RuleChannel;
  readonly callerKnown?: boolean;
}

export interface RuleActions {
  readonly priority?: 'low' | 'normal' | 'high';
  readonly notify?: string;
  readonly assign?: string;
  readonly taskType?: string;
  readonly routeToHuman?: boolean;
}

export interface OwnerRule {
  readonly name: string;
  readonly trigger: RuleTrigger;
  readonly actions: RuleActions;
}

export interface RuleFacts {
  readonly intent: string;
  readonly category?: string;
  readonly urgency: RuleUrgency;
  readonly hour: number;
  readonly channel: 'voice' | 'web' | 'staff';
  readonly callerKnown: boolean;
  readonly afterHours: boolean;
}

export interface WorkflowRun {
  readonly ruleName: string;
  readonly actions: RuleActions;
  readonly at: string;
}

function matches(rule: OwnerRule, facts: RuleFacts): boolean {
  const t = rule.trigger;
  if (t.intent !== undefined && t.intent !== facts.intent) return false;
  if (t.category !== undefined && t.category !== facts.category) return false;
  if (t.urgency !== undefined && t.urgency !== facts.urgency) return false;
  if (t.channel !== undefined && t.channel !== 'any' && t.channel !== facts.channel) return false;
  if (t.callerKnown !== undefined && t.callerKnown !== facts.callerKnown) return false;
  if (t.timeWindow !== undefined) {
    const [from, to] = t.timeWindow;
    const inside =
      from <= to ? facts.hour >= from && facts.hour < to : facts.hour >= from || facts.hour < to;
    if (!inside) return false;
  }
  return true;
}

/** Specificity = number of set trigger fields. More fields win. */
function specificity(rule: OwnerRule): number {
  const t = rule.trigger;
  return (
    (t.intent !== undefined ? 1 : 0) +
    (t.category !== undefined ? 1 : 0) +
    (t.urgency !== undefined ? 1 : 0) +
    (t.timeWindow !== undefined ? 1 : 0) +
    (t.channel !== undefined ? 1 : 0) +
    (t.callerKnown !== undefined ? 1 : 0)
  );
}

/** Invalid rules are rejected at load: empty name, no trigger, no actions. */
export function validateRule(rule: OwnerRule): string | null {
  if (rule.name.trim().length === 0) return 'rule needs a name';
  if (Object.keys(rule.trigger).length === 0) return 'rule needs a trigger';
  if (Object.keys(rule.actions).length === 0) return 'rule needs an action';
  return null;
}

/**
 * Evaluate rules in order; most specific match wins, ties by explicit order
 * (earlier rule wins). Returns the decision plus the workflow-run record.
 */
export function evaluateRules(
  rules: readonly OwnerRule[],
  facts: RuleFacts,
  at = new Date().toISOString(),
): { readonly actions: RuleActions; readonly run: WorkflowRun } | { readonly error: string } {
  for (const rule of rules) {
    const invalid = validateRule(rule);
    if (invalid !== null) return { error: `${rule.name || '(unnamed)'}: ${invalid}` };
  }
  let best: OwnerRule | null = null;
  let bestScore = -1;
  for (const rule of rules) {
    if (!matches(rule, facts)) continue;
    const score = specificity(rule);
    if (score > bestScore) {
      best = rule;
      bestScore = score;
    }
  }
  if (best === null) return { error: 'no rule matched' };
  return { actions: best.actions, run: { ruleName: best.name, actions: best.actions, at } };
}

/**
 * Template defaults (P10.10.03): after-hours → KI nimmt an → Notfall →
 * Inhaber benachrichtigen → sonst Rückrufaufgabe.
 */
export const RESTAURANT_DEFAULT_RULES: readonly OwnerRule[] = [
  {
    name: 'after-hours-emergency-notify',
    trigger: { urgency: 'emergency' },
    actions: { priority: 'high', notify: 'owner', routeToHuman: true },
  },
  {
    name: 'after-hours-callback-task',
    trigger: { channel: 'voice' },
    actions: { priority: 'normal', taskType: 'callback' },
  },
];

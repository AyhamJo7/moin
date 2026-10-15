/**
 * Handwerk template package (P21.02 [G:SELL]): SHK/electrical intents with
 * slots, never-promise policies, German responses, canonical mapping, eval
 * set ref. Validates + binds through the P10.09 loader (no fork — data, not
 * code). Safety scripts ride EXT-05 counsel review.
 */
import {
  bindTemplate,
  loadTemplate,
  type BoundTemplate,
  type TemplatePackage,
} from './templates.ts';

/** Handwerk SHK/Elektro v1 (P21.02.01–.03). */
export const HANDWERK_V1: TemplatePackage = {
  key: 'handwerk-shk-elektro',
  version: 'v1',
  intents: {
    new_service_enquiry: {
      slots: ['problem_category', 'postal_code', 'callback_phone'],
      required: ['problem_category', 'callback_phone'],
      critical: true,
    },
    emergency_urgent: {
      slots: ['problem_category', 'address', 'callback_phone'],
      required: ['problem_category', 'callback_phone'],
      critical: true,
    },
    quote_request: {
      slots: ['problem_category', 'postal_code', 'callback_phone'],
      required: ['problem_category', 'callback_phone'],
      critical: false,
    },
    existing_customer_question: {
      slots: ['customer_number', 'callback_phone'],
      required: ['callback_phone'],
      critical: false,
    },
    create_callback: {
      slots: ['callback_phone', 'preferred_time'],
      required: ['callback_phone'],
      critical: false,
    },
  },
  policies: [
    'never-promise-technician-or-arrival-time',
    'quote-request-to-lead',
    'existing-customer-to-task',
  ],
  responses: {
    greeting: 'Guten Tag, hier ist die Anrufannahme.',
    no_promise: 'Einen Techniker oder eine Ankunftszeit kann ich nicht zusagen.',
  },
  emergencyCategories: ['water-damage', 'power-outage', 'gas-smell', 'heating-outage'],
  evalSetRef: 'handwerk-dev-v1',
};

/** Canonical intent mapping (P21 architecture): Handwerk → canonical. */
const CANONICAL: Readonly<Record<string, string>> = {
  new_service_enquiry: 'lead',
  emergency_urgent: 'escalation',
  quote_request: 'lead',
  existing_customer_question: 'task',
  create_callback: 'callback',
};

/** Canonical intent for a Handwerk intent, or null when unknown. */
export function canonicalIntent(intent: string): string | null {
  return CANONICAL[intent] ?? null;
}

/** Validate the package through the loader. */
export function handwerkValid(): boolean {
  return !('error' in loadTemplate(HANDWERK_V1));
}

/** Bind to a tenant with bounded overrides. */
export function bindHandwerk(
  overrides: Parameters<typeof bindTemplate>[1],
): BoundTemplate | { readonly error: string } {
  return bindTemplate(HANDWERK_V1, overrides);
}

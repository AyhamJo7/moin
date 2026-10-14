/**
 * PII log scanner (P15.01.02, INV-12): sample log lines must carry no phone
 * or email patterns — the allowlist redacts fields, this catches `msg`
 * templates that interpolate personal data. Pure; CI runs it over E2E logs.
 */

/** E.164-ish phone run: optional +, 7+ digits with spaces/dashes. */
const PHONE_RE = /\+?\d[\d\s\-/]{6,}\d/;

/** Minimal email shape. */
const EMAIL_RE = /[^\s@]+@[^\s@]+\.[^\s@]+/;

/** True when the line carries a phone or email pattern. */
export function lineHasPii(line: string): boolean {
  return PHONE_RE.test(line) || EMAIL_RE.test(line);
}

/** Scan lines; returns the offending line indexes. */
export function scanLines(lines: readonly string[]): readonly number[] {
  const hits: number[] = [];
  lines.forEach((line, index) => {
    if (lineHasPii(line)) hits.push(index);
  });
  return hits;
}

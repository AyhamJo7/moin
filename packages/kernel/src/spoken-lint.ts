/**
 * Spoken-answer lint (P09.04.02): voice-safety rules for owner-approved text.
 *
 * A spoken answer is read aloud by a voice agent — what looks fine on screen can
 * fail on the phone. The lint rejects:
 * - URLs (a caller cannot click a spoken link; `https://…`, `www.…` refused),
 * - long digit runs without read-out formatting (a 10-digit phone number spoken as
 *   "eins null …" is unusable — digits must carry explicit read-out: spaces, dashes,
 *   slashes or the word "null"/"Ziffern" nearby, or be short ≤ 4),
 * - length over 350 chars (the spoken budget; longer belongs in written_answer).
 *
 * ADVISORY (returned as hints, never rejections): pronunciation hints for names —
 * the lint cannot know how "Nguyen" sounds, so it flags capitalised non-German
 * letter sequences as "consider a phonetic hint" without blocking. The owner decides;
 * the hint travels with the card, and STT read-back (business_name phonetic) is
 * where mispronunciation is caught at runtime.
 *
 * Pure function, no AI, no DB. Deterministic: same text, same verdict.
 */

export interface SpokenLint {
  readonly ok: boolean;
  readonly errors: readonly string[];
  readonly hints: readonly string[];
}

const MAX_SPOKEN_LENGTH = 350;
const URL_RE = /(https?:\/\/|www\.)\S+/iu;
// Digit runs of 6+: EACH run needs its OWN read-out formatting — a separator INSIDE
// that run, or an explicit cue word in the text. Per-run, not per-answer: "PLZ 20500
// 12345678" must not pass via the innocent space in "20500 12" — the 8-digit run is
// unreadable on its own. Five-digit runs (PLZ) pass bare — addresses speak their PLZ
// digit-by-digit without a cue.
const LONG_DIGITS_RE = /\d{6,}/gu;
const READOUT_SEPARATOR_RE = /[\d][\s\-/.][\d]/u;
const READOUT_CUE_RE = /\b(null|ziffern?|nummer|telefon|rief an unter|durchwahl)\b/iu;

/** True when the digit run itself contains a spoken separator (space/dash/dot/slash). */
function hasSeparator(run: string): boolean {
  return READOUT_SEPARATOR_RE.test(`0${run}0`);
}

// Cue words anchor a run only within ~25 chars: "Unsere Telefonnummer ist 030 123
// 456, Kundenkonto 987654" must not bless 987654 via the distant Telefonnummer —
// the cue belongs to the first run, not the second. Window measured on the raw text
// around THIS run's span (either side: "987654, Ihre Telefonnummer" also counts).
const CUE_WINDOW_CHARS = 25;

// Capitalised words with non-German sequences — hint only, never reject. After the capital, the
// word ends in "qu" or in three consonants, or has a "y" that is not its last letter. Two linear
// passes instead of one pattern: `[a-zäöüß]*` followed by `y[a-zäöüß]+` overlapped and ran in
// quadratic time on a capital followed by a long run of "y".
const CAPITALISED_WORD_RE = /\b[A-ZÄÖÜ][a-zäöüß]*/gu;
const FOREIGN_TAIL_RE = /qu$|[bcdfghjklmnpqrstvwxz]{3}$|y[a-zäöüß]/u;

function foreignName(text: string): string | null {
  for (const word of text.matchAll(CAPITALISED_WORD_RE)) {
    if (FOREIGN_TAIL_RE.test(word[0].slice(1))) return word[0];
  }
  return null;
}

export function lintSpokenAnswer(text: string): SpokenLint {
  const errors: string[] = [];
  const hints: string[] = [];
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return { ok: false, errors: ['spoken answer is empty'], hints };
  }
  if (trimmed.length > MAX_SPOKEN_LENGTH) {
    errors.push(`spoken answer is ${trimmed.length} chars, budget is ${MAX_SPOKEN_LENGTH}`);
  }
  if (URL_RE.test(trimmed)) {
    errors.push('spoken answer contains a URL (callers cannot click spoken links)');
  }
  for (const run of trimmed.matchAll(LONG_DIGITS_RE)) {
    const digits = run[0];
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- matchAll/g types index as optional though always set; the fallback documents the invariant.
    const start = run.index ?? 0;
    // Per-run cue window: ±25 chars around THIS run's span. A cue next to another
    // run does not bless this one.
    const window = trimmed.slice(
      Math.max(0, start - CUE_WINDOW_CHARS),
      start + digits.length + CUE_WINDOW_CHARS,
    );
    if (!hasSeparator(digits) && !READOUT_CUE_RE.test(window)) {
      errors.push(
        `digit run "${digits}" needs read-out formatting (spaces/dashes inside the run or a cue like "Nummer")`,
      );
    }
  }
  const foreign = foreignName(trimmed);
  if (foreign !== null) {
    hints.push(
      `consider a phonetic hint for "${foreign}" (STT read-back catches mispronunciation at runtime)`,
    );
  }
  return { ok: errors.length === 0, errors, hints };
}

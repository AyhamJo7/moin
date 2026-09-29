/**
 * XML escaping for TwiML (P04.04.01).
 *
 * This exists because the values that go into TwiML are not ours. A tenant's business name, a
 * caller's name read back to them, a disclosure sentence that a German copywriter will edit — all
 * of them reach an XML attribute, and a single `&` in "Müller & Sohn" produces a document Twilio
 * rejects, which is a dropped call (INV-19). A `"` is worse: it closes the attribute, and whatever
 * follows is parsed as further attributes of the element we are building.
 *
 * So escaping is not a formatting nicety here; it is the boundary between tenant-controlled text
 * and a document that decides how a phone call behaves. It is applied by the builder to every
 * value, with no opt-out.
 */

const XML_ESCAPES: ReadonlyMap<string, string> = new Map([
  ['&', '&amp;'],
  ['<', '&lt;'],
  ['>', '&gt;'],
  ['"', '&quot;'],
  ["'", '&apos;'],
]);

/**
 * Characters XML 1.0 cannot represent at all, even as a numeric reference: the C0 controls other
 * than tab, newline and carriage return, plus the two permanently-unassigned code points. They are
 * removed rather than escaped, because there is no escape that produces a valid document.
 */
// eslint-disable-next-line no-control-regex -- the point of this expression is the control range.
const UNREPRESENTABLE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g;

/** Escapes a value for use in an XML attribute or text node. Applied to every dynamic value. */
export function escapeXml(value: string): string {
  return value.replace(UNREPRESENTABLE, '').replace(/[&<>"']/g, (char) => {
    const escaped = XML_ESCAPES.get(char);
    /* c8 ignore next -- unreachable: the character class and the map have the same five members. */
    return escaped ?? char;
  });
}

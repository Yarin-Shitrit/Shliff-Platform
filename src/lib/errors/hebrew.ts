/**
 * Server actions return Hebrew, because they are read on a Hebrew screen.
 *
 * The domain libraries throw in English — `an exception must carry a reason` —
 * and `failed()` used to hand that message straight to `role="alert"`. This is
 * the boundary where that stops (R9).
 *
 * Order matters. The map is consulted first, by prefix, because three of the
 * thrown messages interpolate an id and one of them, `unknown payment
 * channel: מזומן`, contains a Hebrew letter while being an English message.
 * Only a message that matches nothing is tested for Hebrew; if it carries
 * Hebrew it was written for a lead and passes through unchanged. Anything else
 * is logged once and replaced. A raw message is never echoed to the screen.
 *
 * "Contains a Hebrew character" alone is too weak a test for "was written for
 * a lead": this schema's own enum labels are Hebrew, so a driver-level
 * message like `invalid input value for enum payment_channel: "מזומן"` would
 * otherwise be echoed raw. The passthrough therefore also requires that the
 * message carry no Latin letters — a driver/English message that merely
 * quotes a Hebrew value still fails that test and falls back.
 */

export const HEBREW_FALLBACK = 'משהו השתבש. הפעולה לא נשמרה.';

/** Hebrew letters, `א`–`ת` and the cantillation block around them. */
const HEBREW_LETTER = /[֐-׿]/;

/** Latin letters — their presence means the message was not written for a lead. */
const LATIN_LETTER = /[A-Za-z]/;

export type HebrewErrors = ReadonlyArray<readonly [prefix: string, hebrew: string]>;

export function toHebrewError(error: unknown, map: HebrewErrors): string {
  const message = error instanceof Error ? error.message : String(error);

  const hit = map.find(([prefix]) => message.startsWith(prefix));
  if (hit) return hit[1];

  if (HEBREW_LETTER.test(message) && !LATIN_LETTER.test(message)) return message;

  console.error('unmapped server error', message);
  return HEBREW_FALLBACK;
}

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

/** How far down `.cause` this walks. Eight is deeper than any wrapper in this
 *  tree and it is also the cycle guard: `a.cause = b; b.cause = a` terminates
 *  because the bound is on steps taken, not on links visited. */
const MAX_CAUSE_DEPTH = 8;

/**
 * Every link of the `.cause` chain, outermost first.
 *
 * Drizzle wraps a driver failure: what it throws has
 * `Failed query: insert into "seasons" …` as its `message`, and the driver's
 * real message — plus `constraint` and `code` — lives on `.cause`. Reading
 * only `.message` therefore missed every map entry keyed on a Postgres
 * refusal (integration §5 A27). Moved here from
 * `src/app/(admin)/tasks/failure-messages.ts`, where one screen had the right
 * fix and the rest of the app did not.
 */
function causeChain(error: unknown): unknown[] {
  const chain: unknown[] = [];
  let current = error;
  for (let depth = 0; depth < MAX_CAUSE_DEPTH; depth += 1) {
    chain.push(current);
    if (!(current instanceof Error) || !(current.cause instanceof Error)) break;
    current = current.cause;
  }
  return chain;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function toHebrewError(error: unknown, map: HebrewErrors): string {
  const chain = causeChain(error);

  // Innermost first, then outward. The innermost link is where the specific
  // evidence lives; an outer message is a generic symptom, and a specific
  // cause claimed from a generic symptom is a guess. The outer links are
  // still tried, because a hand-thrown wrapper may be what carries the
  // meaning — but they are tried second, as the weaker evidence.
  const messages = chain.map(messageOf).reverse();

  for (const message of messages) {
    const hit = map.find(([prefix]) => message.startsWith(prefix));
    if (hit) return hit[1];
  }

  for (const message of messages) {
    if (HEBREW_LETTER.test(message) && !LATIN_LETTER.test(message)) return message;
  }

  console.error('unmapped server error', messages.join(' <- wrapped by <- '));
  return HEBREW_FALLBACK;
}

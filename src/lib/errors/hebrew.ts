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

/**
 * The same idea keyed on `constraint` instead of on message text.
 *
 * A prefix is a guess about what a message will look like; `constraint` is
 * the driver naming the refusal. The two differ most where it matters: every
 * failed insert into a table shares the wrapper's SQL text to the character,
 * so a prefix keyed on it cannot tell a duplicate name from a number out of
 * range, and a screen that keys on it will name the wrong reason confidently
 * (integration §5 A27).
 *
 * Matched exactly, never by prefix — these are identifiers, and
 * `seasons_name_unique` starting with `seasons_name` is a coincidence of
 * spelling, not a relationship.
 *
 * A separate array rather than a widened `HebrewErrors`, because the existing
 * maps are destructured as tuples by their own screens' tests; a union
 * element type would break files this task does not own.
 */
export type HebrewConstraints =
  ReadonlyArray<readonly [constraint: string, hebrew: string]>;

function constraintOf(error: unknown): string | undefined {
  if (!(error instanceof Error)) return undefined;
  const { constraint } = error as Error & { constraint?: unknown };
  return typeof constraint === 'string' ? constraint : undefined;
}

/**
 * Looked up in the global symbol registry rather than held as a module-local
 * value, because `instanceof` is one bundle away from lying: Next may place
 * two copies of this module in different chunks, and then the class a server
 * action threw is not the class this boundary imported. A registry symbol is
 * shared across copies; `Symbol()` would not be.
 */
const REFUSAL_MARK = Symbol.for('shliff.errors.hebrew-refusal');

/**
 * A refusal that says it is one (integration §5 A20).
 *
 * The alphabet passthrough below answers "is this Hebrew?" when the question
 * is "did someone mean this?". The two agree only while no refusal names the
 * thing it refuses — and the moment one interpolates an account called
 * `Petty Cash`, an email or a row id, it carries a Latin letter, fails the
 * predicate and is replaced by the generic fallback with nothing going red.
 *
 * Throwing this instead states the intent, so the message is returned
 * whatever alphabet it happens to be written in.
 */
export class HebrewRefusal extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'HebrewRefusal';
    Object.defineProperty(this, REFUSAL_MARK, { value: true });
  }
}

export function isHebrewRefusal(value: unknown): value is HebrewRefusal {
  return value instanceof Error && REFUSAL_MARK in value;
}

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

export function toHebrewError(
  error: unknown,
  map: HebrewErrors,
  constraints: HebrewConstraints = [],
): string {
  const chain = causeChain(error);

  // Outermost first, and before the map. A refusal is a decision somebody
  // made, so the outermost one was made with the most context — the opposite
  // direction from the map below, which is asking about evidence rather than
  // about intent. Before the map, because a refusal's own cause is often a
  // mapped failure, and the map's sentence is the general one while the
  // refusal is the sentence written for this moment.
  const refusal = chain.find(isHebrewRefusal);
  if (refusal) return refusal.message;

  // Innermost first, then outward. The innermost link is where the specific
  // evidence lives; an outer message is a generic symptom, and a specific
  // cause claimed from a generic symptom is a guess. The outer links are
  // still tried, because a hand-thrown wrapper may be what carries the
  // meaning — but they are tried second, as the weaker evidence.
  const innermostFirst = [...chain].reverse();
  const messages = innermostFirst.map(messageOf);

  // Before the prefix map: a constraint is the driver naming the refusal, a
  // prefix is a guess about what its message will look like.
  for (const link of innermostFirst) {
    const constraint = constraintOf(link);
    if (constraint === undefined) continue;
    const hit = constraints.find(([name]) => name === constraint);
    if (hit) return hit[1];
  }

  for (const message of messages) {
    const hit = map.find(([prefix]) => message.startsWith(prefix));
    if (hit) return hit[1];
  }

  // The inference `HebrewRefusal` replaces, kept as a fallback because bare
  // Hebrew throws still exist across the app — but no longer silent. Each
  // line logged here is one call site still resting on it, so the log is the
  // list, and the passthrough can be deleted when the list empties.
  for (const message of messages) {
    if (HEBREW_LETTER.test(message) && !LATIN_LETTER.test(message)) {
      console.warn('unmarked hebrew refusal — throw HebrewRefusal instead', message);
      return message;
    }
  }

  console.error('unmapped server error', messages.join(' <- wrapped by <- '));
  return HEBREW_FALLBACK;
}

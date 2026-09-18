import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest';
import {
  toHebrewError, HebrewRefusal, isHebrewRefusal, HEBREW_FALLBACK, type HebrewErrors,
} from './hebrew';
import { createTestDb } from '@/test/db';
import { createSeason } from '@/lib/members/roster';

const MAP: HebrewErrors = [
  ['an exception must carry a reason', 'חריג חייב לכלול סיבה.'],
  ['unknown payment channel', 'אמצעי התשלום הזה לא מוכר.'],
];

/**
 * A real `DrizzleQueryError`, not a hand-built stand-in.
 *
 * The whole of A27 is that the assumed shape and the real one differ, so a
 * fixture written from the assumption would agree with the assumption and
 * prove nothing. This runs the insert against PGlite and keeps whatever it
 * actually throws. Measured: the wrapper's own `.message` is the
 * parameterised SQL (`Failed query: insert into "seasons" …`) and the
 * driver's `duplicate key value violates unique constraint
 * "seasons_name_unique"` — plus `.constraint` and `.code === '23505'` — sits
 * one link down on `.cause`.
 */
async function thrownBy(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
  } catch (error) {
    return error;
  }
  throw new Error('expected the operation to throw, and it did not');
}

describe('toHebrewError', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('maps a listed English message to its Hebrew', () => {
    expect(toHebrewError(new Error('an exception must carry a reason'), MAP))
      .toBe('חריג חייב לכלול סיבה.');
  });

  it('matches by prefix, so an interpolated id does not break the mapping', () => {
    expect(toHebrewError(new Error('unknown payment channel: מזומן'), MAP))
      .toBe('אמצעי התשלום הזה לא מוכר.');
  });

  it('passes through a message that is already Hebrew', () => {
    const hebrew = 'קיזוז אינו מזיז מזומן, ולכן אינו נכנס לחשבון';
    expect(toHebrewError(new Error(hebrew), MAP)).toBe(hebrew);
  });

  /**
   * "Contains a Hebrew character" is too weak a test for "was written for a
   * lead": this schema's own enum labels are Hebrew, so a driver-level
   * message that merely quotes one — Latin letters and all — must not be
   * echoed raw. Requires Hebrew AND no Latin letters.
   */
  it('falls back for a message with Latin letters even if it also contains Hebrew', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const driverMessage = 'invalid input value for enum payment_channel: "מזומן"';
    expect(toHebrewError(new Error(driverMessage), MAP)).toBe(HEBREW_FALLBACK);
  });

  it('renders the generic Hebrew fallback for an unmapped English message', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(toHebrewError(new Error('duplicate key value violates unique constraint'), MAP))
      .toBe(HEBREW_FALLBACK);
  });

  it('logs the unmapped message rather than showing it', () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    toHebrewError(new Error('connection terminated unexpectedly'), MAP);
    expect(logged).toHaveBeenCalledWith(
      'unmapped server error', 'connection terminated unexpectedly',
    );
  });

  it('falls back for a thrown value that is not an Error', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(toHebrewError({ code: 42 }, MAP)).toBe(HEBREW_FALLBACK);
  });
});

/**
 * A27. `toHebrewError` used to read `error.message` and stop, so every map
 * entry keyed on a Postgres refusal missed: what Drizzle throws carries SQL
 * text as its message and hides the driver's message on `.cause`.
 *
 * Order: the innermost link is matched first, then the outer. The innermost
 * is where the specific evidence lives (the driver's message, `constraint`,
 * `code`); a wrapper's message is a generic symptom, and the platform's rule
 * is that a specific cause claimed from a generic symptom is a guess. The
 * outer message is still tried, because a hand-thrown wrapper may be the link
 * that carries the meaning — but it is tried second, as the weaker evidence.
 */
describe('toHebrewError — the cause chain', () => {
  let duplicateName: unknown;

  beforeAll(async () => {
    const db = await createTestDb();
    await createSeason(db, { name: 'ברן 26', year: 2026, flatRate: 1200 });
    duplicateName = await thrownBy(
      () => createSeason(db, { name: 'ברן 26', year: 2026, flatRate: 1200 }),
    );
  });

  const DRIVER: HebrewErrors = [
    [
      'duplicate key value violates unique constraint "seasons_name_unique"',
      'כבר קיימת שנה בשם הזה.',
    ],
  ];

  it('matches the driver message Drizzle hides on .cause', () => {
    expect(toHebrewError(duplicateName, DRIVER)).toBe('כבר קיימת שנה בשם הזה.');
  });

  /** The wrapper's SQL text is the same for every failed insert into the
   *  table, so a map that keys on it answers "which refusal was this?" with a
   *  string that cannot tell the refusals apart. The innermost link can. */
  it('prefers the innermost message when the wrapper text also matches', () => {
    const both: HebrewErrors = [
      ...DRIVER,
      ['Failed query: insert into "seasons"', 'הכנסת השנה נכשלה.'],
    ];
    expect(toHebrewError(duplicateName, both)).toBe('כבר קיימת שנה בשם הזה.');
  });

  /** The outer message keeps its chance: a hand-thrown wrapper is written by
   *  someone who meant it, and its cause is often infrastructural noise. */
  it('falls through to the outer message when the innermost carries no meaning', () => {
    const wrapped = new Error('unknown payment channel: מזומן', {
      cause: new Error('connection terminated unexpectedly'),
    });
    expect(toHebrewError(wrapped, MAP)).toBe('אמצעי התשלום הזה לא מוכר.');
  });

  /** A `cause` cycle would spin forever in an unbounded walk. The depth bound
   *  is the guard; this test is what fails if someone removes it. */
  it('terminates on a cause cycle instead of spinning', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const outer = new Error('outer');
    const inner = new Error('inner', { cause: outer });
    outer.cause = inner;
    expect(toHebrewError(outer, MAP)).toBe(HEBREW_FALLBACK);
  });
});

/**
 * A20. A refusal used to be recognised by its alphabet: Hebrew letters and no
 * Latin ones. That answers "is this Hebrew?" when the question is "did
 * someone mean this?" — and the two differ the moment a refusal names the
 * thing it is refusing. An account called `Petty Cash`, an email, a row id:
 * one Latin character and the sentence a lead needed is replaced by the
 * generic fallback, with nothing going red.
 */
describe('HebrewRefusal — a refusal that says it is one', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('returns the message verbatim', () => {
    const refusal = new HebrewRefusal('הקופה שנבחרה לא קיימת או נסגרה.');
    expect(toHebrewError(refusal, MAP)).toBe('הקופה שנבחרה לא קיימת או נסגרה.');
  });

  /** The regression the marker exists for. Identical to the case above except
   *  that it names the קופה, which is the whole reason a lead reads it. */
  it('survives naming a Latin thing, which the alphabet test could not', () => {
    const named = 'הקופה "Petty Cash" לא קיימת או נסגרה.';
    expect(toHebrewError(new HebrewRefusal(named), MAP)).toBe(named);
  });

  /** Before the map, not after it: the refusal's own cause may well be a
   *  mapped failure, and the map's sentence is the general one while the
   *  refusal is the one written for this moment. */
  it('is checked before the map, so the refusal wins over its own mapped cause', () => {
    const named = 'הקופה "Petty Cash" נסגרה, ולכן אי אפשר לרשום אליה תשלום.';
    const refusal = new HebrewRefusal(named, {
      cause: new Error('unknown payment channel: מזומן'),
    });
    expect(toHebrewError(refusal, MAP)).toBe(named);
  });

  it('is found through a wrapper, because a marked refusal stays one when wrapped', () => {
    const refusal = new HebrewRefusal('החיוב הזה כבר שולם.');
    expect(toHebrewError(new Error('Failed query: update "dues"', { cause: refusal }), MAP))
      .toBe('החיוב הזה כבר שולם.');
  });

  it('does not treat a plain Error as a refusal', () => {
    expect(isHebrewRefusal(new Error('הקופה שנבחרה לא קיימת או נסגרה.'))).toBe(false);
    expect(isHebrewRefusal(new HebrewRefusal('כן'))).toBe(true);
  });

  /** `instanceof` is one bundle away from lying: Next may put two copies of
   *  this module in different chunks, and then the class the thrower used is
   *  not the class the boundary imported. The marker is looked up in the
   *  global symbol registry, which is shared across copies. */
  it('recognises a refusal from a second copy of this module', () => {
    const foreign = new Error('הפעולה נדחתה.');
    Object.defineProperty(foreign, Symbol.for('shliff.errors.hebrew-refusal'), {
      value: true,
    });
    expect(isHebrewRefusal(foreign)).toBe(true);
    expect(toHebrewError(foreign, MAP)).toBe('הפעולה נדחתה.');
  });

  it('keeps a cause, so the underlying failure is still there to log', () => {
    const cause = new Error('connection terminated unexpectedly');
    expect(new HebrewRefusal('נכשל.', { cause }).cause).toBe(cause);
  });
});

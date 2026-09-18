import {
  toHebrewError, HEBREW_FALLBACK, type HebrewErrors,
} from '@/lib/errors/hebrew';

/**
 * Spec R9: no English reaches a Hebrew screen. Server-action failures are
 * mapped here, at the action boundary, and a message with no mapping
 * becomes a Hebrew fallback and a log line — never an echo.
 *
 * What this replaces: `assignPersonAction` caught everything and returned
 * `האדם כבר משובץ למשימה הזו`. That was true for the duplicate and wrong
 * for every other failure, including `assignPerson`'s refusal of a person
 * who was merged away — a lead told "already assigned" has no reason to go
 * and assign the survivor instead.
 *
 * The maps are passed to `toHebrewError` as arguments rather than registered
 * with it (integration §5 A7): a registry is global mutable state whose
 * behaviour depends on import order, which works in tests and fails once
 * Next code-splits the bundle.
 *
 * Every key below is an ENGLISH PREFIX of the thrown message, because that
 * is what `toHebrewError` matches on, and it matches before it considers
 * whether the message looks Hebrew. Nothing here may lean on that Hebrew
 * passthrough: these messages interpolate ids and constraint names, and a
 * single Latin character makes a message fail the passthrough test and
 * degrade to the generic fallback with nothing going red.
 */

/** The unique index on (task_id, person_id), by name. Keying on the constraint
 *  rather than on the words "duplicate key" keeps this from claiming some
 *  other table's violation — and Postgres puts the whole phrase at the head of
 *  the message, so it is a true prefix. */
export const ASSIGN_ERRORS: HebrewErrors = [
  [
    'duplicate key value violates unique constraint "task_assignments_task_person_key"',
    'האדם כבר משובץ למשימה הזו',
  ],
  [
    'that person was merged into another',
    'האדם הזה מוזג לאדם אחר — שבצו את מי שנשאר',
  ],
  ['unknown person', 'לא מצאנו את האדם הזה'],
];

/** The five refusals `validate()` in `@/lib/work/tasks` can throw. The
 *  Hebrew is the wording the old form already used client-side, so a lead
 *  sees one sentence whichever side refuses. */
export const CREATE_TASK_ERRORS: HebrewErrors = [
  ['a task needs a title', 'כותרת לא יכולה להיות ריקה.'],
  ['a shift needs a time window', 'משמרת חייבת לכלול שעת התחלה ושעת סיום.'],
  ['a shift may not end before it starts', 'משמרת לא יכולה להסתיים לפני שהתחילה.'],
  ['an event task must name its event', 'משימה באירוע חייבת להיות משויכת לאירוע.'],
  ['a task needs at least one person', 'צריך לפחות אדם אחד למשימה.'],
];

/**
 * The error the refusal is actually written on.
 *
 * Drizzle wraps a driver failure: what it throws has
 * `Failed query: insert into "task_assignments" …` as its `message`, and the
 * constraint name — the only part that says *which* refusal this is — lives
 * on `error.cause`. Matching the wrapper matches the SQL text, so
 * `task_assignments_task_person_key` is unreachable from `message` and every
 * duplicate assignment would reach a lead as the generic fallback.
 *
 * The domain's own refusals (`assignPerson`, `createTask`) are bare `Error`s
 * with no `cause`, so they are their own innermost link and are unaffected.
 */
function innermost(error: unknown): unknown {
  let current = error;
  // Bounded: a cause cycle would otherwise spin here.
  for (let depth = 0; depth < 8; depth += 1) {
    if (!(current instanceof Error) || !(current.cause instanceof Error)) return current;
    current = current.cause;
  }
  return current;
}

/** `toHebrewError`'s own fallback is one generic sentence for the whole app.
 *  Each action here has a more useful one — a lead who is told what failed
 *  knows whether to retry it or to go and fix something else. */
function withFallback(error: unknown, map: HebrewErrors, fallback: string): string {
  const hebrew = toHebrewError(innermost(error), map);
  return hebrew === HEBREW_FALLBACK ? fallback : hebrew;
}

export function assignFailureMessage(error: unknown): string {
  return withFallback(error, ASSIGN_ERRORS, 'השיבוץ נכשל. נסו שוב.');
}

export function createTaskFailureMessage(error: unknown): string {
  return withFallback(error, CREATE_TASK_ERRORS, 'יצירת המשימה נכשלה. נסו שוב.');
}

/** For actions whose only failure is infrastructural — nothing in the domain
 *  refuses a status change or an unlink, so there is no map to consult. */
export function actionFailureMessage(error: unknown, fallback: string): string {
  return withFallback(error, [], fallback);
}

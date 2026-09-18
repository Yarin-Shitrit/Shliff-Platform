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
 * `toHebrewError`'s own fallback is one generic sentence for the whole app.
 * Each action here has a more useful one — a lead who is told what failed
 * knows whether to retry it or to go and fix something else.
 *
 * The bounded `.cause` unwrapper this file used to hold was the correct fix
 * in the wrong place: it was local to one screen while every other screen
 * kept missing the same refusals. It now lives in `@/lib/errors/hebrew` and
 * `toHebrewError` walks the chain itself (integration §5 A27).
 *
 * Unwrapping here as well would not be harmless. It hands `toHebrewError` a
 * single link and discards the rest of the chain, which loses both a marked
 * `HebrewRefusal` wrapping a database failure and the outer message of a
 * hand-thrown wrapper.
 */
function withFallback(error: unknown, map: HebrewErrors, fallback: string): string {
  const hebrew = toHebrewError(error, map);
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

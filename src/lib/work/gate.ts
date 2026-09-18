import type { TaskKind } from '@/db/schema/camp';
import { formatDateFull } from '@/lib/dates';

/**
 * Dates on the tasks screen are read against one fact: when the gate opens.
 * `20/10` answers nothing on its own; `2 ימים לפני השער` is the sentence a
 * lead acts on. `seasons.starts_on` is nullable, so a season nobody has
 * dated yet gets no relative line at all rather than one invented from
 * today.
 */

export type GateRelation =
  | { kind: 'before'; days: number }
  | { kind: 'gate-day' }
  | { kind: 'after'; days: number }
  | { kind: 'no-gate' };

/**
 * The civil date in Israel, as a whole number of days.
 *
 * Comparing civil days rather than 24-hour spans is what makes a 23:40
 * task the night before the gate read `יום אחד לפני השער` instead of `0`,
 * and it sidesteps DST entirely: a civil date has no hours in it to shift.
 *
 * Built on `formatDateFull` from `src/lib/dates.ts` rather than a fresh
 * `Intl.DateTimeFormat` — the zone-correct day/month/year for "Asia/Jerusalem"
 * is already computed there, and re-deriving it here would give this module
 * a second, independent opinion about what a camp day is.
 */
function civilDay(date: Date): number {
  const [day, month, year] = formatDateFull(date).split('/').map(Number);
  return Date.UTC(year, month - 1, day) / 86_400_000;
}

export function gateRelation(date: Date, gate: Date | null): GateRelation {
  if (!gate) return { kind: 'no-gate' };
  const days = civilDay(date) - civilDay(gate);
  if (days === 0) return { kind: 'gate-day' };
  return days < 0 ? { kind: 'before', days: -days } : { kind: 'after', days };
}

/** The date-bearing columns of a task, structurally — so this module stays
 *  free of `coverage.ts` and the two can import each other's shapes without
 *  a cycle. */
export interface TaskTiming {
  kind: TaskKind;
  startsAt: Date | null;
  endsAt: Date | null;
  dueOn: Date | null;
  eventHeldOn: Date | null;
}

export type TaskWhen =
  | { kind: 'window'; startsAt: Date; endsAt: Date }
  | { kind: 'date'; at: Date }
  | { kind: 'none' };

/**
 * The one "when" a row shows. A shift's window is the most specific answer
 * it has; every other kind falls back to its own deadline, then to a start
 * time if one was set, then to the date of the event it hangs off. A
 * deliverable with none of those is genuinely undated — the רחבה sheet has
 * owned line items with no deadline — and says so rather than borrowing the
 * gate's date.
 */
export function taskWhen(task: TaskTiming): TaskWhen {
  if (task.kind === 'shift' && task.startsAt && task.endsAt) {
    return { kind: 'window', startsAt: task.startsAt, endsAt: task.endsAt };
  }
  const at = task.dueOn ?? task.startsAt ?? task.eventHeldOn;
  return at ? { kind: 'date', at } : { kind: 'none' };
}

/** What the list sorts by. A window sorts by when it starts. */
export function whenDate(when: TaskWhen): Date | null {
  if (when.kind === 'window') return when.startsAt;
  if (when.kind === 'date') return when.at;
  return null;
}

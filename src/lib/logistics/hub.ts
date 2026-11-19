import type { PlanItem, Topic, RosterOption } from './plan';
import { isOverdue, summarizePlan } from './plan';
import { buildDay, type CrewRow, type WorkDay } from './workdays';
import { CONDITION_LABELS, CONDITION_TONES, STATUS_LABELS, STATUS_TONES } from './labels';

/**
 * The overview at `/logistics`: what each logistics screen would say if it
 * were open, in one place. Pure — the page reads the rows and hands them
 * here, so every sentence on the hub can be checked without a database.
 *
 * Nothing here is a second source of truth. Every count is the one the
 * owning screen already shows (`warehouseCounts`, `acquisitionCounts`,
 * `summarizePlan`, `buildDay`), and every row carries the link to that
 * screen, because a figure on an overview that cannot be acted on from it is
 * a figure a lead has to go and find again.
 */

/** One upcoming work day as the hub draws it. */
export interface HubDay {
  day: WorkDay;
  /** The day's tasks that are not cancelled. */
  tasks: number;
  /** Open tasks of the day with nobody on them, by title. */
  uncrewed: string[];
  /** Distinct people on at least one of the day's tasks. */
  assigned: number;
  /** People on more than one of the day's tasks. */
  doubled: number;
  /** Each task with the names on it, for the next day's card. */
  lines: Array<{ id: string; title: string; done: boolean; crew: string[] }>;
}

/** The work days from today on, earliest first, each with its staffing. */
export function upcomingDays(
  days: readonly WorkDay[],
  today: string,
  items: readonly PlanItem[],
  topics: readonly Topic[],
  crew: readonly CrewRow[],
  roster: readonly RosterOption[],
): HubDay[] {
  return [...days]
    .filter((day) => day.heldOn >= today)
    .sort((a, b) => a.heldOn.localeCompare(b.heldOn))
    .map((day) => {
      const view = buildDay(day.heldOn, items, topics, crew, roster);
      return {
        day,
        tasks: view.tasks.length,
        uncrewed: view.tasks
          .filter((task) => task.item.status === 'open' && task.crew.length === 0)
          .map((task) => task.item.title),
        assigned: view.assigned,
        doubled: view.doubled.length,
        lines: view.tasks.map((task) => ({
          id: task.item.id,
          title: task.item.title,
          done: task.item.status === 'done',
          crew: task.crew.map((person) => person.displayName),
        })),
      };
    });
}

/** Which screen a row sends its reader to. The page turns it into an href. */
export type HubTarget =
  | 'plan-list' | 'plan-timeline' | 'workday'
  | 'acquisitions-to-search' | 'acquisitions-arrived' | 'warehouse-attention';

export interface AttentionRow {
  id: string;
  tone: 'bad' | 'warn';
  /** The state, as a word (R3). */
  word: string;
  headline: string;
  /** The names behind the count, when there are names. */
  detail: string | null;
  /** The owning screen's rail word. */
  screen: string;
  target: HubTarget;
}

/** What the hub was allowed to read. A `null` is a screen this account cannot open. */
export interface HubFacts {
  warehouse: { needsRepair: number; needsTesting: number } | null;
  acquisitions: { toSearch: number; unregisteredArrivals: number } | null;
  plan: { items: readonly PlanItem[]; today: string; nextDay: HubDay | null; nextDayWords: string | null } | null;
}

/** `a · b · c · ועוד 2`. */
export function namesLine(names: readonly string[], shown = 3): string {
  const head = names.slice(0, shown).join(' · ');
  return names.length > shown ? `${head} · ועוד ${names.length - shown}` : head;
}

/**
 * What needs a hand, worst first within each screen, the plan before the
 * gear: a task past its day is late today, a pump that needs repair was
 * already broken yesterday. A count of zero writes no row — the list is what
 * is wrong, and an empty list is the page saying nothing is.
 */
export function attentionRows(facts: HubFacts): AttentionRow[] {
  const rows: AttentionRow[] = [];

  if (facts.plan !== null) {
    const { items, today, nextDay, nextDayWords } = facts.plan;
    const overdue = items.filter((item) => isOverdue(item, today));
    if (overdue.length > 0) {
      rows.push({
        id: 'overdue',
        tone: 'bad',
        word: 'עבר התאריך',
        headline: overdue.length === 1
          ? 'משימה פתוחה אחת אחרי היום האחרון שלה'
          : `${overdue.length} משימות פתוחות אחרי היום האחרון שלהן`,
        detail: namesLine(overdue.map((item) => item.title)),
        screen: 'לוח עבודה',
        target: 'plan-list',
      });
    }

    const totals = summarizePlan([...items]);
    if (totals.conflicts > 0) {
      rows.push({
        id: 'conflicts',
        tone: 'bad',
        word: 'סדר סותר',
        headline: totals.conflicts === 1
          ? 'משימה אחת מתחילה לפני שמה שהיא מחכה לו נגמר'
          : `${totals.conflicts} משימות מתחילות לפני שמה שהן מחכות לו נגמר`,
        detail: null,
        screen: 'לוח עבודה',
        target: 'plan-timeline',
      });
    }

    if (nextDay !== null && nextDayWords !== null) {
      if (nextDay.uncrewed.length > 0) {
        rows.push({
          id: 'uncrewed',
          tone: 'warn',
          word: 'בלי צוות',
          headline: nextDay.uncrewed.length === 1
            ? `משימה אחת של ${nextDayWords} בלי אף משובץ`
            : `${nextDay.uncrewed.length} משימות של ${nextDayWords} בלי אף משובץ`,
          detail: namesLine(nextDay.uncrewed),
          screen: 'ימי עבודה',
          target: 'workday',
        });
      }
      if (nextDay.doubled > 0) {
        rows.push({
          id: 'doubled',
          tone: 'warn',
          word: 'שיבוץ כפול',
          headline: nextDay.doubled === 1
            ? `מישהו אחד משובץ ליותר ממשימה אחת ב${nextDayWords}`
            : `${nextDay.doubled} אנשים משובצים ליותר ממשימה אחת ב${nextDayWords}`,
          detail: null,
          screen: 'ימי עבודה',
          target: 'workday',
        });
      }
    }

    if (totals.unscheduled > 0) {
      rows.push({
        id: 'unscheduled',
        tone: 'warn',
        word: 'בלי יום',
        headline: totals.unscheduled === 1
          ? 'משימה פתוחה אחת עדיין בלי יום'
          : `${totals.unscheduled} משימות פתוחות עדיין בלי יום`,
        detail: null,
        screen: 'לוח עבודה',
        target: 'plan-list',
      });
    }
  }

  if (facts.acquisitions !== null) {
    const { toSearch, unregisteredArrivals } = facts.acquisitions;
    if (toSearch > 0) {
      rows.push({
        id: 'to-search',
        tone: STATUS_TONES.to_search === 'bad' ? 'bad' : 'warn',
        word: STATUS_LABELS.to_search,
        headline: toSearch === 1
          ? 'פריט רכש אחד שעוד לא נמצא לו מקור'
          : `${toSearch} פריטי רכש שעוד לא נמצא להם מקור`,
        detail: null,
        screen: 'רכש',
        target: 'acquisitions-to-search',
      });
    }
    if (unregisteredArrivals > 0) {
      rows.push({
        id: 'unregistered',
        tone: 'warn',
        word: 'לא נרשם במחסן',
        headline: unregisteredArrivals === 1
          ? 'פריט אחד הגיע ועדיין לא נרשם במחסן'
          : `${unregisteredArrivals} פריטים הגיעו ועדיין לא נרשמו במחסן`,
        detail: null,
        screen: 'רכש',
        target: 'acquisitions-arrived',
      });
    }
  }

  if (facts.warehouse !== null) {
    const { needsRepair, needsTesting } = facts.warehouse;
    if (needsRepair > 0) {
      rows.push({
        id: 'needs-repair',
        tone: CONDITION_TONES.needs_repair === 'bad' ? 'bad' : 'warn',
        word: CONDITION_LABELS.needs_repair,
        headline: needsRepair === 1
          ? 'פריט אחד במחסן מחכה לתיקון'
          : `${needsRepair} פריטים במחסן מחכים לתיקון`,
        detail: null,
        screen: 'מחסן',
        target: 'warehouse-attention',
      });
    }
    if (needsTesting > 0) {
      rows.push({
        id: 'needs-testing',
        tone: 'warn',
        word: CONDITION_LABELS.needs_testing,
        headline: needsTesting === 1
          ? 'פריט אחד במחסן צריך בדיקה לפני היציאה'
          : `${needsTesting} פריטים במחסן צריכים בדיקה לפני היציאה`,
        detail: null,
        screen: 'מחסן',
        target: 'warehouse-attention',
      });
    }
  }

  return rows;
}

export interface BarSegment {
  id: string;
  label: string;
  count: number;
  kind: 'ok' | 'info' | 'warn' | 'bad' | 'muted';
}

/** The share of the bar a segment takes, 0–100; zero when there is nothing to divide. */
export function shareOf(segment: BarSegment, segments: readonly BarSegment[]): number {
  const total = segments.reduce((sum, one) => sum + one.count, 0);
  return total === 0 ? 0 : (segment.count / total) * 100;
}

/** The bar read aloud: `151 תקין ומוכן, 23 דורש בדיקה`. */
export function barWords(segments: readonly BarSegment[]): string {
  return segments.map((segment) => `${segment.count} ${segment.label}`).join(', ');
}

/** How far a day is, in the camp's words. */
export function daysAway(today: string, day: string): string {
  const ms = Date.parse(`${day}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`);
  const days = Math.round(ms / 86_400_000);
  if (days <= 0) return 'היום';
  if (days === 1) return 'מחר';
  if (days === 2) return 'בעוד יומיים';
  return `בעוד ${days} ימים`;
}

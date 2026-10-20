import { formatDateFull, formatTime } from '@/lib/dates';

/**
 * When the event is, and how a clock time on one of its days becomes an
 * instant.
 *
 * The burn runs **from the gate day at 16:00 to the fifth day after it at
 * 12:00** — Monday afternoon to Saturday noon. That is a fact the camp stated,
 * so the two edges are constants here and are printed on the screen; the
 * date itself is not a constant, it is `seasons.starts_on`, the one field the
 * rest of the app already reads as "when the gate opens". A season nobody
 * has dated has no schedule, and the page says so rather than inventing one.
 *
 * Everything is reckoned in the camp's time zone. A shift at 16:00 on the
 * Monday is 13:00 UTC in summer, and Vercel's clock is UTC, so `new Date(
 * '2026-06-08T16:00')` on the server would store a shift three hours late.
 * The zone is spelled here as well as in `src/lib/dates.ts`, which does not
 * export it; the two must agree, and `shift-time.test.ts` checks that a
 * clock built here reads back the same through `formatTime` there.
 */

const CAMP_TIME_ZONE = 'Asia/Jerusalem';

/** `HH:MM`, twenty-four hours. The only shape `<input type="time">` submits. */
const CLOCK = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** `YYYY-MM-DD`, a civil day in the camp's zone. */
const CIVIL_DAY = /^\d{4}-\d{2}-\d{2}$/;

export interface Clock { hours: number; minutes: number }

/** The gate day at this clock is when the event opens. */
export const EVENT_OPENS: { dayOffset: number; clock: string } = { dayOffset: 0, clock: '16:00' };
/** The fifth day after the gate, at noon, is when it closes. */
export const EVENT_CLOSES: { dayOffset: number; clock: string } = { dayOffset: 5, clock: '12:00' };

/** Six days, gate day first. */
export const EVENT_DAY_COUNT = EVENT_CLOSES.dayOffset + 1;

export function parseClock(value: string): Clock | null {
  const match = CLOCK.exec(value.trim());
  if (!match) return null;
  return { hours: Number(match[1]), minutes: Number(match[2]) };
}

export function clockMinutes(clock: Clock): number {
  return clock.hours * 60 + clock.minutes;
}

export function isCivilDay(value: string): boolean {
  if (!CIVIL_DAY.test(value)) return false;
  const day = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(day.getTime()) && day.toISOString().slice(0, 10) === value;
}

/**
 * The civil day an instant falls on in Israel, as `YYYY-MM-DD`. Built from
 * `formatDateFull`, as `src/lib/work/gate.ts` builds its civil day, so the
 * app keeps one opinion of what a camp day is.
 */
export function campDayOf(at: Date): string {
  const [day, month, year] = formatDateFull(at).split('/');
  return `${year}-${month}-${day}`;
}

/** `2026-06-08` plus three is `2026-06-11`. Pure calendar arithmetic. */
export function addDays(day: string, count: number): string {
  const base = new Date(`${day}T00:00:00Z`);
  base.setUTCDate(base.getUTCDate() + count);
  return base.toISOString().slice(0, 10);
}

const ZONE_PARTS = new Intl.DateTimeFormat('en-GB', {
  timeZone: CAMP_TIME_ZONE,
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

/** What the camp's clock shows at an instant, as a UTC-shaped number. */
function wallClockOf(at: Date): number {
  const parts = Object.fromEntries(
    ZONE_PARTS.formatToParts(at).map((piece) => [piece.type, piece.value]),
  );
  return Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    Number(parts.hour), Number(parts.minute),
  );
}

/**
 * The instant at which the camp's clock shows `clock` on `day`.
 *
 * Two corrections rather than one: the first guess is UTC, the zone offset is
 * read off it, and the guess is moved by the difference; reading the offset
 * once more catches a guess that landed on the other side of a daylight
 * change. A clock that does not exist on that day (the hour a spring-forward
 * skips) lands on the instant the camp's clock would next show, which is
 * what a wall clock does too.
 */
export function campInstant(day: string, clock: Clock): Date {
  const [year, month, date] = day.split('-').map(Number);
  const wanted = Date.UTC(year, month - 1, date, clock.hours, clock.minutes);
  let guess = new Date(wanted);
  for (let pass = 0; pass < 2; pass += 1) {
    guess = new Date(guess.getTime() + (wanted - wallClockOf(guess)));
  }
  return guess;
}

const WEEKDAY = new Intl.DateTimeFormat('he-IL', { timeZone: CAMP_TIME_ZONE, weekday: 'long' });
const DAY_MONTH = new Intl.DateTimeFormat('en-GB', { timeZone: CAMP_TIME_ZONE, day: '2-digit', month: '2-digit' });

export interface EventDay {
  /** 0 on the gate day. */
  index: number;
  /** `YYYY-MM-DD`. */
  day: string;
  /** `יום שני`. */
  weekday: string;
  /** `08/06`. */
  dayMonth: string;
}

export interface EventWindow {
  gate: Date;
  startsAt: Date;
  endsAt: Date;
  days: EventDay[];
}

/**
 * The six days of the event and its two edges, from the gate date.
 *
 * The weekday is read from the real date rather than assumed: the camp said
 * "Monday", and `seasons.starts_on` is what a lead set, so if the two
 * disagree the screen shows the day the date actually is — a lead can then
 * move the gate, and the schedule follows.
 */
export function eventWindow(gate: Date): EventWindow {
  const first = campDayOf(gate);
  const days: EventDay[] = [];
  for (let index = 0; index < EVENT_DAY_COUNT; index += 1) {
    const day = addDays(first, index);
    const noon = campInstant(day, { hours: 12, minutes: 0 });
    days.push({ index, day, weekday: WEEKDAY.format(noon), dayMonth: DAY_MONTH.format(noon) });
  }
  return {
    gate,
    startsAt: campInstant(addDays(first, EVENT_OPENS.dayOffset), parseClock(EVENT_OPENS.clock)!),
    endsAt: campInstant(addDays(first, EVENT_CLOSES.dayOffset), parseClock(EVENT_CLOSES.clock)!),
    days,
  };
}

/**
 * `16:00–20:00`, or `22:00–02:00 (למחרת)` when the shift runs into the next
 * day. A shift that ends on the stroke of midnight is `20:00–00:00` with no
 * note: its last minute is still today's, and the note would only puzzle.
 */
export function formatWindow(startsAt: Date, endsAt: Date): string {
  const range = `${formatTime(startsAt)}–${formatTime(endsAt)}`;
  const lastMinute = new Date(endsAt.getTime() - 60_000);
  return campDayOf(startsAt) === campDayOf(lastMinute) ? range : `${range} (למחרת)`;
}

/** Whole minutes between two instants, never negative. */
export function minutesBetween(startsAt: Date, endsAt: Date): number {
  return Math.max(0, Math.round((endsAt.getTime() - startsAt.getTime()) / 60_000));
}

/** `4 שעות`, `3.5 שעות`, `45 דק׳` — the load column's unit. */
export function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes} דק׳`;
  const hours = Math.round((minutes / 60) * 10) / 10;
  return `${hours} שעות`;
}

/**
 * Days in words, for the sun card and its tent ranking. A day is one
 * `sunDateOf` wrote and `readSunDate` has already accepted: the three parts
 * are there, so these split it and never re-check its shape (P15).
 */

/** "2026-06-04" → "4.6.2026". */
export function dayText(date: string): string {
  const [year, month, day] = date.split('-');
  return `${Number(day)}.${Number(month)}.${year}`;
}

/** "2026-11-02" → "2.11", for a chip beside its weekday, or a line that names the day. */
export function shortDayText(date: string): string {
  const [, month, day] = date.split('-');
  return `${Number(day)}.${Number(month)}`;
}

const WEEKDAYS = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'] as const;

/** The day of the week a calendar day falls on — the calendar's, not a clock's. */
export function weekdayText(date: string): string {
  const [year, month, day] = date.split('-').map(Number);
  return WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
}

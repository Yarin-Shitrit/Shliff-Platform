/**
 * A12. Every date and every time on a screen is made here.
 *
 * Tables get `DD/MM/YY` or `DD/MM/YYYY` with slashes, because that is what the
 * workbook beside the screen and the bank statement beside that both show.
 * `toLocaleDateString('he-IL')` gives `7.9.2026` — dots and no padding — so
 * the parts come from `en-GB`, the locale whose numeric date already is
 * `DD/MM/YYYY`, and the separators are ours.
 *
 * Prose gets `7 בספט׳ 2026` from the table below rather than from ICU, so the
 * string does not change under the platform.
 *
 * Everything is read in the camp's timezone. Half of this data is a
 * `timestamp with time zone` out of Postgres, and a payment recorded at 01:10
 * on a Monday in Israel is 22:10 on the Sunday in UTC. A table that shows the
 * wrong day is worse than a table with no day at all.
 */

const CAMP_TIME_ZONE = 'Asia/Jerusalem';

/** Gregorian months, Hebrew, in the form a prose date needs: "7 בספט׳ 2026". */
const MONTHS = [
  'בינו׳', 'בפבר׳', 'במרץ', 'באפר׳', 'במאי', 'ביוני',
  'ביולי', 'באוג׳', 'בספט׳', 'באוק׳', 'בנוב׳', 'בדצמ׳',
] as const;

const DATE_PARTS = new Intl.DateTimeFormat('en-GB', {
  timeZone: CAMP_TIME_ZONE,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

/**
 * `hourCycle: 'h23'` and not `hour12: false`. The two are not the same: in
 * several ICU builds `hour12: false` resolves to the h24 cycle, where midnight
 * is `24:30` rather than `00:30`. A12 asks for a 24-hour clock, and h23 is the
 * one that starts the day at 00.
 */
const TIME_PARTS = new Intl.DateTimeFormat('en-GB', {
  timeZone: CAMP_TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

function part(
  formatter: Intl.DateTimeFormat,
  at: Date,
  type: Intl.DateTimeFormatPartTypes,
): string {
  const found = formatter.formatToParts(at).find((piece) => piece.type === type);
  if (!found) throw new Error(`no ${type} in the formatted date`);
  return found.value;
}

/** `07/09/26` — the table form. */
export function formatDateShort(at: Date): string {
  return `${part(DATE_PARTS, at, 'day')}/${part(DATE_PARTS, at, 'month')}/${part(DATE_PARTS, at, 'year').slice(-2)}`;
}

/** `07/09/2026` — the table form where the year is doing work. */
export function formatDateFull(at: Date): string {
  return `${part(DATE_PARTS, at, 'day')}/${part(DATE_PARTS, at, 'month')}/${part(DATE_PARTS, at, 'year')}`;
}

/** `7 בספט׳ 2026` — the prose form, with no leading zero on the day. */
export function formatDateProse(at: Date): string {
  const month = MONTHS[Number(part(DATE_PARTS, at, 'month')) - 1];
  return `${Number(part(DATE_PARTS, at, 'day'))} ${month} ${part(DATE_PARTS, at, 'year')}`;
}

/** `19:30`. Twenty-four hours, always. */
export function formatTime(at: Date): string {
  return `${part(TIME_PARTS, at, 'hour')}:${part(TIME_PARTS, at, 'minute')}`;
}

/** `07/09/26 19:30` — a shift's "when" is never just a day. */
export function formatDateTime(at: Date): string {
  return `${formatDateShort(at)} ${formatTime(at)}`;
}

import type { CellValue } from '@/lib/xlsx/types';

export interface ParsedDate {
  date: Date | null;
  /** Original text, kept whenever parsing fails. */
  raw: string;
  ok: boolean;
}

/**
 * Accepted forms: a bare ISO date, an ISO date-time, or a slash/dot date
 * with a 4-digit year. The slash/dot form is genuinely ambiguous in general
 * (03/04/2024 is 3 April under DD/MM, 4 March under MM/DD) — DD/MM is a
 * deliberate, fixed assumption for these Israeli workbooks, not a claim
 * that the format is unambiguous.
 */
const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
/**
 * `raw_grid` renders every Excel date cell with `Date.prototype.toISOString`
 * (see `toText` in `src/lib/xlsx/extract.ts`), so the text a real workbook
 * actually stores is a full timestamp like `2025-05-20T00:00:00.000Z`, not a
 * bare date. Seconds, milliseconds and the trailing `Z` are each optional so
 * `2025-05-20T00:00` also parses. A non-`Z` numeric offset (`+03:00`) is
 * deliberately NOT matched here: an offset can shift the calendar date, and
 * picking a day for it would be exactly the guess this parser refuses to
 * make. `toText` never produces one — `toISOString()` is always `Z` — so an
 * offset falls through to the final `ok: false` below with `raw` preserved.
 */
const ISO_DATETIME =
  /^(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}(?::\d{2})?(?:\.\d{3})?Z?$/;
const DMY = /^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/;

/**
 * Builds a ParsedDate from year/month/day components, or reports failure
 * without inventing a date for a calendar-invalid combination.
 */
function fromComponents(year: number, month: number, day: number, raw: string): ParsedDate {
  const date = buildDate(year, month, day);
  return date ? { date, raw, ok: true } : { date: null, raw, ok: false };
}

/**
 * Builds a UTC date from year/month(1-12)/day components and verifies it
 * round-trips exactly. `Date.UTC` silently normalizes out-of-range components
 * (e.g. day 31 in February rolls into March) instead of producing an Invalid
 * Date, so an explicit round-trip check is the only way to catch a
 * calendar-invalid date such as 31/02/2024 or 2025-02-30.
 */
function buildDate(year: number, month: number, day: number): Date | null {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (Number.isNaN(date.getTime())) return null;
  const roundTrips =
    date.getUTCFullYear() === year &&
    date.getUTCMonth() + 1 === month &&
    date.getUTCDate() === day;
  return roundTrips ? date : null;
}

/**
 * Parses a date, or reports failure. Never guesses: `01/052024` in the 23-24
 * ledger is malformed, and a calendar-invalid date like `31/02/2024` or
 * `2025-02-30` is equally rejected rather than silently rolled into the
 * next month — both are returned as raw text with ok=false so an admin can
 * correct them.
 *
 * An ISO date-time is accepted by taking its UTC calendar date and
 * discarding the time of day: an Excel date cell carries midnight, and the
 * workbook asserts nothing about when in the day a movement happened, so
 * there is no time value worth keeping.
 */
export function parseDate(value: CellValue): ParsedDate {
  if (value instanceof Date) {
    return { date: value, raw: value.toISOString(), ok: true };
  }
  if (value === null || value === undefined) {
    return { date: null, raw: '', ok: false };
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return { date: null, raw: String(value), ok: false };
  }

  const raw = value.trim();
  if (raw === '') return { date: null, raw: '', ok: false };

  const iso = ISO.exec(raw);
  if (iso) return fromComponents(+iso[1], +iso[2], +iso[3], raw);

  const isoDateTime = ISO_DATETIME.exec(raw);
  if (isoDateTime) {
    return fromComponents(+isoDateTime[1], +isoDateTime[2], +isoDateTime[3], raw);
  }

  const dmy = DMY.exec(raw);
  if (dmy) return fromComponents(+dmy[3], +dmy[2], +dmy[1], raw);

  return { date: null, raw, ok: false };
}

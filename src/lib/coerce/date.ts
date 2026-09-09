import type { CellValue } from '@/lib/xlsx/types';

export interface ParsedDate {
  date: Date | null;
  /** Original text, kept whenever parsing fails. */
  raw: string;
  ok: boolean;
}

/**
 * Accepted forms: ISO, or slash/dot dates with a 4-digit year. The slash/dot
 * form is genuinely ambiguous in general (03/04/2024 is 3 April under DD/MM,
 * 4 March under MM/DD) — DD/MM is a deliberate, fixed assumption for these
 * Israeli workbooks, not a claim that the format is unambiguous.
 */
const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
const DMY = /^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/;

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
  if (iso) {
    const date = buildDate(+iso[1], +iso[2], +iso[3]);
    return date ? { date, raw, ok: true } : { date: null, raw, ok: false };
  }

  const dmy = DMY.exec(raw);
  if (dmy) {
    const date = buildDate(+dmy[3], +dmy[2], +dmy[1]);
    return date ? { date, raw, ok: true } : { date: null, raw, ok: false };
  }

  return { date: null, raw, ok: false };
}

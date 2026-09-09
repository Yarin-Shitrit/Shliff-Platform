import type { CellValue } from '@/lib/xlsx/types';

export interface ParsedDate {
  date: Date | null;
  /** Original text, kept whenever parsing fails. */
  raw: string;
  ok: boolean;
}

/** Only strictly unambiguous forms are accepted: ISO, or slash/dot dates with a 4-digit year. */
const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
const DMY = /^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/;

/**
 * Parses a date, or reports failure. Never guesses: `01/052024` in the 23-24
 * ledger is malformed and is returned as raw text with ok=false so an admin
 * can correct it.
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
    const date = new Date(Date.UTC(+iso[1], +iso[2] - 1, +iso[3]));
    return Number.isNaN(date.getTime())
      ? { date: null, raw, ok: false }
      : { date, raw, ok: true };
  }

  const dmy = DMY.exec(raw);
  if (dmy) {
    const date = new Date(Date.UTC(+dmy[3], +dmy[2] - 1, +dmy[1]));
    return Number.isNaN(date.getTime())
      ? { date: null, raw, ok: false }
      : { date, raw, ok: true };
  }

  return { date: null, raw, ok: false };
}

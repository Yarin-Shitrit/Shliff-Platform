import type { CellValue } from '@/lib/xlsx/types';

/** Values that mean "we do not know", never zero. */
const PLACEHOLDERS = new Set(['?', '??', '???', '-', '—', 'n/a']);

export function isPlaceholder(value: CellValue): boolean {
  if (typeof value !== 'string') return false;
  return PLACEHOLDERS.has(value.trim().toLowerCase());
}

/**
 * Coerces a cell to a number, or null when it does not represent one.
 * Placeholders and descriptive text return null — never 0.
 */
export function parseNumber(value: CellValue): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'boolean' || value instanceof Date) return null;
  if (isPlaceholder(value)) return null;

  const cleaned = value.replace(/[,\s ₪]/g, '');
  if (cleaned === '') return null;
  if (!/^[-+]?\d*\.?\d+$/.test(cleaned)) return null;

  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

export type SignConvention = 'negative-is-outflow' | 'positive';

/**
 * Determines how a column encodes outflows. The 23-24 ledger writes expenses as
 * negative numbers; the 2026 ledger writes them positive in a dedicated column.
 * Decided per column, never per file.
 */
export function detectSignConvention(values: Array<number | null>): SignConvention {
  const meaningful = values.filter(
    (v): v is number => v !== null && Number.isFinite(v) && v !== 0,
  );
  if (meaningful.length === 0) return 'positive';
  return meaningful.every((v) => v < 0) ? 'negative-is-outflow' : 'positive';
}

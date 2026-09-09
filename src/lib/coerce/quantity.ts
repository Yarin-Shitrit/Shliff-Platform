import type { CellValue } from '@/lib/xlsx/types';
import { isPlaceholder, parseNumber } from './number';

export interface Quantity {
  /** Numeric part, when one exists. */
  value: number | null;
  /** Trailing unit such as "kw" or "kwh", when one exists. */
  unit: string | null;
  /** The original cell text, always preserved. */
  text: string;
  /** True when the cell held a placeholder like "?". */
  isUnknown: boolean;
}

/** Leading number (with separators) followed by an alphabetic unit, e.g. "12,000kw". */
const NUMBER_WITH_UNIT = /^([-+]?[\d, \s]*\.?\d+)\s*([A-Za-z]+)$/;

/**
 * Quantity columns in these workbooks hold three different kinds of value:
 * plain numbers (38), numbers with units ("12,000kw"), and prose
 * ("תפריט שלם לשבוע"). All three are preserved; only the first two yield a number.
 */
export function parseQuantity(value: CellValue): Quantity {
  if (value === null || value === undefined) {
    return { value: null, unit: null, text: '', isUnknown: false };
  }

  const text = value instanceof Date ? value.toISOString() : String(value).trim();

  if (isPlaceholder(value)) {
    return { value: null, unit: null, text, isUnknown: true };
  }

  const direct = parseNumber(value);
  if (direct !== null) {
    return { value: direct, unit: null, text, isUnknown: false };
  }

  const match = NUMBER_WITH_UNIT.exec(text);
  if (match) {
    const numeric = parseNumber(match[1]);
    if (numeric !== null) {
      return { value: numeric, unit: match[2], text, isUnknown: false };
    }
  }

  return { value: null, unit: null, text, isUnknown: false };
}

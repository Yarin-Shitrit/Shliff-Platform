import type { SheetGrid } from '@/lib/xlsx/types';
import type { CellRange } from '@/lib/blocks/types';
import type { BlockArchetype } from './types';
import { normalizeHebrew } from '@/lib/text/normalize';
import { findHeaderRow } from './header';

export { findHeaderRow };

export interface ColumnMapping {
  /** 1-indexed sheet column. */
  column: number;
  /** Canonical field name for this archetype. */
  field: string;
  confidence: number;
}

export interface MappingResult {
  headerRow: number | null;
  mappings: ColumnMapping[];
}

/** Header terms that identify a canonical field, per archetype. */
const FIELD_TERMS: Partial<Record<BlockArchetype, Record<string, string[]>>> = {
  ledger: {
    date: ['תאריך'],
    outflow: ['הוצאות', 'הוצאה'],
    inflow: ['הכנסות', 'הכנסה'],
    description: ['פירוט/תיאור תנועה', 'תיאור תנועה', 'פירוט', 'תיאור'],
  },
  budget_lines: {
    item: ['סוג הוצאה', 'פירוט הוצאה', 'תיאור'],
    quantity: ['כמות יחידות', 'כמות'],
    unit_cost: ['עלות ליחידה', 'מחיר'],
    total: ['עלות כוללת', 'סה"כ תשלום', 'סה"כ', 'סכום'],
    paid: ['שולם'],
    payment_method: ['מזומן/אשראי', 'אמצעי תשלום'],
    note: ['הערה', 'הערות'],
  },
  ticket_rounds: {
    round: ['סוג כרטיס', 'סבב', 'פירוט'],
    quantity: ['כמות כרטיס', 'כמות'],
    price: ['מחיר כרטיס', 'מחיר'],
    total: ['סה"כ'],
  },
  event_lines: {
    category: ['קטגוריה'],
    description: ['תיאור', 'פירוט'],
    amount: ['סכום', 'סה"כ'],
    supplier: ['ספק', 'אחראי'],
    paid: ['שולם', 'שולם/ לא שולם'],
  },
  income_channels: {
    channel: ['מקור', 'אתר ווייבז', 'ערוץ'],
    amount: ['סכום', 'כמות'],
    holder: ['אצל מי', 'איפה נרשם'],
  },
  account_balances: {
    date: ['תאריך'],
    account: ['מיקום'],
    balance: ['סכום', 'יתרה'],
  },
  member_dues: {
    person: ['שם', 'חבר'],
    amount: ['סכום'],
    paid: ['שולם'],
  },
  obligations: {
    description: ['פירוט', 'תיאור'],
    amount: ['סכום', 'סה"כ'],
    party: ['שם', 'אצל מי'],
  },
};

/**
 * Maps each column of a block onto a canonical field for its archetype by
 * matching the header cell text.
 *
 * Matching is per column and order-independent, so the same archetype maps
 * correctly whether quantity precedes price (Gagarin) or follows it (Collabo).
 * A longer matching term wins over a shorter one, so "מחיר כרטיס" beats "מחיר".
 */
export function mapColumns(
  grid: SheetGrid,
  range: CellRange,
  archetype: BlockArchetype,
): MappingResult {
  const headerRow = findHeaderRow(grid, range);
  const terms = FIELD_TERMS[archetype];
  if (headerRow === null || !terms) return { headerRow, mappings: [] };

  const mappings: ColumnMapping[] = [];
  const claimed = new Set<string>();

  for (let col = range.left; col <= range.right; col += 1) {
    const raw = grid.cells[headerRow - 1]?.[col - 1]?.text ?? '';
    if (raw === '') continue;
    const header = normalizeHebrew(raw).toLowerCase();

    let bestField: string | null = null;
    let bestTerm: string | null = null;
    let bestLength = 0;

    for (const [field, candidates] of Object.entries(terms)) {
      if (claimed.has(field)) continue;
      for (const candidate of candidates) {
        const needle = normalizeHebrew(candidate).toLowerCase();
        if (header.includes(needle) && needle.length > bestLength) {
          bestField = field;
          bestTerm = needle;
          bestLength = needle.length;
        }
      }
    }

    if (bestField) {
      claimed.add(bestField);
      mappings.push({
        column: col,
        field: bestField,
        // A full-string match against the term is more confident than the
        // header merely containing it (e.g. an extra label appended).
        confidence: header === bestTerm ? 1 : 0.8,
      });
    }
  }

  return { headerRow, mappings };
}

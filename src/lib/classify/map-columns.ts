import type { SheetGrid } from '@/lib/xlsx/types';
import type { CellRange } from '@/lib/blocks/types';
import type { BlockArchetype } from './types';
import { normalizeHebrew } from '@/lib/text/normalize';
import { findHeaderRow, headerRunEnd } from './header';
import { termMatches } from './match';

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
    date: ['תאריך'],
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
 * A single-word term must match a whole token of the header, never a mere
 * substring (see match.ts) — otherwise e.g. "שם" would false-match inside
 * "בושם". A multi-word term still matches as a substring of the header.
 *
 * Only the leading contiguous run of non-blank header cells is scanned — the
 * same run signature.ts's layoutFingerprint hashes — so a block that
 * detectBlocks bolted an unrelated table onto (e.g. the 2026 budget block's
 * trailing payment-tracker columns) never has fields invented from that
 * unrelated table, and a mapping always fits every block sharing its
 * fingerprint.
 *
 * `headerRow`, when given, is used as-is instead of calling `findHeaderRow`.
 * A caller re-mapping a block already at rest in the database (confirm.ts,
 * re-picking the archetype) can only rebuild a grid from its stored, text-only
 * `rawGrid` — one with no reliable `isMerged` flags — and `findHeaderRow`'s
 * row-scoring depends on `isMerged` to collapse a horizontally-merged
 * decorative title into the one cell it actually is (header.ts); without that,
 * such a title can outscore the real header beneath it. Passing the header
 * row the block was originally imported with — computed once against the
 * real, merge-aware grid — sidesteps re-detection, and the bad input,
 * entirely. Every existing caller omits it and behaves exactly as before.
 */
export function mapColumns(
  grid: SheetGrid,
  range: CellRange,
  archetype: BlockArchetype,
  headerRow?: number,
): MappingResult {
  const resolvedHeaderRow = headerRow ?? findHeaderRow(grid, range);
  const terms = FIELD_TERMS[archetype];
  if (resolvedHeaderRow === null || !terms) return { headerRow: resolvedHeaderRow, mappings: [] };

  const mappings: ColumnMapping[] = [];
  const claimed = new Set<string>();
  const lastCol = headerRunEnd(grid, range, resolvedHeaderRow);

  for (let col = range.left; col <= lastCol; col += 1) {
    const raw = grid.cells[resolvedHeaderRow - 1]?.[col - 1]?.text ?? '';
    if (raw === '') continue;
    const header = normalizeHebrew(raw).toLowerCase();

    let bestField: string | null = null;
    let bestTerm: string | null = null;
    let bestLength = 0;

    for (const [field, candidates] of Object.entries(terms)) {
      if (claimed.has(field)) continue;
      for (const candidate of candidates) {
        const needle = normalizeHebrew(candidate).toLowerCase();
        if (needle.length > bestLength && termMatches(candidate, header)) {
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

  return { headerRow: resolvedHeaderRow, mappings };
}

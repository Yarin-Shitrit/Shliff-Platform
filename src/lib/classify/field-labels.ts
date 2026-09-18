import { CONFIDENCE_THRESHOLD, type BlockArchetype } from './types';

/**
 * The Hebrew name of every canonical field, per archetype.
 *
 * The review screen shows these instead of the canonical identifier: a lead
 * reading `A → date` is reading the pipeline's vocabulary, not the camp's.
 * They live in their own file rather than beside FIELD_TERMS so that widening
 * the matching vocabulary and renaming what a lead sees stay separate edits;
 * the test pins the two records to the same key set, so nothing can be
 * matched that cannot be named.
 */
export const FIELD_LABELS: Record<BlockArchetype, Record<string, string>> = {
  ledger: {
    date: 'תאריך התנועה',
    description: 'תיאור',
    outflow: 'סכום — יצא',
    inflow: 'סכום — נכנס',
  },
  budget_lines: {
    item: 'סעיף',
    quantity: 'כמות',
    unit_cost: 'מחיר ליחידה',
    total: 'עלות כוללת',
    paid: 'שולם',
    payment_method: 'אמצעי תשלום',
    note: 'הערה',
  },
  ticket_rounds: {
    round: 'סוג כרטיס',
    quantity: 'כמות',
    price: 'מחיר כרטיס',
    total: 'סה״כ',
  },
  event_lines: {
    category: 'קטגוריה',
    description: 'תיאור',
    amount: 'סכום',
    supplier: 'ספק',
    paid: 'שולם',
  },
  income_channels: {
    channel: 'ערוץ',
    amount: 'סכום',
    holder: 'אצל מי',
  },
  member_dues: {
    person: 'שם',
    amount: 'סכום',
    paid: 'שולם',
  },
  obligations: {
    date: 'תאריך',
    description: 'פירוט',
    amount: 'סכום',
    party: 'שם הצד',
  },
  account_balances: {
    date: 'תאריך',
    account: 'מיקום',
    balance: 'יתרה',
  },
  unknown: {},
};

export const NOT_IMPORTED = 'לא מיובא' as const;

export function fieldLabel(archetype: BlockArchetype, field: string | null): string {
  if (field === null) return NOT_IMPORTED;
  return FIELD_LABELS[archetype][field] ?? field;
}

export type ConfidenceWord = 'בטוח' | 'כנראה' | 'לא בטוח';

/**
 * Confidence as a word, never as the number the old review card printed as
 * "ביטחון 63%". A percentage invites a lead to reason about a figure that is
 * a weighted sum of lexicon hits, which is not a probability of anything.
 *
 * The boundary between כנראה and לא בטוח is CONFIDENCE_THRESHOLD itself, so
 * the word and the "this needs a human" decision can never disagree on
 * screen. mapColumns scores an exact header match 1 and a partial one 0.8,
 * which is why בטוח starts at 1 rather than at some rounder-looking value.
 */
export function confidenceWord(confidence: number | null): ConfidenceWord {
  if (confidence === null) return 'לא בטוח';
  if (confidence >= 1) return 'בטוח';
  if (confidence >= CONFIDENCE_THRESHOLD) return 'כנראה';
  return 'לא בטוח';
}

/** Sort key for "unsure first": the screen orders by the word it shows, not
 *  by a number it hides, so the order and the badges always agree. */
export const CONFIDENCE_RANK: Record<ConfidenceWord, number> = {
  'לא בטוח': 0,
  'כנראה': 1,
  'בטוח': 2,
};

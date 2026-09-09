import type { BlockArchetype } from './types';

export interface Signal {
  /** Normalized term to look for, matched case-insensitively as a substring. */
  term: string;
  weight: number;
}

/**
 * Weighted keyword signals per archetype. Terms are matched against normalized
 * cell text from the block's first three rows and first column, so both header
 * rows and header columns contribute.
 *
 * Weights are tuning parameters: raise a weight when a real block from
 * docs/reference-data/ is misclassified, and re-run the whole classify suite.
 */
export const LEXICON: Record<Exclude<BlockArchetype, 'unknown'>, Signal[]> = {
  ledger: [
    { term: 'תיאור תנועה', weight: 4 },
    { term: 'תאריך', weight: 3 },
    // Weight 1, not 2: bare "expenses"/"income" column headers alone are too
    // generic to signal a chronological ledger over a one-off event's
    // expense/income breakdown (event_lines) or an income-channel block.
    // Without this, a dateless per-event block (e.g. a party's
    // expenses/income columns with no "תאריך") was confidently (0.58)
    // misclassified as 'ledger' from these two words alone.
    { term: 'הוצאות', weight: 1 },
    { term: 'הכנסות', weight: 1 },
    { term: 'הוצאה', weight: 1 },
    { term: 'הכנסה', weight: 1 },
    { term: 'spending', weight: 3 },
    { term: 'פירוט', weight: 1 },
  ],
  budget_lines: [
    { term: 'כמות יחידות', weight: 5 },
    { term: 'עלות ליחידה', weight: 5 },
    { term: 'עלות כוללת', weight: 4 },
    { term: 'סוג הוצאה', weight: 4 },
    { term: 'פירוט הוצאה', weight: 4 },
    { term: 'תקציב', weight: 1 },
  ],
  event_lines: [
    { term: 'קטגוריה', weight: 4 },
    { term: 'ספק', weight: 3 },
    { term: 'לוגיסטיקה', weight: 3 },
    { term: 'תפאורה', weight: 2 },
    { term: 'מוסיקה', weight: 2 },
    { term: 'ליינאפ', weight: 2 },
    { term: 'הגברה', weight: 2 },
    { term: 'אבטחה', weight: 2 },
    { term: 'עלויות', weight: 2 },
    { term: 'שולם', weight: 1 },
  ],
  ticket_rounds: [
    { term: 'סוג כרטיס', weight: 5 },
    { term: 'מחיר כרטיס', weight: 5 },
    { term: 'כמות כרטיס', weight: 5 },
    { term: 'סבב', weight: 4 },
    { term: 'מוקדמות', weight: 2 },
    { term: 'אחרי עמלה', weight: 2 },
  ],
  income_channels: [
    { term: 'איבנטבאז', weight: 4 },
    { term: 'פייבוקס', weight: 4 },
    { term: 'וייבז', weight: 4 },
    { term: 'vibez', weight: 4 },
    { term: 'ביט', weight: 3 },
    { term: 'מזומן', weight: 2 },
    { term: 'הכנסות', weight: 2 },
    // Dropped 'בר' (weight 1, "bar"/beverage sales): a bare two-letter
    // substring that false-matches inside common unrelated words (ברגים
    // "screws", חבר "member", כבר "already", עבר "past"...). It contributed
    // just enough, combined with 'ביט' false-matching inside ביטים ("drill
    // bits") on an unrelated supply list, to push a vendor-expense block
    // above the confidence threshold as a wrongly-confident income_channels
    // guess. Its true-positive value was marginal next to its false-positive
    // rate, so it is removed rather than reweighted.
  ],
  member_dues: [
    { term: 'דמי קאמפ', weight: 5 },
    { term: 'חברי מחנה', weight: 4 },
    { term: 'חריגים', weight: 4 },
    { term: 'רגילים', weight: 3 },
  ],
  obligations: [
    { term: 'קיזוז', weight: 5 },
    // Weight 2, not 4: bare 'חוב' ("debt") is also a common single line-item
    // label inside plain fundraising/budget target lists (e.g. a "יעד גיוס"
    // block listing needed spend categories, one of which is literally
    // labelled "חוב"), which is not the debts-and-offsets archetype. At
    // weight 4 that one word alone pushed two such budget blocks in
    // docs/reference-data/ to a confident (0.58-0.71) 'obligations' label.
    // At weight 2 it still correctly identifies the real חוב יוסף block
    // (which corroborates with 'קיזוז' and 'יתרה' too, so its score stays
    // saturated), while those single-word false positives now fall below
    // CONFIDENCE_THRESHOLD instead of being silently trusted.
    { term: 'חוב', weight: 2 },
    { term: 'להחזיר', weight: 3 },
    { term: 'להכין מזומן', weight: 4 },
    { term: 'יתרה', weight: 2 },
  ],
  account_balances: [
    { term: 'איפה נרשם', weight: 5 },
    { term: 'אצל מי', weight: 5 },
    { term: 'מיקום', weight: 4 },
    { term: 'קופת מזומן', weight: 4 },
    { term: 'עו"ש', weight: 4 },
  ],
};

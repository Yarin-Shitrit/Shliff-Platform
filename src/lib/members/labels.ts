import type { DuesState } from './people-list';

/**
 * The Hebrew words for the two enum-ish columns a member row carries.
 *
 * One copy, because three screens had their own and the CSV export had none —
 * it wrote `member` and `flat` into a file the camp opens in Excel. A word a
 * lead reads should not depend on which screen produced it.
 */
export const ROLE_LABELS: Record<string, string> = {
  member: 'חבר/ה',
  lead: 'ראש/ת צוות',
};

export const DUE_KIND_LABELS: Record<string, string> = {
  flat: 'רגיל',
  exception: 'חריג',
};

/** An unmapped value renders as itself: an unknown role is still a role, and
 *  a blank cell would hide it. */
export function roleLabel(role: string): string {
  return ROLE_LABELS[role] ?? role;
}

export function dueKindLabel(kind: string): string {
  return DUE_KIND_LABELS[kind] ?? kind;
}

/**
 * Ungendered, every one of them. The mock writes `טרם שילמה` / `שילמה חלקית` /
 * `פטורה`; the schema records no gender and the roster is mixed, so those
 * forms cannot be produced from the data at all. These are passive and say the
 * same thing about the due rather than about the person.
 *
 * Here and not in `people-table.tsx`, where it was born, because that file is
 * a `'use client'` module and this map is read by two Server Components (the
 * people page's filter chips and the peek drawer). Across that boundary a
 * client module's non-component export is an opaque client reference, not the
 * object — every lookup came back `undefined`, so the drawer's pill lost its
 * word, the סינון menu opened empty and the active chip read `דמי קאמפ:` with
 * nothing after it. A plain module on the server side of the line has no such
 * boundary. `client-boundary.test.ts` keeps it that way.
 */
export const DUES_STATE_LABELS: Record<DuesState, string> = {
  paid: 'שולם',
  offset: 'שולם בקיזוז',
  partial: 'שולם חלקית',
  unpaid: 'טרם שולם',
  exempt: 'פטור',
  none: 'אין חיוב',
};

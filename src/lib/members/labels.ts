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

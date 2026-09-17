import type { MemberFeeRow } from '@/lib/fees/season-fees';
import type { PaymentRow } from '@/lib/fees/payments';

/**
 * What "טרם שילמו" means, in one place.
 *
 * A tile, a tab and a table row on `/fees` all answer the same question, and
 * before this module each of them answered it with its own inline predicate.
 * Everything here is pure and takes the rows the page already fetched, so the
 * number on a tab and the rows under it cannot drift apart.
 *
 * The views are filters, not a partition: `exception` and `offset` overlap the
 * others on purpose. `all` is the default and is left out of generated URLs.
 */
export type FeeView =
  | 'all' | 'unpaid' | 'partial' | 'paid' | 'exception' | 'offset' | 'nodue';

export const FEE_VIEWS: ReadonlyArray<{ id: FeeView; label: string }> = [
  { id: 'all', label: 'הכול' },
  { id: 'unpaid', label: 'טרם שילמו' },
  { id: 'partial', label: 'שילמו חלקית' },
  { id: 'paid', label: 'שולם' },
  { id: 'exception', label: 'חריגים' },
  { id: 'offset', label: 'קוזזו' },
  { id: 'nodue', label: 'בלי חיוב' },
];

export function parseFeeView(value: string | undefined): FeeView {
  const hit = FEE_VIEWS.find((view) => view.id === value);
  return hit ? hit.id : 'all';
}

/**
 * The word the row's pill carries. Written about the due rather than the
 * person: `persons` has no gender column, and guessing one from a Hebrew first
 * name is exactly what this system refuses to do.
 */
export type PaymentState =
  | 'nodue' | 'nothing-to-collect' | 'unpaid' | 'partial' | 'paid' | 'paid-by-offset';

export function paymentStateOf(row: MemberFeeRow): PaymentState {
  if (row.dueId === null) return 'nodue';
  if (row.amountAgorot === 0) return 'nothing-to-collect';
  if (row.outstandingAgorot > 0) return row.paidAgorot > 0 ? 'partial' : 'unpaid';
  const offsetOnly = row.payments.length > 0
    && row.payments.every((entry) => entry.channel === 'קיזוז');
  return offsetOnly ? 'paid-by-offset' : 'paid';
}

export function matchesView(row: MemberFeeRow, view: FeeView): boolean {
  const state = paymentStateOf(row);
  switch (view) {
    case 'all': return true;
    case 'unpaid': return state === 'unpaid';
    case 'partial': return state === 'partial';
    case 'paid':
      return state === 'paid' || state === 'paid-by-offset'
        || state === 'nothing-to-collect';
    case 'exception': return row.kind === 'exception';
    case 'offset': return row.payments.some((entry) => entry.channel === 'קיזוז');
    case 'nodue': return state === 'nodue';
  }
}

export function rowsForView(rows: MemberFeeRow[], view: FeeView): MemberFeeRow[] {
  return rows.filter((row) => matchesView(row, view));
}

export function viewCounts(rows: MemberFeeRow[]): Record<FeeView, number> {
  const counts = Object.fromEntries(
    FEE_VIEWS.map((view) => [view.id, 0]),
  ) as Record<FeeView, number>;
  for (const row of rows) {
    for (const view of FEE_VIEWS) {
      if (matchesView(row, view.id)) counts[view.id] += 1;
    }
  }
  return counts;
}

/** Has a due, and something is still owed on it. */
export function isPayable(row: MemberFeeRow): boolean {
  return row.dueId !== null && row.outstandingAgorot > 0;
}

/**
 * The next member of a collection run: the first row after this one, in the
 * table's own order, that still owes something and belongs to the view on
 * screen.
 *
 * The anchor is looked up in the **unfiltered** list on purpose. After a
 * payment is saved the page re-renders, and the member who was just paid off
 * may no longer match the view — looking the anchor up inside the filtered
 * list would then find nothing and silently send the lead back to the top.
 */
export function nextPayable(
  rows: MemberFeeRow[], view: FeeView, afterPersonId: string,
): string | null {
  const at = rows.findIndex((row) => row.personId === afterPersonId);
  if (at === -1) return null;
  for (let i = at + 1; i < rows.length; i += 1) {
    if (isPayable(rows[i]) && matchesView(rows[i], view)) return rows[i].personId;
  }
  return null;
}

/** `1 מתוך 9`. `index` is 0 when this row is not one of the payable ones. */
export function payablePosition(
  rows: MemberFeeRow[], view: FeeView, personId: string,
): { index: number; total: number } {
  const payable = rows.filter((row) => isPayable(row) && matchesView(row, view));
  const at = payable.findIndex((row) => row.personId === personId);
  return { index: at === -1 ? 0 : at + 1, total: payable.length };
}

/** `listPayments` orders by `paid_on` ascending, so the last one is the latest. */
export function lastPaymentOf(row: MemberFeeRow): PaymentRow | null {
  return row.payments.length === 0 ? null : row.payments[row.payments.length - 1];
}

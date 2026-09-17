import { describe, it, expect } from 'vitest';
import type { MemberFeeRow } from '@/lib/fees/season-fees';
import type { PaymentRow } from '@/lib/fees/payments';
import {
  FEE_VIEWS, parseFeeView, paymentStateOf, matchesView, rowsForView, viewCounts,
  isPayable, nextPayable, payablePosition, lastPaymentOf,
} from './views';

function payment(over: Partial<PaymentRow> = {}): PaymentRow {
  return {
    id: 'pay-1', amountAgorot: 50000, channel: 'מזומן',
    paidOn: new Date('2026-06-21T00:00:00Z'), note: null,
    recordedBy: 'lead@shliff.camp', accountId: null, ...over,
  };
}

function row(over: Partial<MemberFeeRow> = {}): MemberFeeRow {
  return {
    personId: 'p1', displayName: 'איתי כהן', role: 'member',
    dueId: 'd1', amountAgorot: 120000, kind: 'flat',
    exceptionReason: null, decidedBy: null,
    paidAgorot: 0, outstandingAgorot: 120000, settled: false, payments: [], ...over,
  };
}

const NO_DUE = row({
  personId: 'p-nodue', displayName: 'ליאור קפלן', dueId: null, amountAgorot: null,
  kind: null, outstandingAgorot: 0,
});
const UNPAID = row({ personId: 'p-unpaid', displayName: 'איתי כהן' });
const PARTIAL = row({
  personId: 'p-partial', displayName: 'עומר ביטון',
  paidAgorot: 50000, outstandingAgorot: 70000, payments: [payment()],
});
const PAID = row({
  personId: 'p-paid', displayName: 'נועה לוי',
  paidAgorot: 120000, outstandingAgorot: 0, settled: true,
  payments: [payment({ amountAgorot: 120000 })],
});
const OFFSET = row({
  personId: 'p-offset', displayName: 'רוני אדלר',
  paidAgorot: 120000, outstandingAgorot: 0, settled: true,
  payments: [payment({ amountAgorot: 120000, channel: 'קיזוז', note: 'חוב יוסף' })],
});
const WAIVED = row({
  personId: 'p-waived', displayName: 'שירה אברהם', kind: 'exception',
  amountAgorot: 0, outstandingAgorot: 0, settled: true,
  exceptionReason: 'הובילה את ההקמה', decidedBy: 'noa@shliff.camp',
});

const ALL = [UNPAID, PARTIAL, PAID, OFFSET, WAIVED, NO_DUE];

describe('parseFeeView', () => {
  it('reads a known view', () => { expect(parseFeeView('partial')).toBe('partial'); });
  it('falls back to all for an unknown one', () => { expect(parseFeeView('טרם')).toBe('all'); });
  it('falls back to all when absent', () => { expect(parseFeeView(undefined)).toBe('all'); });
});

describe('paymentStateOf', () => {
  it('calls a member with no due nodue', () => {
    expect(paymentStateOf(NO_DUE)).toBe('nodue');
  });
  it('calls a zero-amount exception nothing-to-collect', () => {
    expect(paymentStateOf(WAIVED)).toBe('nothing-to-collect');
  });
  it('calls a due with nothing paid unpaid', () => {
    expect(paymentStateOf(UNPAID)).toBe('unpaid');
  });
  it('calls a due with something paid and something left partial', () => {
    expect(paymentStateOf(PARTIAL)).toBe('partial');
  });
  it('calls a settled due paid', () => { expect(paymentStateOf(PAID)).toBe('paid'); });
  it('calls a due settled only by קיזוז paid-by-offset', () => {
    expect(paymentStateOf(OFFSET)).toBe('paid-by-offset');
  });
  it('calls a due settled partly in cash paid, not paid-by-offset', () => {
    const mixed = row({
      paidAgorot: 120000, outstandingAgorot: 0, settled: true,
      payments: [payment({ amountAgorot: 60000, channel: 'קיזוז', note: 'חוב' }),
                 payment({ id: 'pay-2', amountAgorot: 60000 })],
    });
    expect(paymentStateOf(mixed)).toBe('paid');
  });
});

describe('matchesView', () => {
  it('puts a zero-amount exception in שולם, because nothing is outstanding', () => {
    expect(matchesView(WAIVED, 'paid')).toBe(true);
  });
  it('puts an offset-settled due in both שולם and קוזזו', () => {
    expect(matchesView(OFFSET, 'paid')).toBe(true);
    expect(matchesView(OFFSET, 'offset')).toBe(true);
  });
  it('keeps a partial payer out of טרם שילמו', () => {
    expect(matchesView(PARTIAL, 'unpaid')).toBe(false);
    expect(matchesView(PARTIAL, 'partial')).toBe(true);
  });
  it('matches חריגים by kind, whatever has been paid', () => {
    expect(matchesView(WAIVED, 'exception')).toBe(true);
    expect(matchesView(UNPAID, 'exception')).toBe(false);
  });
});

describe('viewCounts', () => {
  it('counts each view over the same rows, overlaps included', () => {
    expect(viewCounts(ALL)).toEqual({
      all: 6, unpaid: 1, partial: 1, paid: 3, exception: 1, offset: 1, nodue: 1,
    });
  });
  it('returns a zero for every view when there are no rows', () => {
    const counts = viewCounts([]);
    for (const view of FEE_VIEWS) expect(counts[view.id]).toBe(0);
  });
});

describe('rowsForView', () => {
  it('keeps the incoming order', () => {
    expect(rowsForView(ALL, 'paid').map((r) => r.personId))
      .toEqual(['p-paid', 'p-offset', 'p-waived']);
  });
});

describe('isPayable', () => {
  it('is true only when there is a due with something left', () => {
    expect(isPayable(UNPAID)).toBe(true);
    expect(isPayable(PARTIAL)).toBe(true);
    expect(isPayable(PAID)).toBe(false);
    expect(isPayable(WAIVED)).toBe(false);
    expect(isPayable(NO_DUE)).toBe(false);
  });
});

describe('nextPayable', () => {
  it('steps to the next member who still owes, in table order', () => {
    expect(nextPayable(ALL, 'all', 'p-unpaid')).toBe('p-partial');
  });
  it('skips anyone the current view excludes', () => {
    const rows = [UNPAID, PARTIAL, row({ personId: 'p-unpaid-2', displayName: 'תמר גולן' })];
    expect(nextPayable(rows, 'unpaid', 'p-unpaid')).toBe('p-unpaid-2');
  });
  it('returns null at the end of the run rather than wrapping', () => {
    expect(nextPayable(ALL, 'all', 'p-partial')).toBeNull();
  });
  it('returns null when the anchor has left the list entirely', () => {
    expect(nextPayable(ALL, 'all', 'p-gone')).toBeNull();
  });
  it('finds the next one even after the anchor has just been paid off', () => {
    const paidOff = row({ personId: 'p-unpaid', paidAgorot: 120000, outstandingAgorot: 0,
                          settled: true, payments: [payment({ amountAgorot: 120000 })] });
    expect(nextPayable([paidOff, PARTIAL, PAID], 'unpaid', 'p-unpaid')).toBeNull();
    expect(nextPayable([paidOff, PARTIAL, PAID], 'all', 'p-unpaid')).toBe('p-partial');
  });
});

describe('payablePosition', () => {
  it('reports one-based place among the payable rows of the view', () => {
    expect(payablePosition(ALL, 'all', 'p-partial')).toEqual({ index: 2, total: 2 });
  });
  it('reports index 0 for a row that is not payable', () => {
    expect(payablePosition(ALL, 'all', 'p-paid')).toEqual({ index: 0, total: 2 });
  });
});

describe('lastPaymentOf', () => {
  it('returns the most recent payment', () => {
    const two = row({ payments: [
      payment({ id: 'a', paidOn: new Date('2026-06-01T00:00:00Z') }),
      payment({ id: 'b', paidOn: new Date('2026-08-30T00:00:00Z') }),
    ] });
    expect(lastPaymentOf(two)?.id).toBe('b');
  });
  it('returns null when nothing has been paid', () => {
    expect(lastPaymentOf(UNPAID)).toBeNull();
  });
});

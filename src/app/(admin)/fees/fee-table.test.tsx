/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import type { MemberFeeRow } from '@/lib/fees/season-fees';
import type { PaymentRow } from '@/lib/fees/payments';

/** `./issue-due-button` is a client module whose graph reaches `@/db`. */
vi.mock('./issue-due-button', () => ({
  IssueDueButton: ({ flatRateAgorot }: { flatRateAgorot: number }) => (
    <button type="button">הנפקת חיוב {flatRateAgorot / 100} ₪</button>
  ),
  IssueMissingDuesButton: () => null,
}));

import { FeeTable } from './fee-table';

const SEASON = '8f2b1c4e-0000-4000-8000-000000000001';

function payment(over: Partial<PaymentRow> = {}): PaymentRow {
  return {
    id: 'pay-1', amountAgorot: 50000, channel: 'פייבוקס',
    paidOn: new Date('2026-06-21T00:00:00Z'), note: null,
    recordedBy: 'noa@shliff.camp', accountId: null, ...over,
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
  payments: [payment({ amountAgorot: 120000, channel: 'מזומן' })],
});
const OFFSET = row({
  personId: 'p-offset', displayName: 'רוני אדלר',
  paidAgorot: 120000, outstandingAgorot: 0, settled: true,
  payments: [payment({ amountAgorot: 120000, channel: 'קיזוז', note: 'חוב יוסף' })],
});
/**
 * I12: the reason is free text a lead typed, and the plan's fixture wrote
 * `הובילה את ההקמה`. It is kept gender-neutral here on purpose, so that the
 * sweep below only ever sees this screen's own copy — a net that a fixture can
 * trip is a net that gets weakened rather than a screen that gets fixed.
 */
const WAIVED = row({
  personId: 'p-waived', displayName: 'שירה אברהם', kind: 'exception',
  amountAgorot: 0, outstandingAgorot: 0, settled: true,
  exceptionReason: 'הובלת ההקמה', decidedBy: 'noa@shliff.camp',
});

const base = {
  seasonId: SEASON,
  seasonName: 'ברן 26',
  view: 'unpaid' as const,
  flatRateAgorot: 120000,
  totals: {
    expectedAgorot: 3650000,
    collectedAgorot: 2430000,
    outstandingAgorot: 1220000,
    memberCount: 35,
    exceptionCount: 2,
    noDueCount: 3,
  },
};

describe('FeeTable', () => {
  it('gives a member who still owes a רישום תשלום link carrying the view', () => {
    render(<FeeTable {...base} rows={[UNPAID]} />);
    expect(screen.getByRole('link', { name: 'רישום תשלום' }).getAttribute('href'))
      .toBe(`/fees?season=${SEASON}&view=unpaid&peek=p-unpaid&act=pay`);
  });

  it('gives a member with no due an issue button, not a payment link', () => {
    render(<FeeTable {...base} rows={[NO_DUE]} />);
    expect(screen.getByRole('button', { name: 'הנפקת חיוב 1200 ₪' })).toBeDefined();
    expect(screen.queryByRole('link', { name: 'רישום תשלום' })).toBeNull();
  });

  it('gives a settled member a way to see the payments, and no verb to record one', () => {
    render(<FeeTable {...base} rows={[PAID]} />);
    expect(screen.getByRole('link', { name: 'תשלומים' })).toBeDefined();
    expect(screen.queryByRole('link', { name: 'רישום תשלום' })).toBeNull();
  });

  it('shows an exception inline with its reason and who decided it', () => {
    render(<FeeTable {...base} rows={[WAIVED]} />);
    const cells = screen.getAllByRole('cell');
    expect(cells[1].textContent).toContain('חריג');
    expect(cells[1].textContent).toContain('הובלת ההקמה');
    expect(cells[1].textContent).toContain('noa@shliff.camp');
  });

  /**
   * I12, with the plan's own net widened. `/שילמה|שילם /` catches none of the
   * forms this redesign actually had to remove; the sweep below is on
   * inflected verbs. Grammatical agreement with a Hebrew noun is deliberately
   * not on it — `טרם שולם` agrees with חיוב, which is a fact about the word
   * and not a guess about a person.
   */
  it('writes each state about the due, never about the person', () => {
    render(<FeeTable {...base} rows={[UNPAID, PARTIAL, PAID, OFFSET, WAIVED]} />);
    expect(screen.getByText('טרם שולם')).toBeDefined();
    expect(screen.getByText(/שולם\s*500 ₪/)).toBeDefined();
    expect(screen.getByText('שולם בקיזוז')).toBeDefined();
    expect(screen.getByText('אין מה לגבות')).toBeDefined();
    expect(document.body.textContent)
      .not.toMatch(/שילמה|שילם |פטורה|פטור |יחזור|תחזור|הוביל |הובילה|החליט |החליטה|זכאית|זכאי /);
  });

  it('shows the last payment as a date and a channel', () => {
    render(<FeeTable {...base} rows={[PARTIAL]} />);
    expect(screen.getByText(/21\/06\/26/)).toBeDefined();
    expect(screen.getByText(/פייבוקס/)).toBeDefined();
  });

  /**
   * The kit's `Table` renders a plain `<tfoot>`, with no accessible name to
   * query by — the plan assumed `<tfoot aria-label="סיכום">`. The kit is not
   * this plan's to change, so the totals rowgroup is taken as the last one.
   */
  it('carries a totals row', () => {
    render(<FeeTable {...base} rows={[UNPAID, PARTIAL, WAIVED, NO_DUE]} />);
    const groups = screen.getAllByRole('rowgroup');
    const footer = groups[groups.length - 1];
    expect(within(footer).getByText(/35 חברים/)).toBeDefined();
    expect(within(footer).getByText(/36,500 ₪/)).toBeDefined();
    expect(within(footer).getByText(/24,300 ₪ נגבו/)).toBeDefined();
    expect(within(footer).getByText(/12,200 ₪/)).toBeDefined();
  });

  it('links every name to the person page', () => {
    render(<FeeTable {...base} rows={[UNPAID]} />);
    expect(screen.getByRole('link', { name: 'איתי כהן' }).getAttribute('href'))
      .toBe('/members/p-unpaid');
  });

  it('offers עריכת החריג on a member who has one and הגדרת חריג on one who does not', () => {
    render(<FeeTable {...base} rows={[UNPAID, WAIVED]} />);
    expect(screen.getByRole('link', { name: 'הגדרת חריג' })).toBeDefined();
    expect(screen.getByRole('link', { name: 'עריכת החריג' })).toBeDefined();
  });

  it('says what a member with no due is missing, naming the season', () => {
    render(<FeeTable {...base} rows={[NO_DUE]} />);
    expect(screen.getByText('עדיין אין חיוב לברן 26')).toBeDefined();
  });

  /**
   * An empty state is an invitation, not an apology — and the plan's
   * "header + totals only" would have been an apology by omission. The two
   * cases are told apart: nobody matched this filter, versus nobody is on the
   * roster at all.
   */
  it('invites a lead out of an empty view rather than showing a blank table', () => {
    render(<FeeTable {...base} rows={[]} />);
    expect(screen.getByText('אין תוצאות לסינון הזה')).toBeDefined();
    expect(screen.getByRole('link', { name: 'הצגת הכול' }).getAttribute('href'))
      .toBe(`/fees?season=${SEASON}`);
    expect(screen.queryByRole('link', { name: 'רישום תשלום' })).toBeNull();
  });

  it('says the roster is empty rather than blaming the filter when it is', () => {
    render(
      <FeeTable {...base} rows={[]} totals={{ ...base.totals, memberCount: 0 }} />,
    );
    expect(screen.getByText('אין כאן כלום לשנה הזו')).toBeDefined();
  });
});

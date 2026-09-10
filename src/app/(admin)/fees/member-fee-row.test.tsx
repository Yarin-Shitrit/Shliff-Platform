/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { ActionResult } from '@/lib/action-result';
import type { MemberFeeRow as MemberFeeRowData } from '@/lib/fees/season-fees';
/**
 * `@testing-library/user-event` is not an installed dependency in this repo
 * and adding it is out of scope here — installing packages is off-limits for
 * this task. `fireEvent.change` sets a field's value in one event rather than
 * typing it character by character, and `fireEvent.click` exercises the same
 * click path these tests need.
 */

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {} }) }));

/**
 * `vi.mock` factories are hoisted above every other statement, so a plain
 * top-level `const` referenced inside one throws "Cannot access before
 * initialization" — `vi.hoisted` is what this codebase already uses to give
 * the factory something to close over (see `exception-form.test.tsx` and
 * `src/app/(admin)/members/unlinked-queue.test.tsx`).
 */
const {
  issueDuesAction, issueDueForAction, setExceptionAction, clearExceptionAction,
  recordPaymentAction, deletePaymentAction,
} = vi.hoisted(() => ({
  issueDuesAction: vi.fn(async (): Promise<ActionResult> => ({ ok: true })),
  issueDueForAction: vi.fn(async (): Promise<ActionResult> => ({ ok: true })),
  setExceptionAction: vi.fn(async (): Promise<ActionResult> => ({ ok: true })),
  clearExceptionAction: vi.fn(async (): Promise<ActionResult> => ({ ok: true })),
  recordPaymentAction: vi.fn(async (): Promise<ActionResult> => ({ ok: true })),
  deletePaymentAction: vi.fn(async (): Promise<ActionResult> => ({ ok: true })),
}));
/** `./actions` is a `'use server'` module whose graph reaches `@/db`. */
vi.mock('./actions', () => ({
  issueDuesAction, issueDueForAction, setExceptionAction, clearExceptionAction,
  recordPaymentAction, deletePaymentAction,
}));

import { MemberFeeRow } from './member-fee-row';

const NO_DUE: MemberFeeRowData = {
  personId: 'p1',
  displayName: 'עמירם דהן',
  role: 'member',
  dueId: null,
  amountAgorot: null,
  kind: null,
  exceptionReason: null,
  decidedBy: null,
  paidAgorot: 0,
  outstandingAgorot: 0,
  settled: false,
  payments: [],
};

const WITH_DUE: MemberFeeRowData = {
  personId: 'p2',
  displayName: 'אופק',
  role: 'member',
  dueId: 'd2',
  amountAgorot: 120000,
  kind: 'flat',
  exceptionReason: null,
  decidedBy: null,
  paidAgorot: 0,
  outstandingAgorot: 120000,
  settled: false,
  payments: [
    {
      id: 'pay1',
      amountAgorot: 50000,
      channel: 'מזומן',
      paidOn: new Date('2026-07-01T00:00:00Z'),
      note: 'מקדמה',
      recordedBy: 'lead@shliff.camp',
    },
  ],
};

function renderRow(row: MemberFeeRowData) {
  return render(
    <table>
      <tbody>
        <MemberFeeRow row={row} seasonId="s1" />
      </tbody>
    </table>,
  );
}

describe('MemberFeeRow', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('shows an issue control and no payment form for a member with no due', () => {
    renderRow(NO_DUE);
    expect(screen.getByRole('button', { name: 'הנפק חיוב לפי התעריף הרגיל' })).toBeDefined();
    expect(screen.queryByRole('button', { name: 'רשום תשלום' })).toBeNull();
    expect(screen.queryByLabelText('סכום התשלום')).toBeNull();
  });

  /**
   * The control sits on ONE member's row and says "issue a due at the flat
   * rate". Wired to the season-wide action it filled in every member missing
   * one — a larger action than the label promises, and not one a lead would
   * notice until after it happened.
   */
  it('issues the due for that member alone, not the whole season', () => {
    renderRow(NO_DUE);
    fireEvent.click(screen.getByRole('button', { name: 'הנפק חיוב לפי התעריף הרגיל' }));
    expect(issueDueForAction).toHaveBeenCalledWith('p1', 's1');
    expect(issueDuesAction).not.toHaveBeenCalled();
  });

  it('will not save a changed amount with a blank reason', () => {
    renderRow(WITH_DUE);
    fireEvent.change(screen.getByLabelText('סכום'), { target: { value: '1000' } });
    fireEvent.click(screen.getByRole('button', { name: 'שמור חריג' }));

    expect(setExceptionAction).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toContain('סיבה');
  });

  it('saves a changed amount that carries a reason', () => {
    renderRow(WITH_DUE);
    fireEvent.change(screen.getByLabelText('סכום'), { target: { value: '1000' } });
    fireEvent.change(screen.getByLabelText('סיבה'), { target: { value: 'הנחה מיוחדת' } });
    fireEvent.click(screen.getByRole('button', { name: 'שמור חריג' }));

    expect(setExceptionAction).toHaveBeenCalledWith({
      personId: 'p2', seasonId: 's1', amount: 1000, reason: 'הנחה מיוחדת',
    });
  });

  it('will not record a קיזוז payment with no note', () => {
    renderRow(WITH_DUE);
    fireEvent.change(screen.getByLabelText('סכום התשלום'), { target: { value: '500' } });
    fireEvent.change(screen.getByLabelText('אמצעי תשלום'), { target: { value: 'קיזוז' } });
    fireEvent.click(screen.getByRole('button', { name: 'רשום תשלום' }));

    expect(recordPaymentAction).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toContain('קיזוז');
  });

  it('records a מזומן payment with no note — the note is only mandatory for offsets', () => {
    renderRow(WITH_DUE);
    fireEvent.change(screen.getByLabelText('סכום התשלום'), { target: { value: '500' } });
    fireEvent.change(screen.getByLabelText('אמצעי תשלום'), { target: { value: 'מזומן' } });
    fireEvent.click(screen.getByRole('button', { name: 'רשום תשלום' }));

    expect(recordPaymentAction).toHaveBeenCalledWith(expect.objectContaining({
      dueId: 'd2', amount: 500, channel: 'מזומן', note: undefined,
    }));
  });

  it('removes a payment by its own id', () => {
    renderRow(WITH_DUE);
    fireEvent.click(screen.getByRole('button', { name: 'הסר' }));
    expect(deletePaymentAction).toHaveBeenCalledWith('pay1');
  });

  it('surfaces a server refusal when removing a payment fails', async () => {
    deletePaymentAction.mockResolvedValueOnce({ ok: false, error: 'אין הרשאה' });
    renderRow(WITH_DUE);
    fireEvent.click(screen.getByRole('button', { name: 'הסר' }));
    expect(await screen.findByText('אין הרשאה')).toBeDefined();
  });
});

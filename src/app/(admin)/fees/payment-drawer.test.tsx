/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within, act } from '@testing-library/react';
import { ToastProvider } from '@/components/ui/toaster';
import type { ActionResult } from '@/lib/action-result';
import type { MemberFeeRow } from '@/lib/fees/season-fees';
import type { PaymentRow } from '@/lib/fees/payments';
/**
 * `@testing-library/user-event` is not installed and R1 forbids adding it.
 * `fireEvent.change` sets a field's value in one event and `fireEvent.click`
 * exercises the same click path, which is what every component test in this
 * repo already does.
 */

const { replace, refresh } = vi.hoisted(() => ({
  replace: vi.fn(), refresh: vi.fn(),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace, refresh }) }));

/** `vi.mock` factories are hoisted above every other statement. */
const { recordPaymentAction, deletePaymentAction } = vi.hoisted(() => ({
  /* `ActionResult<string>`: E2 needs the new payment id back so the toast can
     offer `deletePaymentAction(id)` as the undo. */
  recordPaymentAction: vi.fn(async (): Promise<ActionResult<string>> => ({ ok: true })),
  deletePaymentAction: vi.fn(async (): Promise<ActionResult> => ({ ok: true })),
}));
/** `./actions` is a `'use server'` module whose graph reaches `@/db`. */
vi.mock('./actions', () => ({ recordPaymentAction, deletePaymentAction }));

import { PaymentDrawer, type AccountOption } from './payment-drawer';

const SEASON = '8f2b1c4e-0000-4000-8000-000000000001';

const ACCOUNTS: AccountOption[] = [
  { id: 'acc-cash', name: 'קופת מזומן', kind: 'cash' },
  { id: 'acc-ofek', name: 'עו״ש אופק', kind: 'personal' },
];

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

/**
 * Wrapped in `ToastProvider` because the drawer reports its writes through it
 * (E2), and `useToast` throws without one on purpose — the kit refuses to
 * silently swallow a message nobody would ever see. `layout.tsx` mounts the
 * real provider above every screen.
 */
function renderDrawer(over: Partial<Parameters<typeof PaymentDrawer>[0]> = {}) {
  return render(
    <ToastProvider>
      <PaymentDrawer
        row={row()}
        seasonId={SEASON}
        view="unpaid"
        accounts={ACCOUNTS}
        recordedBy="noa@shliff.camp"
        nextPersonId="p2"
        prevPersonId={null}
        position={{ index: 1, total: 9 }}
        {...over}
      />
    </ToastProvider>,
  );
}

/**
 * The drawer only. The toaster mounts its own always-present `role="status"`
 * and `role="alert"` regions as siblings of the dialog (E2 requires they
 * exist from first paint), so an unscoped query for either now matches the
 * live region as well as the sentence beside the form. Scoping is the fix;
 * weakening the query to the first match would make these tests pass against
 * a drawer that had stopped saying anything at all.
 */
function inDrawer() {
  return within(screen.getByRole('dialog'));
}

describe('PaymentDrawer', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('opens on the outstanding amount, so the common case is one click', () => {
    renderDrawer();
    expect((screen.getByLabelText('סכום') as HTMLInputElement).value).toBe('1200');
  });

  /**
   * The kit's `Segmented` is a radio group, not a row of buttons — it has to
   * submit inside a Server Action form with no JavaScript. The plan's sample
   * queried `role="button"`; the query is what changes, not the component.
   */
  it('offers all six channels', () => {
    renderDrawer();
    for (const channel of ['מזומן', 'אשראי', 'ביט', 'פייבוקס', 'העברה', 'קיזוז']) {
      expect(screen.getByRole('radio', { name: channel })).toBeDefined();
    }
  });

  it('offers every open account, and pre-selects none of them', () => {
    renderDrawer();
    const picker = screen.getByLabelText('לאיזו קופה הכסף נכנס') as HTMLSelectElement;
    expect(picker.value).toBe('');
    expect([...picker.options].map((option) => option.textContent))
      .toEqual(['בלי קופה', 'קופת מזומן', 'עו״ש אופק']);
  });

  it('says what leaving the קופה empty costs', () => {
    renderDrawer();
    expect(screen.getByText('בלי קופה הסכום ייספר בגבייה אבל לא ביתרה של אף חשבון.'))
      .toBeDefined();
  });

  it('sends the chosen account with the payment', () => {
    renderDrawer();
    fireEvent.change(screen.getByLabelText('לאיזו קופה הכסף נכנס'),
      { target: { value: 'acc-cash' } });
    fireEvent.change(screen.getByLabelText('תאריך התשלום'),
      { target: { value: '2026-09-17' } });
    fireEvent.click(screen.getByRole('button', { name: 'רישום התשלום' }));

    expect(recordPaymentAction).toHaveBeenCalledWith({
      dueId: 'd1', amount: 1200, channel: 'מזומן', paidOn: '2026-09-17',
      note: undefined, accountId: 'acc-cash',
    });
  });

  it('warns that a personal account is not the camp’s קופה', () => {
    renderDrawer();
    fireEvent.change(screen.getByLabelText('לאיזו קופה הכסף נכנס'),
      { target: { value: 'acc-ofek' } });
    expect(screen.getByText('זה חשבון פרטי של חבר קאמפ, לא קופה של הקאמפ.')).toBeDefined();
  });

  it('sends no account at all when none was chosen', () => {
    renderDrawer();
    fireEvent.change(screen.getByLabelText('תאריך התשלום'),
      { target: { value: '2026-09-17' } });
    fireEvent.click(screen.getByRole('button', { name: 'רישום התשלום' }));
    expect(recordPaymentAction).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: undefined }),
    );
  });

  it('says on screen that money with no קופה entered no balance', async () => {
    renderDrawer();
    fireEvent.click(screen.getByRole('button', { name: 'רישום התשלום' }));
    expect((await inDrawer().findByRole('status')).textContent)
      .toContain('הסכום נספר בגבייה אבל לא נכנס ליתרה של אף קופה.');
  });

  it('takes the account away when the channel is קיזוז', () => {
    renderDrawer();
    fireEvent.click(screen.getByRole('radio', { name: 'קיזוז' }));
    const picker = screen.getByLabelText('לאיזו קופה הכסף נכנס') as HTMLSelectElement;
    expect(picker.disabled).toBe(true);
    expect(picker.value).toBe('');
    expect(screen.getByText('קיזוז אינו מזיז מזומן, ולכן אינו נכנס לקופה.')).toBeDefined();
  });

  it('clears an already-chosen account when קיזוז is picked afterwards', () => {
    renderDrawer();
    fireEvent.change(screen.getByLabelText('לאיזו קופה הכסף נכנס'),
      { target: { value: 'acc-cash' } });
    fireEvent.click(screen.getByRole('radio', { name: 'קיזוז' }));
    fireEvent.change(screen.getByLabelText('הערה'), { target: { value: 'חוב יוסף' } });
    fireEvent.click(screen.getByRole('button', { name: 'רישום התשלום' }));

    expect(recordPaymentAction).toHaveBeenCalledWith(
      expect.objectContaining({ channel: 'קיזוז', accountId: undefined }),
    );
  });

  it('refuses a קיזוז with no note, in the words this screen already used', () => {
    renderDrawer();
    fireEvent.click(screen.getByRole('radio', { name: 'קיזוז' }));
    fireEvent.click(screen.getByRole('button', { name: 'רישום התשלום' }));

    expect(recordPaymentAction).not.toHaveBeenCalled();
    expect(inDrawer().getByRole('alert').textContent).toBe(
      'קיזוז חייב לכלול הערה שמסבירה מול מה הוא קוזז — אחרת אי אפשר לדעת בעתיד.',
    );
  });

  it('refuses a non-positive amount before it reaches the server', () => {
    renderDrawer();
    fireEvent.change(screen.getByLabelText('סכום'), { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: 'רישום התשלום' }));

    expect(recordPaymentAction).not.toHaveBeenCalled();
    expect(inDrawer().getByRole('alert').textContent).toBe('סכום התשלום חייב להיות מספר חיובי.');
  });

  it('shows a server refusal rather than pretending it saved', async () => {
    recordPaymentAction.mockResolvedValueOnce({ ok: false, error: 'החיוב הזה לא נמצא.' });
    renderDrawer();
    fireEvent.click(screen.getByRole('button', { name: 'רישום התשלום' }));
    expect((await inDrawer().findByRole('alert')).textContent).toBe('החיוב הזה לא נמצא.');
  });

  it('steps to the next member of the run, carrying the season and the view', async () => {
    renderDrawer();
    fireEvent.click(screen.getByRole('button', { name: 'שמירה ומעבר לבא' }));
    await inDrawer().findByRole('status');
    expect(replace).toHaveBeenCalledWith(
      `/fees?season=${SEASON}&view=unpaid&peek=p2&act=pay`,
    );
  });

  it('says the run is over rather than closing on the last member', async () => {
    renderDrawer({ nextPersonId: null });
    fireEvent.click(screen.getByRole('button', { name: 'שמירה ומעבר לבא' }));
    expect((await inDrawer().findByRole('status')).textContent).toContain('זה היה האחרון ברשימה.');
    expect(replace).not.toHaveBeenCalled();
  });

  it('does not step anywhere when the save was refused', async () => {
    recordPaymentAction.mockResolvedValueOnce({ ok: false, error: 'החיוב הזה לא נמצא.' });
    renderDrawer();
    fireEvent.click(screen.getByRole('button', { name: 'שמירה ומעבר לבא' }));
    await inDrawer().findByRole('alert');
    expect(replace).not.toHaveBeenCalled();
  });

  it('shows where a member stands in the run', () => {
    renderDrawer();
    expect(screen.getByText('1 מתוך 9')).toBeDefined();
  });

  /**
   * Scoped to the list: `פייבוקס` is also one of the six channel radios, so an
   * unscoped `getByText` matches two nodes and fails on ambiguity.
   */
  it('lists the payments already recorded', () => {
    renderDrawer({ row: row({
      paidAgorot: 50000, outstandingAgorot: 70000, payments: [payment()],
    }) });
    const previous = screen.getByRole('list');
    expect(within(previous).getByText('פייבוקס')).toBeDefined();
    expect(within(previous).getByText('21/06/26')).toBeDefined();
  });

  it('points at the exception action rather than letting the amount be edited here', () => {
    renderDrawer();
    expect(screen.getByRole('link', { name: 'הגדרת חריג' }).getAttribute('href'))
      .toBe(`/fees?season=${SEASON}&view=unpaid&peek=p1&act=exception`);
  });

  it('refuses to take a payment for a member who has no due yet', () => {
    renderDrawer({ row: row({
      dueId: null, amountAgorot: null, kind: null, outstandingAgorot: 0,
    }) });
    expect(screen.getByText('אין עדיין חיוב לאיתי כהן. צריך להנפיק חיוב לפני שאפשר לרשום תשלום.'))
      .toBeDefined();
    expect(screen.queryByLabelText('סכום')).toBeNull();
  });

  it('names the lead the payment will be recorded under', () => {
    renderDrawer();
    expect(screen.getByText('יירשם על שמך · noa@shliff.camp')).toBeDefined();
  });
});

/**
 * The kit's `ConfirmDialog` is `role="alertdialog"`, and the `Drawer` it opens
 * over is `role="dialog"`. Querying `getByRole('dialog')` here would match the
 * drawer — whose own text already carries the amount, the channel, the date,
 * the name and every account option — and every assertion below would pass
 * without the confirmation existing at all. The role is the discriminator.
 */
describe('deleting a payment', () => {
  const PAID = row({
    paidAgorot: 50000, outstandingAgorot: 70000,
    payments: [payment({ amountAgorot: 50000, channel: 'פייבוקס', accountId: 'acc-cash' })],
  });

  beforeEach(() => { vi.clearAllMocks(); });

  it('does not delete on the first click (R8)', () => {
    renderDrawer({ row: PAID });
    fireEvent.click(screen.getByRole('button', { name: /הסרה/ }));
    expect(deletePaymentAction).not.toHaveBeenCalled();
  });

  it('names the payment and what removing it will do', () => {
    renderDrawer({ row: PAID });
    fireEvent.click(screen.getByRole('button', { name: /הסרה/ }));

    const dialog = screen.getByRole('alertdialog');
    expect(dialog.textContent).toContain('500 ₪');
    expect(dialog.textContent).toContain('פייבוקס');
    expect(dialog.textContent).toContain('21/06/26');
    expect(dialog.textContent).toContain('איתי כהן');
    expect(dialog.textContent).toContain('קופת מזומן');
  });

  it('puts the destructive verb on the confirm button', () => {
    renderDrawer({ row: PAID });
    fireEvent.click(screen.getByRole('button', { name: /הסרה/ }));
    expect(screen.getByRole('button', { name: 'מחיקת התשלום' })).toBeDefined();
  });

  it('deletes once the lead confirms', () => {
    renderDrawer({ row: PAID });
    fireEvent.click(screen.getByRole('button', { name: /הסרה/ }));
    fireEvent.click(screen.getByRole('button', { name: 'מחיקת התשלום' }));
    expect(deletePaymentAction).toHaveBeenCalledWith('pay-1');
  });

  it('deletes nothing when the lead backs out', () => {
    renderDrawer({ row: PAID });
    fireEvent.click(screen.getByRole('button', { name: /הסרה/ }));
    fireEvent.click(screen.getByRole('button', { name: 'ביטול' }));
    expect(deletePaymentAction).not.toHaveBeenCalled();
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('shows a refusal rather than pretending the payment is gone', async () => {
    deletePaymentAction.mockResolvedValueOnce({ ok: false, error: 'אין הרשאה' });
    renderDrawer({ row: PAID });
    fireEvent.click(screen.getByRole('button', { name: /הסרה/ }));
    fireEvent.click(screen.getByRole('button', { name: 'מחיקת התשלום' }));
    expect((await inDrawer().findByRole('alert')).textContent).toBe('אין הרשאה');
  });

  it('says only the collection when the payment named no קופה', () => {
    renderDrawer({ row: row({
      paidAgorot: 50000, outstandingAgorot: 70000, payments: [payment()],
    }) });
    fireEvent.click(screen.getByRole('button', { name: /הסרה/ }));
    expect(screen.getByRole('alertdialog').textContent).not.toContain('ומהיתרה של');
  });
});

/**
 * D11's fourth standing-up job: recording a payment at the gate, one-handed.
 * The drawer is a side panel on a laptop and a whole screen on a phone, and
 * the amount a lead reaches for is almost always one of two numbers.
 */
describe('PaymentDrawer on a phone', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('opens full-screen, because a form a lead fills standing up is not a side panel', () => {
    const { container } = renderDrawer();
    expect(container.querySelector('[role="dialog"]')?.getAttribute('data-phone')).toBe('full');
  });

  it('opens full-screen even with no due to pay, so the two states are one layout', () => {
    const { container } = renderDrawer({ row: row({ dueId: null }) });
    expect(container.querySelector('[role="dialog"]')?.getAttribute('data-phone')).toBe('full');
  });

  it('offers the whole outstanding amount as one tap', () => {
    renderDrawer();
    const field = screen.getByLabelText('סכום') as HTMLInputElement;
    fireEvent.change(field, { target: { value: '5' } });
    expect(field.value).toBe('5');
    fireEvent.click(screen.getByRole('button', { name: 'מלא 1,200 ₪' }));
    expect(field.value).toBe('1200');
  });

  it('offers half, because a lead collecting in a run takes what is offered', () => {
    renderDrawer();
    fireEvent.click(screen.getByRole('button', { name: 'חצי 600 ₪' }));
    expect((screen.getByLabelText('סכום') as HTMLInputElement).value).toBe('600');
  });

  /**
   * An odd outstanding amount halves to an agora, and a lead cannot hand over
   * an agora. The chip is a shortcut, so it offers a number that can actually
   * be paid and says which one it is rather than rounding silently.
   */
  it('rounds half to a whole shekel rather than offering agorot nobody can pay', () => {
    renderDrawer({ row: row({ outstandingAgorot: 120050 }) });
    fireEvent.click(screen.getByRole('button', { name: 'חצי 600 ₪' }));
    expect((screen.getByLabelText('סכום') as HTMLInputElement).value).toBe('600');
  });

  it('clears the field for a sum that is neither, and leaves the lead in it', () => {
    renderDrawer();
    fireEvent.click(screen.getByRole('button', { name: 'סכום אחר' }));
    const field = screen.getByLabelText('סכום') as HTMLInputElement;
    expect(field.value).toBe('');
    expect(document.activeElement).toBe(field);
  });

  /**
   * A row with nothing outstanding has no half and no whole to offer, and a
   * chip reading `מלא 0 ₪` would be a control that does nothing. B2's rule
   * about a count that reads zero applies to an affordance too.
   */
  it('offers no shortcut when there is nothing left to pay', () => {
    renderDrawer({ row: row({ outstandingAgorot: 0, paidAgorot: 120000, settled: true }) });
    expect(screen.queryByRole('button', { name: /^מלא/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^חצי/ })).toBeNull();
  });

  it('says what a payment with no account will and will not do', () => {
    renderDrawer();
    expect(
      screen.getByText('בלי קופה הסכום ייספר בגבייה אבל לא ביתרה של אף חשבון.'),
    ).toBeTruthy();
  });
});

/**
 * E2. Every write says what it did, and takes it back where the domain can.
 *
 * `recordPayment` already returns the new row's id, so the inverse is exact:
 * `deletePaymentAction(id)` restores the state before the write. That is the
 * whole test for whether an undo may be offered — a UI-level stack that
 * re-created the payment would mint a new id and a new source_row, which is a
 * lie about provenance under R11.
 */
describe('PaymentDrawer — reporting the write, and taking it back', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('says what it recorded, in Hebrew and in the past tense', async () => {
    recordPaymentAction.mockResolvedValue({ ok: true, value: 'pay-9' });
    renderDrawer();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'רישום התשלום' }));
    });
    const region = document.querySelector('[role="status"][aria-live="polite"]');
    expect(region?.textContent).toContain('נרשם תשלום של 1,200 ₪ לאיתי כהן');
  });

  it('offers to take a payment back, by deleting the row it just wrote', async () => {
    recordPaymentAction.mockResolvedValue({ ok: true, value: 'pay-9' });
    renderDrawer();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'רישום התשלום' }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'ביטול הרישום' }));
    });
    expect(deletePaymentAction).toHaveBeenCalledWith('pay-9');
  });

  /**
   * An action that reports success without naming the row it wrote leaves
   * nothing to undo, and an undo button that cannot name its target would
   * either do nothing or delete the wrong row. The toast is still raised —
   * the write happened and the lead must be told — but it carries no undo.
   */
  it('reports the write but offers no undo when the id did not come back', async () => {
    recordPaymentAction.mockResolvedValue({ ok: true });
    renderDrawer();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'רישום התשלום' }));
    });
    const region = document.querySelector('[role="status"][aria-live="polite"]');
    expect(region?.textContent).toContain('נרשם תשלום');
    expect(screen.queryByRole('button', { name: 'ביטול הרישום' })).toBeNull();
  });

  it('raises no toast at all when the write was refused', async () => {
    recordPaymentAction.mockResolvedValue({ ok: false, error: 'הקופה שנבחרה לא קיימת או נסגרה.' });
    renderDrawer();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'רישום התשלום' }));
    });
    const region = document.querySelector('[role="status"][aria-live="polite"]');
    expect(region?.textContent).toBe('');
    // The refusal still reaches the lead, beside the form where it belongs.
    expect(screen.getByText('הקופה שנבחרה לא קיימת או נסגרה.')).toBeTruthy();
  });
});

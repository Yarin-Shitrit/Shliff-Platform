/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { ActionResult } from '@/lib/action-result';

const { recordMovementAction, updateMovementAction, refresh, replace } = vi.hoisted(() => ({
  recordMovementAction: vi.fn<(input: unknown) => Promise<ActionResult>>(),
  updateMovementAction: vi.fn<(id: string, input: unknown) => Promise<ActionResult>>(),
  refresh: vi.fn(),
  replace: vi.fn(),
}));
/** `./actions` is a `'use server'` module whose graph reaches `@/db`. */
vi.mock('./actions', () => ({ recordMovementAction, updateMovementAction }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh, replace }) }));

import { NewMovementForm } from './new-movement-form';

/** U+200F: invisible, and truthy to `.trim()`. */
const RLM = '‏';

const SEASONS = [{ id: 's1', name: 'ברן 26' }, { id: 's0', name: 'ברן 25' }];
const ACCOUNTS = [{ id: 'a1', name: 'קופה מזומן' }, { id: 'a2', name: 'קופת מסיבות' }];
const LINES = [{ id: 'b1', label: 'תשתיות' }];

function renderForm(over: Record<string, unknown> = {}) {
  render(
    <NewMovementForm
      seasonId="s1"
      seasons={SEASONS}
      accounts={ACCOUNTS}
      budgetLines={LINES}
      closeHref="/money/ledger?season=s1"
      {...over}
    />,
  );
}

function fill(name: string, value: string) {
  fireEvent.change(screen.getByRole('textbox', { name }), { target: { value } });
}

beforeEach(() => {
  vi.clearAllMocks();
  recordMovementAction.mockResolvedValue({ ok: true });
  updateMovementAction.mockResolvedValue({ ok: true });
});

describe('the new movement form', () => {
  /**
   * A11, turned into a property of the form rather than of the table: the
   * direction is a choice between two words, so no field anywhere can carry
   * a sign and no amount can be negative.
   */
  it('makes direction a choice of two words, with no sign anywhere in the form', () => {
    const { container } = render(
      <NewMovementForm
        seasonId="s1" seasons={SEASONS} accounts={ACCOUNTS} budgetLines={LINES}
        closeHref="/money/ledger?season=s1"
      />,
    );
    expect(screen.getByRole('radio', { name: 'נכנס' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'יצא' })).toBeTruthy();
    expect(container.textContent).not.toContain('-');
    expect(container.textContent).not.toContain('−');
  });

  it('will not accept a negative amount', () => {
    renderForm();
    const amount = screen.getByRole('spinbutton', { name: 'סכום בשקלים' });
    expect(amount.getAttribute('min')).toBe('0');
  });

  it('does not submit a description that is only an invisible mark', async () => {
    renderForm();
    // A valid amount first, or the amount guard fires and this proves
    // nothing about the description.
    fireEvent.change(screen.getByRole('spinbutton', { name: 'סכום בשקלים' }), {
      target: { value: '3875' },
    });
    fill('תיאור', RLM);
    fireEvent.click(screen.getByRole('button', { name: 'רישום התנועה' }));
    expect(recordMovementAction).not.toHaveBeenCalled();
    expect((await screen.findByRole('alert')).textContent).toBe('לתנועה חייב להיות תיאור');
  });

  it('does not submit an amount of zero', async () => {
    renderForm();
    fill('תיאור', 'השכרת משאית');
    fireEvent.change(screen.getByRole('spinbutton', { name: 'סכום בשקלים' }), {
      target: { value: '0' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'רישום התנועה' }));
    expect(recordMovementAction).not.toHaveBeenCalled();
    expect((await screen.findByRole('alert')).textContent)
      .toBe('סכום תנועה חייב להיות חיובי — הכיוון נושא את הסימן');
  });

  it('offers לא צוין for the account, and says what that costs', () => {
    renderForm();
    expect(screen.getByRole('option', { name: 'לא צוין' })).toBeTruthy();
    expect(screen.getByText('תנועה בלי חשבון לא נספרת ביתרה של אף קופה, ותופיע בהתראה למעלה'))
      .toBeTruthy();
  });

  it('defaults the season to the page\'s, offers ללא שנה, and says the season is set by hand', () => {
    renderForm();
    const season = screen.getByRole('combobox', { name: 'שנה' }) as HTMLSelectElement;
    expect(season.value).toBe('s1');
    expect(screen.getByRole('option', { name: 'ללא שנה' })).toBeTruthy();
    expect(screen.getByText('השנה נקבעת ביד, לא לפי התאריך')).toBeTruthy();
  });

  it('sends what the lead chose, and no account when none was chosen', async () => {
    renderForm();
    fill('תיאור', 'השכרת משאית');
    fireEvent.change(screen.getByRole('spinbutton', { name: 'סכום בשקלים' }), {
      target: { value: '3875' },
    });
    fireEvent.click(screen.getByRole('radio', { name: 'יצא' }));
    fireEvent.click(screen.getByRole('button', { name: 'רישום התנועה' }));
    await vi.waitFor(() => { expect(recordMovementAction).toHaveBeenCalled(); });
    const [sent] = recordMovementAction.mock.calls[0] as [Record<string, unknown>];
    expect(sent.direction).toBe('out');
    expect(sent.amount).toBe(3875);
    expect(sent.description).toBe('השכרת משאית');
    expect(sent.seasonId).toBe('s1');
    expect(sent.accountId).toBeUndefined();
  });

  it('shows the action refusal in place', async () => {
    recordMovementAction.mockResolvedValue({ ok: false, error: 'משהו השתבש. הפעולה לא נשמרה.' });
    renderForm();
    fill('תיאור', 'השכרת משאית');
    fireEvent.change(screen.getByRole('spinbutton', { name: 'סכום בשקלים' }), {
      target: { value: '10' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'רישום התנועה' }));
    expect((await screen.findByRole('alert')).textContent).toBe('משהו השתבש. הפעולה לא נשמרה.');
    expect(refresh).not.toHaveBeenCalled();
  });
});

/**
 * 00:30 in Israel on the 14th is 22:30 UTC on the 13th. The form used to open
 * on the UTC day, so a movement typed after midnight was dated yesterday —
 * inside a count made yesterday, where it does not move the balance.
 */
describe('the date the form opens on', () => {
  it('is the day it is in the camp, not the UTC day', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-13T22:30:00Z'));
    try {
      renderForm();
      expect((screen.getByLabelText('תאריך') as HTMLInputElement).value).toBe('2026-11-14');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('the form, correcting a movement', () => {
  const EDITING = {
    id: 'e7', occurredOn: '2026-11-02', direction: 'out' as const, amount: '1345.00',
    description: 'החזר לאורי — חוב כללי', accountId: 'a2', seasonId: 's1', budgetLineId: 'b1',
  };

  it('opens holding the movement as it is recorded', () => {
    renderForm({ editing: EDITING });
    expect((screen.getByLabelText('תאריך') as HTMLInputElement).value).toBe('2026-11-02');
    expect((screen.getByRole('radio', { name: 'יצא' }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole('spinbutton', { name: 'סכום בשקלים' }) as HTMLInputElement).value)
      .toBe('1345.00');
    expect((screen.getByRole('textbox', { name: 'תיאור' }) as HTMLInputElement).value)
      .toBe('החזר לאורי — חוב כללי');
    expect((screen.getByRole('combobox', { name: 'חשבון' }) as HTMLSelectElement).value).toBe('a2');
    expect((screen.getByRole('combobox', { name: 'שנה' }) as HTMLSelectElement).value).toBe('s1');
    expect((screen.getByRole('combobox', { name: 'סעיף תקציב' }) as HTMLSelectElement).value).toBe('b1');
  });

  it('saves to the movement it opened on, never as a new one', async () => {
    renderForm({ editing: EDITING });
    fill('תיאור', 'החזר לאורי מור — חוב כללי');
    fireEvent.click(screen.getByRole('button', { name: 'שמירת השינויים' }));
    await vi.waitFor(() => { expect(updateMovementAction).toHaveBeenCalledTimes(1); });
    expect(updateMovementAction).toHaveBeenCalledWith('e7', {
      occurredOn: '2026-11-02', direction: 'out', amount: 1345,
      description: 'החזר לאורי מור — חוב כללי', accountId: 'a2', seasonId: 's1', budgetLineId: 'b1',
    });
    expect(recordMovementAction).not.toHaveBeenCalled();
    await vi.waitFor(() => { expect(replace).toHaveBeenCalledWith('/money/ledger?season=s1'); });
  });

  /** The season it holds is the movement's, not the page's: a ברן 25 row
   *  opened from the ברן 26 ledger must not be moved a year by saving it. */
  it('keeps the movement in its own year, and a yearless one yearless', () => {
    renderForm({ seasonId: 's1', editing: { ...EDITING, seasonId: null, budgetLineId: null } });
    expect((screen.getByRole('combobox', { name: 'שנה' }) as HTMLSelectElement).value).toBe('');
  });

  /** The lines on offer are the opened year's. Under another year the library
   *  would refuse them, so the form does not send one. */
  it('drops the budget line when the year is changed, and says why', async () => {
    renderForm({ editing: EDITING });
    fireEvent.change(screen.getByRole('combobox', { name: 'שנה' }), { target: { value: 's0' } });
    const line = screen.getByRole('combobox', { name: 'סעיף תקציב' }) as HTMLSelectElement;
    expect(line.disabled).toBe(true);
    expect(screen.getByText(/שמרו את השנה החדשה/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'שמירת השינויים' }));
    await vi.waitFor(() => { expect(updateMovementAction).toHaveBeenCalledTimes(1); });
    const [, sent] = updateMovementAction.mock.calls[0] as [string, Record<string, unknown>];
    expect(sent.seasonId).toBe('s0');
    expect(sent.budgetLineId).toBeUndefined();
  });

  it('shows the refusal and stays open when the library says no', async () => {
    updateMovementAction.mockResolvedValue({
      ok: false, error: 'התנועה הזו סוגרת חוב, ולכן אי אפשר לשנות את הסכום או את הכיוון שלה',
    });
    renderForm({ editing: EDITING });
    fireEvent.click(screen.getByRole('button', { name: 'שמירת השינויים' }));
    expect((await screen.findByRole('alert')).textContent).toContain('סוגרת חוב');
    expect(replace).not.toHaveBeenCalled();
  });
});

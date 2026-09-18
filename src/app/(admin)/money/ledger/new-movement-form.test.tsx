/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { ActionResult } from '@/lib/action-result';

const { recordMovementAction, refresh, replace } = vi.hoisted(() => ({
  recordMovementAction: vi.fn<(input: unknown) => Promise<ActionResult>>(),
  refresh: vi.fn(),
  replace: vi.fn(),
}));
/** `./actions` is a `'use server'` module whose graph reaches `@/db`. */
vi.mock('./actions', () => ({ recordMovementAction }));
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

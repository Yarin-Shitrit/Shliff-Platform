/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { ActionResult } from '@/lib/action-result';

const { settleObligationAction, refresh, replace } = vi.hoisted(() => ({
  settleObligationAction: vi.fn<(input: unknown) => Promise<ActionResult>>(),
  refresh: vi.fn(),
  replace: vi.fn(),
}));
/** `./actions` is a `'use server'` module whose graph reaches `@/db`. */
vi.mock('./actions', () => ({ settleObligationAction }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh, replace }) }));

import { SettleForm } from './settle-form';

const ACCOUNTS = [
  { id: 'a1', name: 'קופה מזומן' },
  { id: 'a2', name: 'קופת מסיבות' },
];

/** U+200F, a right-to-left mark: invisible, and truthy to `.trim()`. The
 *  point of using it is that a note of only this must still be refused, which
 *  is what `isBlank` is for and what `.trim()` would get wrong. */
const RLM = '‏';

function renderForm(over: Record<string, unknown> = {}) {
  render(
    <SettleForm
      obligationId="o1"
      direction="camp_owes"
      displayParty="רוני אדלר"
      outstandingAgorot={91000}
      accounts={ACCOUNTS}
      closeHref="/money/debts?season=s1"
      {...over}
    />,
  );
}

function chooseOffset() {
  fireEvent.click(screen.getByRole('radio', { name: 'קיזוז מול דמי קאמפ' }));
}

beforeEach(() => {
  vi.clearAllMocks();
  settleObligationAction.mockResolvedValue({ ok: true });
});

describe('the settlement form', () => {
  it('offers both ways a debt can be closed', () => {
    renderForm();
    expect(screen.getByRole('radio', { name: 'מזומן' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'קיזוז מול דמי קאמפ' })).toBeTruthy();
  });

  it('defaults the amount to what is still owed, and says what the ceiling is', () => {
    renderForm();
    const amount = screen.getByRole('spinbutton', { name: 'סכום בשקלים' }) as HTMLInputElement;
    expect(amount.value).toBe('910.00');
    expect(screen.getByText('אי אפשר לקזז יותר ממה שחייבים')).toBeTruthy();
  });

  it('shows the account select for a cash settlement, and no note requirement', () => {
    renderForm();
    expect(screen.getByRole('combobox', { name: 'מאיזה חשבון יצא הכסף' })).toBeTruthy();
    expect(screen.queryByRole('textbox', { name: /הערה/ })).toBeNull();
  });

  /**
   * The statement has to be readable while the lead is deciding, not after
   * they have committed — that is the whole reason this is a client
   * component.
   */
  it('states that an offset moves no cash, beside the choice, and drops the account select', () => {
    renderForm();
    chooseOffset();
    expect(screen.getByText('קיזוז אינו מזיז מזומן, ולכן אינו נכנס לאף חשבון ואינו מופיע בתנועות.'))
      .toBeTruthy();
    expect(screen.queryByRole('combobox', { name: 'מאיזה חשבון יצא הכסף' })).toBeNull();
    expect(screen.getByRole('textbox', { name: 'מול מה קוזז' })).toBeTruthy();
    expect(screen.getByText('חובה — בלי זה אי אפשר לדעת בעוד שנה מה קרה כאן')).toBeTruthy();
  });

  it('refuses an offset whose note is only an invisible mark, without calling the action', async () => {
    renderForm();
    chooseOffset();
    fireEvent.change(screen.getByRole('textbox', { name: 'מול מה קוזז' }), {
      target: { value: RLM },
    });
    fireEvent.click(screen.getByRole('button', { name: 'סגירת החוב' }));
    expect(settleObligationAction).not.toHaveBeenCalled();
    expect((await screen.findByRole('alert')).textContent)
      .toBe('קיזוז חייב לשאת הערה שאומרת מול מה קוזז');
  });

  it('sends an offset with its note, and never an account', async () => {
    renderForm();
    chooseOffset();
    fireEvent.change(screen.getByRole('textbox', { name: 'מול מה קוזז' }), {
      target: { value: 'מול דמי קאמפ של רוני' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'סגירת החוב' }));
    await vi.waitFor(() => { expect(settleObligationAction).toHaveBeenCalled(); });
    const [sent] = settleObligationAction.mock.calls[0] as [Record<string, unknown>];
    expect(sent.kind).toBe('offset');
    expect(sent.note).toBe('מול דמי קאמפ של רוני');
    expect(sent.accountId).toBeUndefined();
    expect(sent.amount).toBe(910);
  });

  it('sends a cash settlement with the chosen קופה', async () => {
    renderForm();
    fireEvent.change(screen.getByRole('combobox', { name: 'מאיזה חשבון יצא הכסף' }), {
      target: { value: 'a2' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'סגירת החוב' }));
    await vi.waitFor(() => { expect(settleObligationAction).toHaveBeenCalled(); });
    const [sent] = settleObligationAction.mock.calls[0] as [Record<string, unknown>];
    expect(sent.kind).toBe('cash');
    expect(sent.accountId).toBe('a2');
  });

  it('shows the library refusal unchanged, character for character', async () => {
    settleObligationAction.mockResolvedValue({
      ok: false, error: 'אי אפשר לקזז יותר ממה שחייבים',
    });
    renderForm();
    fireEvent.change(screen.getByRole('combobox', { name: 'מאיזה חשבון יצא הכסף' }), {
      target: { value: 'a1' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'סגירת החוב' }));
    expect((await screen.findByRole('alert')).textContent)
      .toBe('אי אפשר לקזז יותר ממה שחייבים');
    expect(refresh).not.toHaveBeenCalled();
  });
});

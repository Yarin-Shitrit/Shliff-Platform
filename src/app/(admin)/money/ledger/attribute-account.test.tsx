/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { ActionResult } from '@/lib/action-result';

/**
 * `fireEvent`, not `@testing-library/user-event`: R1 admits no new dependency,
 * test helpers included, and that package is not in this tree. Every other
 * client-component test here fires events the same way.
 */

const { attributeMovementAction, refresh } = vi.hoisted(() => ({
  attributeMovementAction: vi.fn<(input: unknown) => Promise<ActionResult>>(),
  refresh: vi.fn(),
}));
/** `./actions` is a `'use server'` module whose graph reaches `@/db`. */
vi.mock('./actions', () => ({ attributeMovementAction }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

import { AttributeAccount } from './attribute-account';

const ACCOUNTS = [
  { id: 'a1', name: 'קופה מזומן' },
  { id: 'a2', name: 'קופת מסיבות' },
];

function renderControl() {
  render(
    <AttributeAccount
      origin="ledger"
      movementId="e1"
      description="מים וקרח"
      accounts={ACCOUNTS}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  attributeMovementAction.mockResolvedValue({ ok: true });
});

describe('the account control on an unattributed row', () => {
  it('names the movement it would place, so a row of them is not a row of identical selects', () => {
    renderControl();
    const select = screen.getByRole('combobox', { name: 'שיוך מים וקרח לחשבון' });
    expect(select).toBeTruthy();
    for (const account of ACCOUNTS) {
      expect(screen.getByRole('option', { name: account.name })).toBeTruthy();
    }
  });

  /**
   * The placeholder option is not a choosable account, so choosing nothing
   * cannot silently place the money in whichever קופה happened to sort first
   * — that would be the system guessing, which is the one thing it may not
   * do with a shekel.
   */
  it('does not submit, or reach the action, with no account chosen', async () => {
    renderControl();
    fireEvent.click(screen.getByRole('button', { name: 'שיוך' }));
    expect(attributeMovementAction).not.toHaveBeenCalled();
    expect((await screen.findByRole('alert')).textContent).toBe('בחרו חשבון לפני השיוך');
  });

  it('sends the movement and the chosen account, and nothing the row did not say', async () => {
    renderControl();
    fireEvent.change(screen.getByRole('combobox', { name: 'שיוך מים וקרח לחשבון' }), {
      target: { value: 'a2' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'שיוך' }));
    expect(attributeMovementAction).toHaveBeenCalledWith({
      origin: 'ledger', id: 'e1', accountId: 'a2',
    });
    await vi.waitFor(() => { expect(refresh).toHaveBeenCalled(); });
  });

  it('shows the library refusal in place, in Hebrew', async () => {
    attributeMovementAction.mockResolvedValue({
      ok: false, error: 'התנועה הזו כבר משויכת לחשבון',
    });
    renderControl();
    fireEvent.change(screen.getByRole('combobox', { name: 'שיוך מים וקרח לחשבון' }), {
      target: { value: 'a1' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'שיוך' }));
    expect((await screen.findByRole('alert')).textContent)
      .toBe('התנועה הזו כבר משויכת לחשבון');
    expect(refresh).not.toHaveBeenCalled();
  });

  it('says so rather than offering an empty select when no account exists yet', () => {
    render(
      <AttributeAccount origin="ledger" movementId="e1" description="מים וקרח" accounts={[]} />,
    );
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.getByText('אין חשבונות להקצות אליהם')).toBeTruthy();
  });
});

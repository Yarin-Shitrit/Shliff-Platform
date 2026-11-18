/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { ActionResult } from '@/lib/action-result';

const { recordPartyMovementAction, refresh } = vi.hoisted(() => ({
  recordPartyMovementAction: vi.fn<(input: unknown) => Promise<ActionResult>>(),
  refresh: vi.fn(),
}));
/** `./actions` is a `'use server'` module whose graph reaches `@/db`. */
vi.mock('./actions', () => ({ recordPartyMovementAction }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh, replace: vi.fn() }) }));

import { PartyMovementForm } from './party-movement-form';

const ACCOUNTS = [
  { id: 'ofek', name: 'עו״ש אופק', fund: 'camp' as const },
  { id: 'vibes', name: 'וייבז קלוז פרינדס', fund: 'gift' as const },
  { id: 'old', name: 'קופה ישנה', fund: null },
];

function renderForm() {
  return render(
    <PartyMovementForm
      eventId="e1" partyName="מסיבת פקאנים" partnerName={null}
      defaultDate="2026-07-18" accounts={ACCOUNTS}
    />,
  );
}

function picker(): HTMLSelectElement {
  return screen.getByLabelText('חשבון') as HTMLSelectElement;
}

const NOTE = 'כסף של מסיבה הוא כסף של הגיפט, ו־עו״ש אופק רשום כחשבון של הקאמפ.';

describe("the party form's account", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    recordPartyMovementAction.mockResolvedValue({ ok: true });
  });

  /* A party raises money for the gift, so the gift's accounts are the likely
     answer and sit on top. On top is not chosen: the form still opens on
     `לא צוין`, because where the money went is the lead's to say. */
  it("lists the gift's accounts first, and still chooses none of them", () => {
    const { container } = renderForm();
    expect([...container.querySelectorAll('optgroup')].map((group) => group.getAttribute('label')))
      .toEqual(['הגיפט', 'הקאמפ', 'לא נקבע של מי הכסף']);
    expect(picker().value).toBe('');
  });

  it("says so when a party's money is filed under one of the camp's accounts", () => {
    renderForm();
    expect(screen.queryByText(NOTE)).toBeNull();
    fireEvent.change(picker(), { target: { value: 'ofek' } });
    expect(screen.getByText(NOTE)).toBeTruthy();
  });

  it("says nothing for the gift's account, or for one nobody has placed", () => {
    renderForm();
    fireEvent.change(picker(), { target: { value: 'vibes' } });
    expect(screen.queryByText(/רשום כחשבון של/)).toBeNull();
    fireEvent.change(picker(), { target: { value: 'old' } });
    expect(screen.queryByText(/רשום כחשבון של/)).toBeNull();
  });

  /* A note, never a refusal: the camp does sometimes hold the gift's money in
     a camp account, and the lead is the one who knows. */
  it('still records the movement under the account the lead chose', async () => {
    renderForm();
    fireEvent.change(picker(), { target: { value: 'ofek' } });
    fireEvent.change(screen.getByLabelText(/סכום/), { target: { value: '500' } });
    fireEvent.click(screen.getByRole('button', { name: 'רישום' }));
    await vi.waitFor(() => expect(recordPartyMovementAction).toHaveBeenCalledTimes(1));
    expect(recordPartyMovementAction.mock.calls[0][0]).toMatchObject({ accountId: 'ofek' });
  });
});

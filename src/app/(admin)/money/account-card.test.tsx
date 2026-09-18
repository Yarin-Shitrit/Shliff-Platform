/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { AccountBalance } from '@/lib/money/accounts';
import { AccountCard } from './account-card';

function account(overrides: Partial<AccountBalance> = {}): AccountBalance {
  return {
    accountId: 'a1', name: 'קופת מזומן', kind: 'cash',
    holderPersonId: null, holderName: null, balanceAgorot: 412000,
    ...overrides,
  };
}

describe('AccountCard', () => {
  it('names the account, its kind and its derived balance', () => {
    render(<AccountCard account={account()} />);
    expect(screen.getByText('קופת מזומן')).toBeTruthy();
    expect(screen.getByText('מזומן')).toBeTruthy();
    expect(screen.getByText(/4,120/)).toBeTruthy();
  });

  it('warns beside a personal account, in words, and links to whoever holds it', () => {
    render(<AccountCard account={account({
      accountId: 'a2', name: 'עו״ש אופק', kind: 'personal',
      holderPersonId: 'p9', holderName: 'אופק', balanceAgorot: 1407955,
    })} />);
    expect(screen.getByText('חשבון פרטי')).toBeTruthy();
    const warning = screen.getByText(/שמחזיק כסף של הקאמפ/);
    expect(warning.textContent).toContain('חשבון פרטי של אופק שמחזיק כסף של הקאמפ');
    expect(screen.getByRole('link', { name: 'אופק' }).getAttribute('href'))
      .toBe('/members/p9');
  });

  // A personal account whose holder was never linked is still a personal
  // account, and the warning is the whole point of the row.
  it('still warns when a personal account has no linked holder', () => {
    render(<AccountCard account={account({
      kind: 'personal', holderPersonId: null, holderName: null,
    })} />);
    expect(screen.getByText(/חשבון פרטי של חבר מחנה שמחזיק כסף של הקאמפ/)).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('labels every kind the schema allows, never a raw enum value', () => {
    for (const [kind, label] of [
      ['cash', 'מזומן'], ['bank', 'בנק'],
      ['personal', 'חשבון פרטי'], ['event_float', 'קופת אירוע'],
    ] as const) {
      const { unmount } = render(<AccountCard account={account({ kind })} />);
      expect(screen.getByText(label)).toBeTruthy();
      unmount();
    }
  });

  // R3: a personal account is not marked by a border colour alone. Whatever
  // the card's border says, the word `חשבון פרטי` and the sentence beneath it
  // say the same thing in text.
  it('never marks a personal account by colour alone', () => {
    const { container } = render(<AccountCard account={account({
      kind: 'personal', holderPersonId: 'p9', holderName: 'אופק',
    })} />);
    expect(container.textContent).toContain('חשבון פרטי');
    expect(container.textContent).toContain('שמחזיק כסף של הקאמפ');
  });

  // A non-personal account with a named holder is a fact, not a warning: the
  // בנק account is in the camp's name and someone signs for it.
  it('names a non-personal account\'s holder without warning about it', () => {
    render(<AccountCard account={account({
      kind: 'bank', name: 'חשבון הקאמפ', holderName: 'טלי', holderPersonId: null,
    })} />);
    expect(screen.getByText(/טלי/)).toBeTruthy();
    expect(screen.queryByText(/שמחזיק כסף של הקאמפ/)).toBeNull();
  });
});

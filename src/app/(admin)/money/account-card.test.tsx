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
    countedAgorot: 412000, countedOn: null, closed: false,
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

  /**
   * The count day is the figure's provenance, and the link is the page that
   * can change it — both on the card, never only in a footnote.
   */
  it('says when the balance was counted and offers the count drawer', () => {
    render(<AccountCard
      account={account({ countedOn: new Date('2025-10-30T00:00:00Z') })}
      countHref="/money?season=s1&account=a1&act=count"
    />);
    expect(screen.getByText(/נספר ב־/).textContent).toContain('נספר ב־30/10/25, ומאז לפי התנועות');
    expect(screen.getByRole('link', { name: 'ספירת קופה' }).getAttribute('href'))
      .toBe('/money?season=s1&account=a1&act=count');
  });

  it('says a never-counted balance is an opening plus every movement', () => {
    render(<AccountCard account={account({ countedOn: null })} countHref="/money?act=count" />);
    expect(screen.getByText('יתרת פתיחה ועוד כל התנועות')).toBeTruthy();
    expect(screen.queryByText(/נספר ב־/)).toBeNull();
  });

  // A closed קופה holds nothing today, so there is nothing to count.
  it('offers no count on a closed account, and none at all without an href', () => {
    const { unmount } = render(<AccountCard
      account={account({ closed: true })} countHref="/money?act=count"
    />);
    expect(screen.queryByRole('link', { name: 'ספירת קופה' })).toBeNull();
    unmount();
    render(<AccountCard account={account()} />);
    expect(screen.queryByRole('link', { name: 'ספירת קופה' })).toBeNull();
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

  it('offers the holder drawer when given its href, and nothing without one', () => {
    render(<AccountCard account={account()} holderHref="/money?season=s1&account=a1&act=holder" />);
    expect(screen.getByRole('link', { name: 'מי מחזיק/ה' }).getAttribute('href'))
      .toBe('/money?season=s1&account=a1&act=holder');
    render(<AccountCard account={account({ accountId: 'a2', name: 'אחר' })} />);
    expect(screen.getAllByRole('link', { name: 'מי מחזיק/ה' })).toHaveLength(1);
  });
});

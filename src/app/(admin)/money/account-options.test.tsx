/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { AccountOptions } from './account-options';
import type { AccountChoice } from './account-options';

const ACCOUNTS: AccountChoice[] = [
  { id: 'vibes', name: 'וייבז קלוז פרינדס', fund: 'gift' },
  { id: 'ofek', name: 'עו״ש אופק', fund: 'camp' },
  { id: 'cash', name: 'קופת מזומן', fund: 'camp' },
  { id: 'old', name: 'קופה ישנה', fund: null },
];

function groups(first?: 'camp' | 'gift') {
  const { container } = render(
    <select aria-label="חשבון">
      <option value="">לא צוין</option>
      <AccountOptions accounts={ACCOUNTS} first={first} />
    </select>,
  );
  return [...container.querySelectorAll('optgroup')].map((group) => [
    group.getAttribute('label'),
    [...group.querySelectorAll('option')].map((option) => [option.value, option.textContent]),
  ]);
}

describe('AccountOptions', () => {
  /* A flat list of names makes `עו״ש אופק` and `וייבז קלוז פרינדס` look like
     two interchangeable places to put a payment. Under a heading per pot the
     choice says what it means before it is made. */
  it("lists every account under its pot's heading, the camp's first", () => {
    expect(groups()).toEqual([
      ['הקאמפ', [['ofek', 'עו״ש אופק'], ['cash', 'קופת מזומן']]],
      ['הגיפט', [['vibes', 'וייבז קלוז פרינדס']]],
      ['לא נקבע של מי הכסף', [['old', 'קופה ישנה']]],
    ]);
  });

  it("puts the gift's accounts on top when asked, and still offers the camp's", () => {
    expect(groups('gift').map(([label]) => label))
      .toEqual(['הגיפט', 'הקאמפ', 'לא נקבע של מי הכסף']);
  });

  it("leaves the form's own empty option alone, and selects nothing", () => {
    const { container } = render(
      <select aria-label="חשבון" defaultValue="">
        <option value="">לא צוין</option>
        <AccountOptions accounts={ACCOUNTS} first="gift" />
      </select>,
    );
    const select = container.querySelector('select')!;
    expect(select.options[0].textContent).toBe('לא צוין');
    // Reordering is not choosing: which account money went to is the lead's.
    expect(select.value).toBe('');
    expect(select.options).toHaveLength(5);
  });
});

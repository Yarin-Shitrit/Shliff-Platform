import { describe, it, expect } from 'vitest';
import type { AccountFund } from '@/db/schema/money';
import {
  ACCOUNT_FUNDS, fundLabel, fundOf, groupByFund, isAccountFund, otherPotNote,
} from './labels';

type Row = { id: string; fund: AccountFund | null };

const ROWS: Row[] = [
  { id: 'vibes', fund: 'gift' },
  { id: 'ofek', fund: 'camp' },
  { id: 'old', fund: null },
  { id: 'cash', fund: 'camp' },
];

function shape(groups: ReturnType<typeof groupByFund<Row>>) {
  return groups.map((group) => [group.fund, group.label, group.rows.map((row) => row.id)]);
}

describe('the two pots', () => {
  it('are the camp and the gift, in that order, and nothing else', () => {
    expect(ACCOUNT_FUNDS).toEqual(['camp', 'gift']);
    expect(isAccountFund('camp')).toBe(true);
    expect(isAccountFund('gift')).toBe(true);
    // The budget's other category is not a pot, and neither is a blank.
    for (const value of ['dancefloor', '', null, undefined, 3]) {
      expect(isAccountFund(value)).toBe(false);
    }
  });

  it('names a pot as a tag, and says so when nobody has placed the account', () => {
    expect(fundLabel('camp')).toBe('קאמפ');
    expect(fundLabel('gift')).toBe('גיפט');
    expect(fundLabel(null)).toBe('לא נקבע');
  });

  /* The column is `text` with a type over it. A value that is neither pot
     must read as "nobody has placed it" — never as `undefined` on a screen. */
  it('reads a stored value that is neither pot as not placed', () => {
    expect(fundOf('dancefloor')).toBeNull();
    expect(fundLabel('dancefloor' as never)).toBe('לא נקבע');
  });
});

describe('groupByFund', () => {
  it("lists the camp's rows, then the gift's, then the ones nobody placed", () => {
    expect(shape(groupByFund(ROWS))).toEqual([
      ['camp', 'הקאמפ', ['ofek', 'cash']],
      ['gift', 'הגיפט', ['vibes']],
      [null, 'לא נקבע של מי הכסף', ['old']],
    ]);
  });

  it("puts the gift's rows on top when the screen is about a party", () => {
    expect(shape(groupByFund(ROWS, 'gift')).map(([fund]) => fund)).toEqual(['gift', 'camp', null]);
  });

  it('leaves out a pot with nothing in it rather than drawing it empty', () => {
    expect(shape(groupByFund(ROWS.filter((row) => row.fund === 'gift')))).toEqual([
      ['gift', 'הגיפט', ['vibes']],
    ]);
    expect(groupByFund([])).toEqual([]);
  });

  /* Dropping it would take an account off every picker with nothing saying
     why; under the unplaced heading it is a decision somebody can make. */
  it('keeps a row whose stored pot is unknown, under the unplaced heading', () => {
    const groups = groupByFund([...ROWS, { id: 'bad', fund: 'dancefloor' as never }]);
    expect(groups.flatMap((group) => group.rows)).toHaveLength(5);
    expect(groups.at(-1)!.rows.map((row) => row.id)).toEqual(['old', 'bad']);
  });
});

describe('otherPotNote', () => {
  const claim = 'דמי קאמפ הם כסף של הקאמפ';

  it("says both halves when the camp's money is filed under the gift's account", () => {
    expect(otherPotNote({ name: 'וייבז קלוז פרינדס', fund: 'gift' }, 'camp', claim))
      .toBe('דמי קאמפ הם כסף של הקאמפ, ו־וייבז קלוז פרינדס רשום כחשבון של הגיפט.');
  });

  it('says it the other way round for a party filed under the camp', () => {
    expect(otherPotNote({ name: 'עו״ש אופק', fund: 'camp' }, 'gift', 'כסף של מסיבה הוא כסף של הגיפט'))
      .toBe('כסף של מסיבה הוא כסף של הגיפט, ו־עו״ש אופק רשום כחשבון של הקאמפ.');
  });

  it('says nothing for the right pot, for no account, and for one nobody placed', () => {
    expect(otherPotNote({ name: 'עו״ש אופק', fund: 'camp' }, 'camp', claim)).toBeNull();
    expect(otherPotNote(null, 'camp', claim)).toBeNull();
    expect(otherPotNote(undefined, 'camp', claim)).toBeNull();
    // Whose money it is has not been said, so there is nothing to contradict.
    expect(otherPotNote({ name: 'קופה ישנה', fund: null }, 'camp', claim)).toBeNull();
  });
});

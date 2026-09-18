/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import type { PersonListRow, PersonDues } from '@/lib/members/people-list';

/**
 * `@testing-library/user-event` is not an installed dependency in this repo
 * and adding it is off-limits (R1). `fireEvent.click` from the already
 * installed `@testing-library/react` exercises the same paths these tests
 * need — the same reasoning `merge-control.test.tsx` recorded.
 */

const { push, addToSeasonBulkAction, issueDuesBulkAction } = vi.hoisted(() => ({
  push: vi.fn(),
  addToSeasonBulkAction: vi.fn(async () => ({ ok: true, added: 0 })),
  issueDuesBulkAction: vi.fn(async () => ({ ok: true, issued: 0, already: 0, offRoster: [] })),
}));
/** `./actions` is a `'use server'` module whose graph reaches `@/db`. */
vi.mock('./actions', () => ({ addToSeasonBulkAction, issueDuesBulkAction }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, refresh: () => {} }),
  usePathname: () => '/members',
  useSearchParams: () => new URLSearchParams(),
}));

import { ToastProvider } from '@/components/ui/toaster';
import { parsePeopleQuery } from '@/lib/members/people-views';
import { PeopleTable, DUES_STATE_LABELS } from './people-table';

function dues(overrides: Partial<PersonDues> = {}): PersonDues {
  return {
    dueId: 'd1',
    amountAgorot: 120000,
    paidAgorot: 0,
    outstandingAgorot: 120000,
    kind: 'flat',
    exceptionReason: null,
    state: 'unpaid',
    ...overrides,
  };
}

function row(overrides: Partial<PersonListRow> = {}): PersonListRow {
  return {
    personId: 'p1',
    displayName: 'רוני אדלר',
    aliases: [],
    role: 'member',
    seasons: [{ seasonId: 's26', name: 'ברן 26', year: 2026, role: 'member' }],
    dues: null,
    outstandingAgorot: 0,
    taskCount: 0,
    lastActivityAt: new Date('2026-09-01T10:00:00Z'),
    onScopeSeason: true,
    newThisSeason: false,
    lapsed: false,
    ...overrides,
  };
}

/* The real tree gets its provider from `(admin)/layout.tsx`. */
function renderTable(rows: PersonListRow[], params: Record<string, string> = {}) {
  return render(
    <ToastProvider><PeopleTable
      rows={rows}
      seasonYears={[2025, 2026]}
      params={params}
      seasonId="s26"
      seasonName="ברן 26"
      viewLabel="ברן 26"
      empty={<p>אין כאן כלום עדיין</p>}
    /></ToastProvider>,
  );
}

beforeEach(() => { push.mockClear(); });

describe('PeopleTable — the name cell', () => {
  it('links the display name to the record page', () => {
    renderTable([row()]);
    const link = screen.getByRole('link', { name: 'רוני אדלר' });
    expect(link.getAttribute('href')).toBe('/members/p1');
  });

  it('lists every other spelling after גם:', () => {
    renderTable([row({ aliases: ['Roni A.', 'רוני'] })]);
    expect(screen.getByText('גם: Roni A. · רוני')).toBeTruthy();
  });

  it('says גם: nothing at all when a person has one spelling', () => {
    renderTable([row({ aliases: [] })]);
    expect(screen.queryByText(/גם:/)).toBeNull();
  });
});

describe('PeopleTable — the season chips', () => {
  it('draws one chip per season the camp has, marking the ones this person was on', () => {
    renderTable([row({
      seasons: [{ seasonId: 's26', name: 'ברן 26', year: 2026, role: 'member' }],
    })]);
    const chips = screen.getByRole('img', { name: 'שנים: 2026' });
    expect(within(chips).getAllByText(/^\d\d$/).map((c) => c.textContent)).toEqual(['25', '26']);
    expect(within(chips).getByText('26').getAttribute('data-on')).toBe('true');
    expect(within(chips).getByText('25').getAttribute('data-on')).toBe('false');
  });

  it('names no year at all for a person on no season', () => {
    renderTable([row({ seasons: [], onScopeSeason: false })]);
    expect(screen.getByRole('img', { name: 'לא שויך/ה לאף שנה' })).toBeTruthy();
  });
});

describe('PeopleTable — the dues cell', () => {
  it('tells שולם בקיזוז apart from שולם, because no cash ever arrived', () => {
    renderTable([row({ dues: dues({ paidAgorot: 120000, outstandingAgorot: 0, state: 'offset' }) })]);
    expect(screen.getByText('שולם בקיזוז')).toBeTruthy();
    expect(screen.queryByText('שולם')).toBeNull();
  });

  /*
   * R3: never colour alone. A part payment is the one state whose *degree*
   * matters, so it carries a meter as well as the word. Remove the meter and
   * this fails; change the word and the first assertion fails.
   */
  it('gives a part payment a meter as well as a word', () => {
    renderTable([row({ dues: dues({ paidAgorot: 50000, outstandingAgorot: 70000, state: 'partial' }) })]);
    expect(screen.getByText('שולם חלקית')).toBeTruthy();
    const meter = screen.getByRole('meter', { name: 'שולם 500 ₪ מתוך 1,200 ₪' });
    expect(meter.getAttribute('aria-valuenow')).toBe('50000');
    expect(meter.getAttribute('aria-valuemax')).toBe('120000');
  });

  it('gives no meter to a state that is not partway through', () => {
    renderTable([row({ dues: dues({ state: 'unpaid' }) })]);
    expect(screen.getByText('טרם שולם')).toBeTruthy();
    expect(screen.queryByRole('meter')).toBeNull();
  });

  it('marks an exception with its own pill carrying the amount', () => {
    renderTable([row({
      dues: dues({ kind: 'exception', amountAgorot: 60000, outstandingAgorot: 60000, exceptionReason: 'הובילה את ההקמה' }),
    })]);
    expect(screen.getByText('חריג · 600 ₪')).toBeTruthy();
  });

  it('calls a person with no due אין חיוב rather than leaving the cell blank', () => {
    renderTable([row({ dues: null })]);
    expect(screen.getByText(DUES_STATE_LABELS.none)).toBeTruthy();
  });
});

describe('PeopleTable — the numeric columns', () => {
  it('writes a zero balance as — rather than as 0 ₪', () => {
    const { container } = renderTable([row({ outstandingAgorot: 0 })]);
    expect(screen.queryByText('0 ₪')).toBeNull();
    const body = container.querySelector('tbody')!;
    expect(within(body as HTMLElement).getAllByText('—').length).toBeGreaterThan(0);
  });

  it('writes a real balance through the one money helper', () => {
    const { container } = renderTable([row({ outstandingAgorot: 70000 })]);
    /* Scoped to the body: the totals row carries the same figure, which is the
       point of summing it from the displayed rows. */
    const body = container.querySelector('tbody')!;
    expect(within(body as HTMLElement).getByText('700 ₪')).toBeTruthy();
  });
});

describe('PeopleTable — selection', () => {
  const two = [
    row({ personId: 'a', displayName: 'איתי כהן' }),
    row({ personId: 'b', displayName: 'נועה לוי' }),
  ];

  function select(name: string) {
    fireEvent.click(screen.getByRole('checkbox', { name: `בחירת ${name}` }));
  }

  it('says nothing at all until something is selected', () => {
    renderTable(two);
    expect(screen.queryByRole('region', { name: 'פעולות על הנבחרים' })).toBeNull();
  });

  it('counts the selection in Hebrew that agrees with the number', () => {
    renderTable(two);
    select('איתי כהן');
    expect(screen.getByText('נבחר אחד')).toBeTruthy();
    select('נועה לוי');
    expect(screen.getByText('2 נבחרו')).toBeTruthy();
  });

  /*
   * A merge is pairwise and irreversible, so the control is rendered disabled
   * rather than hidden: a button that appears and disappears teaches nothing
   * about why it is unavailable.
   */
  it('refuses מיזוג with one row selected, and says how many it wants', () => {
    renderTable(two);
    select('איתי כהן');
    const merge = screen.getByRole('button', { name: /מיזוג/ });
    expect(merge.hasAttribute('disabled')).toBe(true);
  });

  it('opens A3 merge drawer over the two selected records', () => {
    renderTable(two);
    select('איתי כהן');
    select('נועה לוי');
    const merge = screen.getByRole('button', { name: /מיזוג/ });
    expect(merge.hasAttribute('disabled')).toBe(false);
    fireEvent.click(merge);
    expect(push).toHaveBeenCalledTimes(1);
    /* Asserted through the parser rather than as a literal string: param order
       carries no meaning, but which id is absorbed and which survives does. */
    const pushed = new URL(push.mock.calls[0][0] as string, 'http://x');
    expect(pushed.pathname).toBe('/members');
    expect(parsePeopleQuery(Object.fromEntries(pushed.searchParams), true).merge)
      .toEqual(['a', 'b']);
  });

  it('offers the two idempotent writes and the export, all named after the season', () => {
    renderTable(two);
    select('איתי כהן');
    expect(screen.getByRole('button', { name: /שיוך לברן 26/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /הנפקת חיוב/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /ייצוא/ })).toBeTruthy();
  });

  /* The export is roster-driven and season-scoped, so with no season in scope
     it would hand the lead an empty file. */
  it('withholds ייצוא and both writes when no season is in scope', () => {
    render(
      <ToastProvider><PeopleTable
        rows={two}
        seasonYears={[2025, 2026]}
        params={{}}
        seasonId={null}
        seasonName={null}
        viewLabel="כולם"
        empty={<p>אין כאן כלום עדיין</p>}
      /></ToastProvider>,
    );
    select('איתי כהן');
    expect(screen.queryByRole('button', { name: /ייצוא/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /הנפקת חיוב/ })).toBeNull();
    expect(screen.getByRole('button', { name: /מיזוג/ })).toBeTruthy();
  });

  /*
   * C8's destructive slot. Every bulk action that could destroy anything was
   * refused in actions.ts, so there is nothing to put behind `עוד` — and an
   * empty `עוד` would promise a lead there is more here than there is.
   */
  it('renders no עוד control, because no bulk action on people is destructive', () => {
    renderTable(two);
    select('איתי כהן');
    expect(screen.queryByRole('button', { name: 'עוד' })).toBeNull();
  });

  it('empties the selection when the bar is cleared', () => {
    renderTable(two);
    select('איתי כהן');
    fireEvent.click(screen.getByRole('button', { name: 'ביטול הבחירה' }));
    expect(screen.queryByRole('region', { name: 'פעולות על הנבחרים' })).toBeNull();
  });
});

describe('PeopleTable — the row action', () => {
  /* One label per row, not one label repeated: 38 links all reading
     `תצוגה מהירה` are indistinguishable to a screen reader. */
  it('offers a peek that is a URL, carrying whatever the list is already filtered to', () => {
    renderTable([row()], { season: 's26', view: 'unpaid' });
    const peek = screen.getByRole('link', { name: 'תצוגה מהירה: רוני אדלר' });
    expect(peek.getAttribute('href')).toContain('peek=p1');
    expect(peek.getAttribute('href')).toContain('view=unpaid');
    expect(peek.getAttribute('href')).toContain('season=s26');
  });
});

import { describe, it, expect } from 'vitest';
import type { PersonListRow } from './people-list';
import {
  parsePeopleQuery, matchesView, applyPeopleQuery, viewCounts,
  peekHref, mergeHref, closeDrawerHref,
} from './people-views';

function row(overrides: Partial<PersonListRow> = {}): PersonListRow {
  return {
    personId: 'p1',
    displayName: 'אופק כהן',
    aliases: [],
    role: 'member',
    seasons: [],
    dues: null,
    outstandingAgorot: 0,
    taskCount: 0,
    lastActivityAt: new Date('2026-09-01'),
    onScopeSeason: true,
    newThisSeason: false,
    lapsed: false,
    ...overrides,
  };
}

describe('parsePeopleQuery', () => {
  it('defaults to the season roster when a season is in scope, and to כולם when none is', () => {
    expect(parsePeopleQuery({}, true).view).toBe('roster');
    expect(parsePeopleQuery({}, false).view).toBe('all');
  });

  it('degrades an unknown value to its default instead of throwing', () => {
    const query = parsePeopleQuery(
      { view: 'nonsense', sort: 'colour', dir: 'sideways', dues: 'maybe' }, true,
    );
    expect(query.view).toBe('roster');
    expect(query.sort).toBe('name');
    expect(query.dir).toBe('asc');
    expect(query.dues).toBeNull();
  });

  it('takes the first value when a param is repeated', () => {
    expect(parsePeopleQuery({ view: ['leads', 'all'] }, true).view).toBe('leads');
  });

  /*
   * Addendum A3 overrides this plan's `?merge=<a>,<b>`: an action drawer is
   * `?peek=<id>&act=<verb>`, so a merge is `?peek=<a>&act=merge&with=<b>` —
   * the record being folded away stays in `peek`, and the survivor is named.
   */
  it('reads the peek and act params R6 drives the drawers with', () => {
    const peeking = parsePeopleQuery({ peek: 'p9' }, true);
    expect(peeking.peek).toBe('p9');
    expect(peeking.act).toBeNull();
    expect(peeking.merge).toBeNull();

    const merging = parsePeopleQuery({ peek: 'p1', act: 'merge', with: 'p2' }, true);
    expect(merging.peek).toBe('p1');
    expect(merging.act).toBe('merge');
    expect(merging.merge).toEqual(['p1', 'p2']);
  });

  it('ignores a merge that does not name exactly two different people', () => {
    expect(parsePeopleQuery({ peek: 'p1', act: 'merge' }, true).merge).toBeNull();
    expect(parsePeopleQuery({ act: 'merge', with: 'p2' }, true).merge).toBeNull();
    expect(parsePeopleQuery({ peek: 'p1', act: 'merge', with: 'p1' }, true).merge).toBeNull();
  });

  it('does not read a merge out of two ids with no act verb naming one', () => {
    expect(parsePeopleQuery({ peek: 'p1', with: 'p2' }, true).merge).toBeNull();
  });
});

describe('matchesView', () => {
  it('puts everyone in כולם, including someone on no season', () => {
    expect(matchesView(row({ onScopeSeason: false, seasons: [] }), 'all')).toBe(true);
  });

  it('keeps the season roster to the season', () => {
    expect(matchesView(row({ onScopeSeason: true }), 'roster')).toBe(true);
    expect(matchesView(row({ onScopeSeason: false }), 'roster')).toBe(false);
  });

  it('counts an unpaid and a part-paid due as טרם שילמו, and an un-issued one as neither', () => {
    const owing = row({ dues: { dueId: 'd', amountAgorot: 120000, paidAgorot: 0, outstandingAgorot: 120000, kind: 'flat', exceptionReason: null, state: 'unpaid' } });
    const partial = row({ dues: { dueId: 'd', amountAgorot: 120000, paidAgorot: 50000, outstandingAgorot: 70000, kind: 'flat', exceptionReason: null, state: 'partial' } });
    expect(matchesView(owing, 'unpaid')).toBe(true);
    expect(matchesView(partial, 'unpaid')).toBe(true);
    expect(matchesView(row({ dues: null }), 'unpaid')).toBe(false);
  });

  it('never calls an exempt or offset due unpaid', () => {
    const exempt = row({ dues: { dueId: 'd', amountAgorot: 0, paidAgorot: 0, outstandingAgorot: 0, kind: 'exception', exceptionReason: 'הובילה את ההקמה', state: 'exempt' } });
    const offset = row({ dues: { dueId: 'd', amountAgorot: 120000, paidAgorot: 120000, outstandingAgorot: 0, kind: 'flat', exceptionReason: null, state: 'offset' } });
    expect(matchesView(exempt, 'unpaid')).toBe(false);
    expect(matchesView(offset, 'unpaid')).toBe(false);
  });

  it('reads חדשים השנה, ראשי צוות and לא חזרו השנה off the row', () => {
    expect(matchesView(row({ newThisSeason: true }), 'new')).toBe(true);
    expect(matchesView(row({ role: 'lead' }), 'leads')).toBe(true);
    expect(matchesView(row({ role: 'member' }), 'leads')).toBe(false);
    expect(matchesView(row({ lapsed: true }), 'lapsed')).toBe(true);
  });
});

describe('applyPeopleQuery', () => {
  const people = [
    row({ personId: 'a', displayName: 'רוני אדלר', aliases: ['Roni A.', 'רוני'], outstandingAgorot: 0, taskCount: 2 }),
    row({ personId: 'b', displayName: 'איתי כהן', aliases: ['Itay'], outstandingAgorot: 120000, taskCount: 1 }),
    row({ personId: 'c', displayName: 'נועה לוי', aliases: [], outstandingAgorot: 70000, taskCount: 0 }),
  ];

  it('finds a person by an alias, not only by their display name', () => {
    const found = applyPeopleQuery(people, parsePeopleQuery({ view: 'all', q: 'Roni' }, true));
    expect(found.map((r) => r.personId)).toEqual(['a']);
  });

  it('matches a name typed with stray spaces the way the matcher already normalizes', () => {
    const found = applyPeopleQuery(people, parsePeopleQuery({ view: 'all', q: '  נועה   לוי ' }, true));
    expect(found.map((r) => r.personId)).toEqual(['c']);
  });

  it('sorts by balance descending when asked, and breaks every tie by name', () => {
    const sorted = applyPeopleQuery(
      people, parsePeopleQuery({ view: 'all', sort: 'balance', dir: 'desc' }, true),
    );
    expect(sorted.map((r) => r.personId)).toEqual(['b', 'c', 'a']);
  });

  it('leaves the input array untouched', () => {
    const before = people.map((r) => r.personId);
    applyPeopleQuery(people, parsePeopleQuery({ view: 'all', sort: 'balance' }, true));
    expect(people.map((r) => r.personId)).toEqual(before);
  });
});

describe('viewCounts', () => {
  it('counts every view against the unfiltered rows, so a search does not empty the tabs', () => {
    const counts = viewCounts([
      row({ personId: 'a', role: 'lead' }),
      row({ personId: 'b', newThisSeason: true }),
      row({ personId: 'c', onScopeSeason: false, lapsed: true }),
    ]);
    expect(counts.all).toBe(3);
    expect(counts.roster).toBe(2);
    expect(counts.leads).toBe(1);
    expect(counts.new).toBe(1);
    expect(counts.lapsed).toBe(1);
    expect(counts.unpaid).toBe(0);
  });
});

/*
 * A3 again: every one of these goes through the kit's `drawer-url.ts`, so the
 * close control, `esc` and the back button cannot disagree about which params
 * a drawer owns. The tests assert the shape because the shape is the contract
 * the record page and the bulk bar both link against.
 */
describe('the drawer hrefs', () => {
  it('keeps the season, the view and the search when a peek opens', () => {
    const href = peekHref({ season: 's1', view: 'leads', q: 'רוני' }, 'p9');
    expect(href).toContain('season=s1');
    expect(href).toContain('view=leads');
    expect(href).toContain('peek=p9');
    expect(href.startsWith('/members?')).toBe(true);
  });

  it('replaces an open drawer rather than stacking a second one', () => {
    const href = peekHref({ peek: 'p1', act: 'merge', with: 'p2' }, 'p9');
    expect(href).toContain('peek=p9');
    expect(href).not.toContain('act=merge');
    expect(href).not.toContain('p1');
  });

  it('names the survivor in `with` and the absorbed record in `peek`', () => {
    const href = mergeHref({ season: 's1', view: 'roster' }, 'source9', 'target4');
    expect(href).toContain('peek=source9');
    expect(href).toContain('act=merge');
    expect(href).toContain('with=target4');
    expect(href).toContain('season=s1');
    expect(parsePeopleQuery(
      Object.fromEntries(new URL(href, 'http://x').searchParams), true,
    ).merge).toEqual(['source9', 'target4']);
  });

  it('drops every param the drawer owns on close, and keeps every other one', () => {
    const href = closeDrawerHref({
      season: 's1', view: 'unpaid', q: 'לוי', peek: 'p1', act: 'merge', with: 'p2',
    });
    expect(href).not.toContain('peek=');
    expect(href).not.toContain('act=');
    expect(href).not.toContain('with=');
    expect(href).toContain('season=s1');
    expect(href).toContain('view=unpaid');
  });

  it('closes to the bare path when the list carried no other state', () => {
    expect(closeDrawerHref({ peek: 'p1' })).toBe('/members');
  });
});

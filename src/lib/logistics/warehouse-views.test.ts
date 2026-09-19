import { describe, it, expect } from 'vitest';
import {
  parseWarehouseQuery, warehouseHref, categoryHref, WAREHOUSE_PATH,
} from './warehouse-views';

/**
 * Filter, search and sort are URL params resolved on the server, never client
 * state. Plan `ui-03` Task 2 is binding on this: the kit's `Table` has no
 * `onSort`, because a table that re-sorted in the browser would sort only the
 * rows it was handed and then disagree with the totals row and the row count,
 * both of which the page computes over the whole filtered set.
 */
describe('warehouse query parsing', () => {
  it('falls back to the default view rather than throwing on nonsense', () => {
    // These links get pasted into chats and arrive truncated. The right answer
    // is the default view, not an error page.
    expect(parseWarehouseQuery({ view: 'nope' }).view).toBe('all');
    expect(parseWarehouseQuery({}).view).toBe('all');
    expect(parseWarehouseQuery({ view: ['attention', 'all'] }).view).toBe('attention');
  });

  it('defaults sorting to condition, which is what the screen is for', () => {
    // Somebody opening the warehouse is usually asking "what needs doing
    // before we leave", not "list things alphabetically".
    expect(parseWarehouseQuery({}).sort).toBe('condition');
    expect(parseWarehouseQuery({ sort: 'quantity' }).sort).toBe('quantity');
    expect(parseWarehouseQuery({ sort: 'wat' }).sort).toBe('condition');
  });

  it('keeps a known category and drops an unknown one', () => {
    expect(parseWarehouseQuery({ cat: 'kitchen' }).category).toBe('kitchen');
    expect(parseWarehouseQuery({ cat: 'sound' }).category).toBeNull();
    expect(parseWarehouseQuery({}).category).toBeNull();
  });

  it('trims the search text', () => {
    expect(parseWarehouseQuery({ q: '  סיר  ' }).q).toBe('סיר');
    expect(parseWarehouseQuery({}).q).toBe('');
  });

  it('carries the drawer in the URL, so a refresh keeps it open', () => {
    expect(parseWarehouseQuery({ peek: 'abc' }).peek).toBe('abc');
    expect(parseWarehouseQuery({}).peek).toBeNull();
  });

  it('ignores any season param, because the warehouse is camp-wide', () => {
    // R5: camp-wide data says so on screen rather than silently ignoring the
    // global control. Parsing must not throw on it either way.
    const q = parseWarehouseQuery({ season: '11111111-2222-3333-4444-555555555555' });
    expect(q.view).toBe('all');
    expect(Object.keys(q)).not.toContain('season');
  });
});

describe('warehouse hrefs', () => {
  it('changes one param and leaves the rest alone', () => {
    const href = warehouseHref({ cat: 'kitchen', q: 'סיר' }, { sort: 'quantity' });
    expect(href.startsWith(WAREHOUSE_PATH)).toBe(true);
    expect(href).toContain('cat=kitchen');
    expect(href).toContain('sort=quantity');
    expect(href).toContain(encodeURIComponent('סיר'));
  });

  it('toggles a category chip off when it is already the active one', () => {
    // The chip is a filter, so clicking the active one clears it rather than
    // re-applying it and leaving no way back to everything.
    expect(categoryHref({ cat: 'kitchen' }, 'kitchen')).not.toContain('cat=');
    expect(categoryHref({ cat: 'kitchen' }, 'living')).toContain('cat=living');
  });

  it('drops an open drawer when the filter changes underneath it', () => {
    // The peeked row may not be in the new result set, and a drawer over a row
    // that is no longer listed is a dead end.
    expect(warehouseHref({ peek: 'abc' }, { cat: 'living' })).not.toContain('peek=');
  });
});

import { describe, it, expect } from 'vitest';
import {
  parseAcquisitionQuery, acquisitionsHref, acquisitionHref, arrivalHref,
  newAcquisitionHref, acquisitionSortHref,
  acquisitionsExportHref, ACQUISITIONS_PATH, NEW_ACQUISITION_ACT, ARRIVAL_ACT,
} from './acquisitions-views';

/**
 * The warehouse is camp-wide; this screen is not. What the camp still needs
 * is a fact about one year, so `season` is the one param that must survive
 * every link on the page (R5) — a filter, a sort, a drawer opening and a
 * drawer closing.
 */
describe('parsing the acquisitions URL', () => {
  it('defaults to everything, not to a status nobody chose', () => {
    const query = parseAcquisitionQuery({});
    expect(query.view).toBe('all');
    expect(query.category).toBeNull();
    expect(query.q).toBe('');
  });

  it('keeps the season it was given', () => {
    expect(parseAcquisitionQuery({ season: 'season-26' }).season).toBe('season-26');
  });

  it('reads a status tab', () => {
    expect(parseAcquisitionQuery({ view: 'ordered' }).view).toBe('ordered');
  });

  it('ignores a status that is not one of the four', () => {
    // These arrive from links people paste into chat, truncated and mangled.
    // The right answer is the default view, never an error page.
    expect(parseAcquisitionQuery({ view: 'lost' }).view).toBe('all');
  });

  it('trims the search, so a stray space is not a filter', () => {
    expect(parseAcquisitionQuery({ q: '  מקדחה ' }).q).toBe('מקדחה');
  });

  it('sorts by status first, because that is what the screen is for', () => {
    expect(parseAcquisitionQuery({}).sort).toBe('status');
  });
});

describe('the drawers, which are URLs', () => {
  it('opens one acquisition', () => {
    expect(acquisitionHref({ season: 's1' }, 'a1')).toContain('peek=a1');
    expect(acquisitionHref({ season: 's1' }, 'a1')).toContain('season=s1');
  });

  it('opens the arrival decision over the record it belongs to', () => {
    // Not a create drawer: the arrival is about a row that exists, so it
    // carries both the record and the verb.
    const href = arrivalHref({ season: 's1' }, 'a1');
    expect(href).toContain('peek=a1');
    expect(href).toContain(`act=${ARRIVAL_ACT}`);
  });

  it('opens the create drawer with no record', () => {
    const href = newAcquisitionHref({ season: 's1' });
    expect(href).toContain(`act=${NEW_ACQUISITION_ACT}`);
    expect(href).not.toContain('peek=');
  });

  it('tells the two apart rather than treating any act as a create', () => {
    expect(parseAcquisitionQuery({ act: NEW_ACQUISITION_ACT }).creating).toBe(true);
    expect(parseAcquisitionQuery({ act: ARRIVAL_ACT, peek: 'a1' }).arriving).toBe(true);
    expect(parseAcquisitionQuery({ act: ARRIVAL_ACT, peek: 'a1' }).creating).toBe(false);
  });

  it('refuses to call it an arrival when no record is named', () => {
    // `?act=arrival` with no `peek` names no row to receive. Opening the
    // drawer anyway would ask a lead where to store nothing in particular.
    expect(parseAcquisitionQuery({ act: ARRIVAL_ACT }).arriving).toBe(false);
  });

  it('closes both drawers when the filter changes underneath them', () => {
    const href = acquisitionsHref({ season: 's1', peek: 'a1', act: ARRIVAL_ACT }, { view: 'ordered' });
    expect(href).not.toContain('peek=');
    expect(href).not.toContain('act=');
    expect(href).toContain('season=s1');
  });
});

describe('every link carries the season', () => {
  it('keeps it through a filter', () => {
    expect(acquisitionsHref({ season: 's1' }, { view: 'ordered' })).toContain('season=s1');
  });

  it('keeps it through a sort', () => {
    expect(acquisitionSortHref({ season: 's1' }, 'name')).toContain('season=s1');
  });

  it('keeps it when a drawer closes', () => {
    expect(acquisitionsHref({ season: 's1', peek: 'a1' }, {})).toContain('season=s1');
  });

  it('reverses a sort that is already active', () => {
    expect(acquisitionSortHref({ sort: 'name', dir: 'asc' }, 'name')).toContain('dir=desc');
    expect(acquisitionSortHref({ sort: 'name', dir: 'desc' }, 'name')).toContain('dir=asc');
  });

  it('starts at the path when there is nothing to carry', () => {
    expect(acquisitionsHref({}, {})).toBe(ACQUISITIONS_PATH);
  });
});

describe('the export', () => {
  it('carries the season, so the file is one year and says which', () => {
    const href = acquisitionsExportHref({ season: 's1', view: 'ordered' });
    expect(href.startsWith(`${ACQUISITIONS_PATH}/export?`)).toBe(true);
    expect(href).toContain('season=s1');
    expect(href).toContain('view=ordered');
  });

  it('never carries an open drawer into a file', () => {
    expect(acquisitionsExportHref({ season: 's1', peek: 'a1' })).not.toContain('peek=');
  });
});

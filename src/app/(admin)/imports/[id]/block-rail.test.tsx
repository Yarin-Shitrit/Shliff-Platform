/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import type { BlockStateRow, SheetLabel } from '@/lib/import/register';

/** `./actions` is a `'use server'` module that imports `@/db` at load time. */
vi.mock('./actions', () => ({
  setSeasonAction: vi.fn(), setAuthorityAction: vi.fn(),
}));

import { BlockRail } from './block-rail';

const sheet: SheetLabel = {
  sheetId: 's1', name: 'סיכום כללי', index: 0, rowCount: 61, colCount: 8,
  seasonId: 'y26', seasonName: 'ברן 26', authoritative: null,
  state: 'eligible', contestedWith: [],
};

const block: BlockStateRow = {
  blockId: 'b1', sheetId: 's1', sheetName: 'סיכום כללי', uploadId: 'u1',
  archetype: 'ledger', confidence: 0.9,
  top: 3, left: 1, bottom: 61, right: 8, range: 'A3:H61', rowCount: 59,
  headerRow: 3, columnMap: [], mappingSource: 'rules', budgetCategory: null,
  confirmedBy: null, confirmedAt: null, promotedRows: 0,
  state: 'needs-review',
};

const seasons = [{ id: 'y26', name: 'ברן 26' }];

function renderRail(over: Partial<React.ComponentProps<typeof BlockRail>> = {}) {
  return render(
    <BlockRail
      uploadId="u1" sheets={[sheet]} blocks={[block]}
      openBlockId="b1" seasons={seasons} {...over}
    />,
  );
}

describe('BlockRail', () => {
  /**
   * R11: the A1 range is how a lead finds the table in Excel, and it is what
   * makes the column table's "unsure first" reordering safe. A17: `59 שורות`
   * is one phrase, so it is one isolate and the query reads one text node.
   */
  it('names the block by its archetype and shows its A1 range and row count', () => {
    renderRail();
    expect(screen.getByText('תנועות קופה')).toBeTruthy();
    expect(screen.getByText('A3:H61').tagName).toBe('BDI');
    expect(screen.getByText('59 שורות').tagName).toBe('BDI');
  });

  it('carries a word on every state pill, never colour alone', () => {
    renderRail();
    expect(screen.getByText('לבדיקה')).toBeTruthy();
  });

  it('marks the open block as the current page', () => {
    renderRail();
    const link = screen.getByRole('link', { current: 'page' });
    expect(link.getAttribute('href')).toBe('/imports/u1?block=b1');
  });

  /**
   * The season appears twice inside the group — once as the sheet's state on
   * a Pill, once as an option of the control that sets it — so this query is
   * pinned to the Pill's element. An unqualified `getByText` would match both
   * and throw, and a `getAllByText` would pass even with the Pill removed.
   */
  it('groups blocks under their sheet, with the season beside the name', () => {
    renderRail();
    const group = screen.getByRole('group', { name: 'סיכום כללי' });
    expect(within(group).getByText('ברן 26', { selector: 'span' })).toBeTruthy();
  });

  it('says a sheet has no season rather than leaving it blank', () => {
    renderRail({ sheets: [{ ...sheet, seasonId: null, seasonName: null }] });
    expect(screen.getByText('בלי שנה', { selector: 'span' })).toBeTruthy();
  });

  it('sends a block blocked by a sheet decision to לטיפול', () => {
    renderRail({
      sheets: [{ ...sheet, state: 'undecided', contestedWith: ['s2'] }],
      blocks: [{ ...block, state: 'blocked' }],
    });
    expect(screen.getByText('ממתין להחלטה')).toBeTruthy();
    expect(screen.getByRole('link', { name: /לטיפול/ }).getAttribute('href'))
      .toBe('/inbox');
  });

  it('shows how many rows a promoted block produced', () => {
    renderRail({ blocks: [{ ...block, state: 'promoted', promotedRows: 52 }] });
    expect(screen.getByText('קודם')).toBeTruthy();
    expect(screen.getByText('52 שורות נכתבו').tagName).toBe('BDI');
  });

  /** Nothing has been written until something has been written: a block that
   *  produced no rows says its size, and not a zero. */
  it('says nothing about written rows before any were written', () => {
    renderRail();
    expect(screen.queryByText(/נכתבו/)).toBeNull();
  });
});

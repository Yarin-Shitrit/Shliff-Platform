/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AUTHORITY_NEEDS_SEASON } from '@/lib/import/sheet-labels';
import type { SheetLabel } from '@/lib/import/register';

const setSeason = vi.fn();
const setAuthority = vi.fn();
/** `./actions` is a `'use server'` module that imports `@/db` at load time. */
vi.mock('./actions', () => ({
  setSeasonAction: (...args: unknown[]) => setSeason(...args),
  setAuthorityAction: (...args: unknown[]) => setAuthority(...args),
}));

import { SheetLabelControls } from './sheet-label-controls';

const sheet: SheetLabel = {
  sheetId: 's1', name: 'סיכום כללי', index: 0, rowCount: 61, colCount: 8,
  seasonId: 'y26', seasonName: 'ברן 26', authoritative: null,
  state: 'eligible', contestedWith: [],
};

const seasons = [{ id: 'y26', name: 'ברן 26' }, { id: 'y25', name: 'ברן 25' }];

function renderControls(over: Partial<SheetLabel> = {}) {
  return render(
    <SheetLabelControls sheet={{ ...sheet, ...over }} seasons={seasons} />,
  );
}

beforeEach(() => {
  setSeason.mockReset().mockResolvedValue({ ok: true });
  setAuthority.mockReset().mockResolvedValue({ ok: true });
});

describe('SheetLabelControls', () => {
  it('names the sheet in the season control, so one rail can hold several', () => {
    renderControls();
    const select = screen.getByLabelText('השנה של הגיליון סיכום כללי');
    expect((select as HTMLSelectElement).value).toBe('y26');
    expect(screen.getByRole('option', { name: 'ברן 25' })).toBeTruthy();
  });

  /** W10: a season is always set by hand. There is nothing here that could
   *  infer one, and the empty option is a real choice rather than a blank. */
  it('offers leaving the season unset as a named choice, not an empty row', () => {
    renderControls();
    expect(screen.getByRole('option', { name: 'בלי שנה' })).toBeTruthy();
  });

  it('sends the chosen season together with the sheet it belongs to', async () => {
    renderControls();
    fireEvent.change(screen.getByLabelText('השנה של הגיליון סיכום כללי'), {
      target: { value: 'y25' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'שמירה' }));

    await waitFor(() => expect(setSeason).toHaveBeenCalled());
    const form = setSeason.mock.calls[0][1] as FormData;
    expect(form.get('sheetId')).toBe('s1');
    expect(form.get('seasonId')).toBe('y25');
  });

  it('asks nothing about authority on a sheet nothing collides with', () => {
    renderControls();
    expect(screen.queryByRole('button', { name: 'זה העותק הקובע' })).toBeNull();
  });

  it('offers the authority decision on a contested sheet', () => {
    renderControls({ state: 'undecided', contestedWith: ['s2'] });
    expect(screen.getByRole('button', { name: 'זה העותק הקובע' })).toBeTruthy();
  });

  /**
   * The refusal is reachable from this very control: `conflicts()` treats a
   * season-less sheet as colliding with its namesake, so an unlabelled sheet
   * reads `undecided` and shows this button — and `setSheetAuthority` refuses
   * exactly that. Logging it and returning void would leave a lead pressing a
   * button that does nothing and says nothing.
   */
  it('leaves the promoter’s own Hebrew refusal on screen', async () => {
    setAuthority.mockResolvedValue({ ok: false, message: AUTHORITY_NEEDS_SEASON });
    renderControls({
      seasonId: null, seasonName: null, state: 'undecided', contestedWith: ['s2'],
    });
    fireEvent.click(screen.getByRole('button', { name: 'זה העותק הקובע' }));

    await waitFor(() => expect(screen.getByRole('alert').textContent)
      .toBe(AUTHORITY_NEEDS_SEASON));
  });

  it('says which copy was chosen, and lets the choice be undone', () => {
    renderControls({ authoritative: true, state: 'eligible' });
    expect(screen.getByText('עותק קובע')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'ביטול הסימון' })).toBeTruthy();
  });

  /**
   * Two chosen copies is `ambiguous`, and the only way out is to un-choose
   * one. Without this the group is a decision with no move that resolves it.
   */
  it('sends a false authority when the choice is undone', async () => {
    renderControls({
      authoritative: true, state: 'ambiguous', contestedWith: ['s2'],
    });
    fireEvent.click(screen.getByRole('button', { name: 'ביטול הסימון' }));

    await waitFor(() => expect(setAuthority).toHaveBeenCalled());
    const form = setAuthority.mock.calls[0][1] as FormData;
    expect(form.get('sheetId')).toBe('s1');
    expect(form.get('authoritative')).toBe('false');
  });
});

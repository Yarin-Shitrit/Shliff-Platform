/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const push = vi.fn();
const confirmAndPromote = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));
vi.mock('./actions', () => ({
  confirmAndPromoteAction: (...args: unknown[]) => confirmAndPromote(...args),
}));

import { PromoteBar } from './promote-bar';

const preflight = {
  blocks: 1, written: 52, noted: 2, refused: 7, deleted: 0, retained: 0,
};

function renderBar(over: Partial<React.ComponentProps<typeof PromoteBar>> = {}) {
  return render(
    <PromoteBar
      uploadId="u1" blockId="b1" archetype="ledger"
      preflight={preflight} draft={[{ column: 1, field: 'date', confidence: 1 }]}
      budgetCategory={null} dirty={false} nextBlockId="b3" {...over}
    />,
  );
}

beforeEach(() => {
  push.mockClear();
  confirmAndPromote.mockReset().mockResolvedValue({
    ok: true, summary: preflight, nextBlockId: 'b2',
  });
});

describe('PromoteBar', () => {
  it('carries its count on the button', () => {
    renderBar();
    expect(screen.getByRole('button', { name: 'אישור וקידום 52 שורות' })).toBeTruthy();
  });

  /** D10: all three, and the third is widened past names — a note can be a
   *  dateless debt or a flagged arithmetic line too. */
  it('states what is created, what is set aside, and what waits', () => {
    renderBar();
    expect(screen.getByText('ייכתבו 52 שורות')).toBeTruthy();
    expect(screen.getByText('7 יידחו עם סיבה')).toBeTruthy();
    expect(screen.getByText('2 ייכתבו עם הערה וימתינו לטיפול')).toBeTruthy();
  });

  /**
   * A stale count is worse than no count. Promising 52 rows while the lead has
   * just unmapped the amount column would be the screen lying about the only
   * number on it.
   */
  it('drops the count rather than promising a stale one', () => {
    renderBar({ dirty: true });
    expect(screen.getByRole('button', { name: 'אישור וקידום' })).toBeTruthy();
    expect(screen.queryByText(/52/)).toBeNull();
    expect(screen.getByText('הספירה תתעדכן אחרי השמירה')).toBeTruthy();
  });

  it('sends the draft map with the block’s unchanged archetype', async () => {
    renderBar();
    fireEvent.click(screen.getByRole('button', { name: /אישור וקידום/ }));
    await waitFor(() => expect(confirmAndPromote).toHaveBeenCalledWith(
      'b1', 'ledger', [{ column: 1, field: 'date', confidence: 1 }], null,
    ));
  });

  /**
   * A22/R26: every confirmation rewrites the mapping's category, so a promote
   * that did not carry the lead's choice would quietly reset a dancefloor
   * block to the camp's budget on the next press of this button.
   */
  it('carries the budget a lead chose, so confirming does not reset it', async () => {
    renderBar({ budgetCategory: 'dancefloor', archetype: 'budget_lines' });
    fireEvent.click(screen.getByRole('button', { name: /אישור וקידום/ }));
    await waitFor(() => expect(confirmAndPromote).toHaveBeenCalledWith(
      'b1', 'budget_lines', [{ column: 1, field: 'date', confidence: 1 }], 'dancefloor',
    ));
  });

  it('opens the next unreviewed block once the promotion lands', async () => {
    renderBar();
    fireEvent.click(screen.getByRole('button', { name: /אישור וקידום/ }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/imports/u1?block=b2'));
  });

  it('stays on the file when nothing is left to review', async () => {
    confirmAndPromote.mockResolvedValue({
      ok: true, summary: preflight, nextBlockId: null,
    });
    renderBar();
    fireEvent.click(screen.getByRole('button', { name: /אישור וקידום/ }));
    await waitFor(() => expect(screen.getByText('אין טבלאות שממתינות לבדיקה')).toBeTruthy());
    expect(push).not.toHaveBeenCalled();
    /* E2 still holds on the last block: finishing the file must not swallow
     * the report of what finishing it wrote. */
    expect(screen.getByRole('status').textContent).toContain('נכתבו 52 שורות');
  });

  it('reports what was written, so a write is never silent (E2)', async () => {
    renderBar();
    fireEvent.click(screen.getByRole('button', { name: /אישור וקידום/ }));
    await waitFor(() => expect(screen.getByRole('status').textContent)
      .toContain('נכתבו 52 שורות'));
  });

  it('shows a Hebrew failure and leaves the button usable', async () => {
    confirmAndPromote.mockResolvedValue({ ok: false, message: 'אין לך הרשאה לאשר טבלאות.' });
    renderBar();
    fireEvent.click(screen.getByRole('button', { name: /אישור וקידום/ }));
    await waitFor(() => expect(screen.getByRole('alert').textContent)
      .toBe('אין לך הרשאה לאשר טבלאות.'));
    /* The transition's own re-render lands after the alert's, so the button
     * still reads מקדם… for a tick. Asserting once, immediately, fails on
     * timing rather than on the thing this pins: that a refusal leaves the
     * button usable instead of stuck. */
    await waitFor(() => expect(screen.getByRole('button', { name: /אישור וקידום/ })
      .hasAttribute('disabled')).toBe(false));
  });

  /**
   * The plan's דילוג pointed at `?skip=1`, which nothing reads — a control
   * that looks like it moves a lead on and does not. It goes to the next block
   * still wanting a human, which is what skipping this one means.
   */
  it('offers to skip to the next table that wants a human, without writing', () => {
    renderBar();
    expect(screen.getByRole('link', { name: 'דילוג' }).getAttribute('href'))
      .toBe('/imports/u1?block=b3');
  });

  it('offers no skip when this is the last table still waiting', () => {
    renderBar({ nextBlockId: null });
    expect(screen.queryByRole('link', { name: 'דילוג' })).toBeNull();
  });
});

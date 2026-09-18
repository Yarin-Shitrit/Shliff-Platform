/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

const promoteUpload = vi.fn();
vi.mock('./actions', () => ({
  promoteUploadAction: (...args: unknown[]) => promoteUpload(...args),
}));

import { PromoteUploadButton } from './promote-upload-button';

const summary = { blocks: 3, written: 52, noted: 2, refused: 7, deleted: 0, retained: 0 };

function renderButton(confirmedCount = 3, alreadyPromoted = 0) {
  render(
    <PromoteUploadButton
      uploadId="u1" confirmedCount={confirmedCount} alreadyPromoted={alreadyPromoted}
    />,
  );
}

/** A25: the kit's ConfirmDialog is an `alertdialog`. Querying `dialog` would
 *  match something else entirely and pass against no confirmation at all. */
function dialog() {
  return screen.getByRole('alertdialog');
}

beforeEach(() => {
  promoteUpload.mockReset().mockResolvedValue({
    ok: true, summary, nextBlockId: null,
  });
});

describe('PromoteUploadButton', () => {
  it('names how many tables it is about to promote', () => {
    renderButton();
    expect(screen.getByRole('button', { name: 'קידום 3 טבלאות מאושרות' })).toBeTruthy();
  });

  it('writes nothing until the promotion is confirmed', () => {
    renderButton();
    fireEvent.click(screen.getByRole('button', { name: /קידום/ }));
    expect(dialog()).toBeTruthy();
    expect(promoteUpload).not.toHaveBeenCalled();
  });

  /**
   * A23. `promoteUpload` composes `promoteBlock` over one upload's blocks and
   * never reaches `promoteAll`. The dialog says which file, because the whole
   * safety of this control is that a lead consented to that file and not to
   * the database.
   */
  it('promotes one file, and says which one it is about to promote', async () => {
    renderButton();
    fireEvent.click(screen.getByRole('button', { name: /קידום/ }));
    expect(within(dialog()).getByText(/רק הטבלאות של הקובץ הזה/)).toBeTruthy();
    fireEvent.click(within(dialog()).getByRole('button', { name: 'קידום הטבלאות' }));
    await waitFor(() => expect(promoteUpload).toHaveBeenCalledWith('u1'));
  });

  it('reports what the promotion wrote, so a write is never silent (E2)', async () => {
    renderButton();
    fireEvent.click(screen.getByRole('button', { name: /קידום/ }));
    fireEvent.click(within(dialog()).getByRole('button', { name: 'קידום הטבלאות' }));
    await waitFor(() => expect(screen.getByRole('status').textContent)
      .toContain('נכתבו 52 שורות'));
  });

  it('leaves a refusal on screen in Hebrew', async () => {
    promoteUpload.mockResolvedValue({ ok: false, message: 'אין לך הרשאה לאשר טבלאות.' });
    renderButton();
    fireEvent.click(screen.getByRole('button', { name: /קידום/ }));
    fireEvent.click(within(dialog()).getByRole('button', { name: 'קידום הטבלאות' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent)
      .toBe('אין לך הרשאה לאשר טבלאות.'));
  });

  it('closes without writing when the lead backs out', () => {
    renderButton();
    fireEvent.click(screen.getByRole('button', { name: /קידום/ }));
    fireEvent.click(within(dialog()).getByRole('button', { name: 'חזרה' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(promoteUpload).not.toHaveBeenCalled();
  });

  /**
   * `promoteUpload` acts on every block in state `confirmed` OR `promoted` —
   * a re-run is how W4/W5 say a lead fixes a column map. So the count here has
   * to be of both, or the button names one table and rewrites four. Measured
   * on the real database: the first workbook is confirmed 1, promoted 3.
   */
  it('counts the tables it will actually touch, not only the unwritten ones', () => {
    renderButton(4, 3);
    expect(screen.getByRole('button', { name: 'קידום 4 טבלאות מאושרות' })).toBeTruthy();
  });

  /**
   * Re-writing rows that already exist is the hazard this whole screen is
   * careful about, so it is said out loud before anything is written rather
   * than left for a lead to infer from a count.
   */
  it('says out loud that already-promoted tables are written again', () => {
    renderButton(4, 3);
    fireEvent.click(screen.getByRole('button', { name: /קידום/ }));
    expect(within(dialog()).getByText(/3 מתוכן כבר קודמו/)).toBeTruthy();
  });

  it('says nothing about re-writing when nothing has been promoted yet', () => {
    renderButton(3, 0);
    fireEvent.click(screen.getByRole('button', { name: /קידום/ }));
    expect(within(dialog()).queryByText(/כבר קודמו/)).toBeNull();
  });
});

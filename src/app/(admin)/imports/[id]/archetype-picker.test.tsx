/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { HEBREW_FALLBACK } from '@/lib/errors/hebrew';

const refresh = vi.fn();
const confirmBlock = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));
vi.mock('./actions', () => ({
  confirmBlock: (...args: unknown[]) => confirmBlock(...args),
}));

import { ArchetypePicker } from './archetype-picker';

beforeEach(() => {
  refresh.mockClear();
  confirmBlock.mockReset().mockResolvedValue(undefined);
});

describe('ArchetypePicker', () => {
  it('offers every archetype by its Hebrew name', () => {
    render(<ArchetypePicker blockId="b1" archetype="ledger" confidence={0.9} />);
    expect(screen.getByRole('option', { name: 'תנועות קופה' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'שורות תקציב' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'יתרות בקופות' })).toBeTruthy();
  });

  /** R4/D10: a percentage invites a lead to reason about a weighted sum of
   *  lexicon hits as though it were a probability. It is not one. */
  it('shows the classifier’s confidence as a word, never as a percentage', () => {
    render(<ArchetypePicker blockId="b1" archetype="ledger" confidence={0.63} />);
    expect(screen.getByText('כנראה')).toBeTruthy();
    expect(screen.queryByText(/63/)).toBeNull();
    expect(screen.queryByText(/%/)).toBeNull();
  });

  it('warns that changing the type re-maps the columns', () => {
    render(<ArchetypePicker blockId="b1" archetype="ledger" confidence={1} />);
    expect(screen.getByText('שינוי הסוג מאשר אותו ומחשב מחדש את התאמת העמודות.'))
      .toBeTruthy();
  });

  /**
   * The empty map is not a guess that there are no columns. `applyConfirmation`
   * discards whatever map it is handed when the archetype changed and
   * recomputes it from the block's own grid, so sending the old archetype's
   * map would be sending something the server is required to throw away.
   */
  it('sends no column map on a type change, and re-reads afterwards', async () => {
    render(<ArchetypePicker blockId="b1" archetype="ledger" confidence={1} />);
    fireEvent.change(screen.getByLabelText('סוג הטבלה'), {
      target: { value: 'budget_lines' },
    });
    await waitFor(() => expect(confirmBlock).toHaveBeenCalledWith('b1', 'budget_lines', []));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it('does not re-confirm when the type that was picked is the one already set', () => {
    render(<ArchetypePicker blockId="b1" archetype="ledger" confidence={1} />);
    fireEvent.change(screen.getByLabelText('סוג הטבלה'), {
      target: { value: 'ledger' },
    });
    expect(confirmBlock).not.toHaveBeenCalled();
  });

  it('says so in Hebrew when the change fails, and keeps the old type on screen', async () => {
    confirmBlock.mockRejectedValue(new Error('unauthorized'));
    render(<ArchetypePicker blockId="b1" archetype="ledger" confidence={1} />);
    fireEvent.change(screen.getByLabelText('סוג הטבלה'), {
      target: { value: 'budget_lines' },
    });
    await waitFor(() => expect(screen.getByRole('alert').textContent)
      .toBe(HEBREW_FALLBACK));
    expect(screen.queryByText('unauthorized')).toBeNull();
    expect((screen.getByLabelText('סוג הטבלה') as HTMLSelectElement).value).toBe('ledger');
  });
});

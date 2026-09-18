/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BUDGET_CATEGORY_LABELS } from '@/lib/money/budget';
import { BudgetCategoryPicker } from './budget-category-picker';

const LABEL = 'התקציב שהשורות נכתבות אליו';

function renderPicker(
  value: 'camp' | 'dancefloor' | null,
  onChange = vi.fn(),
) {
  render(<BudgetCategoryPicker blockId="b1" value={value} onChange={onChange} />);
  return onChange;
}

describe('BudgetCategoryPicker', () => {
  /** The workbook's own two words, imported rather than re-spelled: a second
   *  vocabulary for the same split is how two screens start disagreeing. */
  it('names both budgets in the camp’s own words', () => {
    renderPicker('camp');
    expect(screen.getByRole('option', { name: BUDGET_CATEGORY_LABELS.camp })).toBeTruthy();
    expect(screen.getByRole('option', { name: BUDGET_CATEGORY_LABELS.dancefloor }))
      .toBeTruthy();
  });

  it('says a block nobody has decided is undecided, rather than showing a default as a choice', () => {
    renderPicker(null);
    expect((screen.getByLabelText(LABEL) as HTMLSelectElement).value).toBe('');
    expect(screen.getByRole('option', { name: 'לא נקבע' })).toBeTruthy();
  });

  /**
   * A22/R26. `applyConfirmation` stamps `camp` on every budget block confirmed
   * without a category, including `תקציב רחבה ברן 25`, which is the
   * dancefloor's — the dancefloor's spend then divides by the camp's headcount.
   * Nothing infers the category, so the default is stated on screen instead of
   * being made quietly.
   */
  it('says what happens without a decision, rather than deciding quietly', () => {
    renderPicker(null);
    expect(screen.getByText(
      'בלי בחירה השורות ייכתבו לתקציב הקאמפ. המערכת לא מסיקה את זה משם הגיליון.',
    )).toBeTruthy();
  });

  it('reports the decision a lead makes', () => {
    const onChange = renderPicker(null);
    fireEvent.change(screen.getByLabelText(LABEL), { target: { value: 'dancefloor' } });
    expect(onChange).toHaveBeenCalledWith('dancefloor');
  });

  /** There is no stored "undecided" once a block has been confirmed, so the
   *  screen does not offer a state a lead could not get back to. */
  it('stops offering undecided once a decision exists', () => {
    renderPicker('dancefloor');
    expect(screen.queryByRole('option', { name: 'לא נקבע' })).toBeNull();
    expect((screen.getByLabelText(LABEL) as HTMLSelectElement).value).toBe('dancefloor');
  });
});

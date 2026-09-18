'use client';

/**
 * Which budget a `budget_lines` block is — the camp's or the dancefloor's.
 *
 * This is the only place the decision can be made. Nothing infers it: not from
 * the sheet name, not from anything. `applyConfirmation` stamps `camp` on
 * every budget block confirmed without one, so `תקציב רחבה ברן 25` — the
 * dancefloor's budget, by its own name — lands in the camp's total and the
 * dancefloor's spend is divided by the camp's headcount. That is R26's
 * 158,507-against-59,587 defect, and until this control existed it was
 * unreachable only because no screen rendered a promote button.
 *
 * A default that nobody chose is still a guess, so the screen says what it
 * will do rather than doing it quietly. Controlled, like the column draft: one
 * button saves the whole confirmation, and the category rides with it.
 */
import type { BudgetCategory } from '@/db/schema/money';
import { BUDGET_CATEGORY_LABELS } from '@/lib/money/budget';
import styles from './import-review.module.css';

/** Fixed order, the same one the budget screen groups by. */
const CATEGORIES: readonly BudgetCategory[] = ['camp', 'dancefloor'];

export function BudgetCategoryPicker(
  { blockId, value, onChange }: {
    blockId: string;
    /** Null while no confirmation has stored one. */
    value: BudgetCategory | null;
    onChange: (next: BudgetCategory) => void;
  },
) {
  return (
    <div className={styles.picker}>
      <label className={styles.pickerLabel} htmlFor={`budget-category-${blockId}`}>
        התקציב שהשורות נכתבות אליו
      </label>
      <select
        id={`budget-category-${blockId}`}
        className={styles.pickerSelect}
        value={value ?? ''}
        onChange={(event) => onChange(event.target.value as BudgetCategory)}
      >
        {/* Offered only while it is true. There is no stored "undecided" to
            come back to once a confirmation has written one. */}
        {value === null ? <option value="">לא נקבע</option> : null}
        {CATEGORIES.map((category) => (
          <option key={category} value={category}>
            {BUDGET_CATEGORY_LABELS[category]}
          </option>
        ))}
      </select>
      <p className={styles.pickerHint}>
        בלי בחירה השורות ייכתבו לתקציב הקאמפ. המערכת לא מסיקה את זה משם הגיליון.
      </p>
    </div>
  );
}

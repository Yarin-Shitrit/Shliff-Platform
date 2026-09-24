/**
 * The sun card's segmented choices — the pace and the scope of playback, and
 * where the tent ranking stops counting.
 */

import type { ReactElement } from 'react';
import styles from './sun-card.module.css';

export interface ChoiceOption<T extends string> {
  value: T;
  label: string;
  disabled?: boolean;
}

/**
 * A segmented choice: radios, so the browser gives the arrow keys and the
 * checked state for free. Not the kit's `Segmented`, which can only disable
 * the whole group, and one option here is disabled on its own.
 */
export function Choice<T extends string>({ label, name, options, value, onChange }: {
  label: string;
  name: string;
  options: readonly ChoiceOption<T>[];
  value: T;
  onChange: (value: T) => void;
}): ReactElement {
  return (
    <span className={styles.choice} role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <label key={option.value} className={styles.option}>
          <input
            type="radio"
            className={styles.optionInput}
            name={name}
            value={option.value}
            checked={value === option.value}
            disabled={option.disabled}
            onChange={() => { onChange(option.value); }}
          />
          <span className={styles.optionFace}>{option.label}</span>
        </label>
      ))}
    </span>
  );
}

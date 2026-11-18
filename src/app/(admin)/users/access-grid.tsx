'use client';

/**
 * One row per page the registry names, three choices per row: בלי גישה,
 * צפייה בלבד, צפייה ועריכה. A radio group per row rather than a select,
 * so every choice is on screen at once and the whole grid can be read at a
 * glance; the three shortcuts above it set every row in one press, which
 * is how most accounts are actually made — "everything read-only, then
 * open two pages for editing".
 */
import { useId } from 'react';
import { Button } from '@/components/ui/button';
import {
  ACCESS_LABELS, PAGES, type AccessLevel, type AccessMap, type PageKey,
} from '@/lib/auth/pages';
import styles from './users.module.css';

type Choice = AccessLevel | 'none';

const CHOICES: readonly Choice[] = ['none', 'view', 'edit'];

export function AccessGrid({ value, onChange, disabled }: {
  value: AccessMap;
  onChange: (next: AccessMap) => void;
  disabled?: boolean;
}) {
  const baseId = useId();

  function set(page: PageKey, choice: Choice) {
    const next: AccessMap = { ...value };
    if (choice === 'none') delete next[page];
    else next[page] = choice;
    onChange(next);
  }

  function setAll(choice: Choice) {
    if (choice === 'none') { onChange({}); return; }
    const next: AccessMap = {};
    for (const page of PAGES) next[page.key] = choice;
    onChange(next);
  }

  const groups = [...new Set(PAGES.map((page) => page.group))];

  return (
    <div className={styles.grid}>
      <div className={styles.gridAll} role="group" aria-label="כל העמודים בבת אחת">
        <span className={styles.gridAllLabel}>כל העמודים:</span>
        {CHOICES.map((choice) => (
          <Button key={choice} size="sm" disabled={disabled} onClick={() => setAll(choice)}>
            {ACCESS_LABELS[choice]}
          </Button>
        ))}
      </div>

      {groups.map((group) => (
        <fieldset key={group} className={styles.gridGroup} disabled={disabled}>
          <legend className={styles.gridLegend}>{group}</legend>
          {PAGES.filter((page) => page.group === group).map((page) => {
            const current: Choice = value[page.key] ?? 'none';
            const name = `${baseId}-${page.key}`;
            return (
              <div key={page.key} className={styles.gridRow} role="radiogroup" aria-label={page.label}>
                <span className={styles.gridPage}>{page.label}</span>
                <span className={styles.gridChoices}>
                  {CHOICES.map((choice) => (
                    <label key={choice} className={styles.gridChoice} data-on={current === choice ? 'true' : undefined}>
                      <input
                        type="radio"
                        name={name}
                        value={choice}
                        checked={current === choice}
                        onChange={() => set(page.key, choice)}
                      />
                      <span>{ACCESS_LABELS[choice]}</span>
                    </label>
                  ))}
                </span>
              </div>
            );
          })}
        </fieldset>
      ))}
    </div>
  );
}

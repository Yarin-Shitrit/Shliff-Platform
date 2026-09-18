/**
 * No `'use client'`: the bar calls no hook and holds no state. Every action is
 * a callback into the selection state the list owns, so the bar is only ever
 * rendered from inside that list's client tree — the same arrangement as
 * `Table` with a `selection` prop (R7).
 */
import type { ReactElement } from 'react';
import { Icon, type IconName } from '@/components/ui/icon';
import { Button } from './button';
import { Popover } from './popover';
import styles from './bulk-bar.module.css';

export type BulkAction = {
  id: string;
  label: string;
  icon?: IconName;
  onSelect: () => void;
  disabled?: boolean;
};

export type BulkBarProps = {
  count: number;
  /** The region's accessible name, e.g. `פעולות על הנבחרים`. */
  label: string;
  actions: readonly BulkAction[];
  /** C8/R8: destructive actions, behind `עוד`. Never mixed into `actions`. */
  moreActions?: readonly BulkAction[];
  onClear: () => void;
};

/** K1 (task-14 ruling): the Hebrew agrees with the number. Exported so no
 *  screen writes `1 נבחרו` by hand. Digits are left unwrapped on purpose —
 *  the whole string is one Hebrew phrase whose only Latin-direction run is
 *  the number itself, and a bare digit run in an RTL paragraph already
 *  resolves correctly (A17 is about not splitting a phrase across more than
 *  one `<bdi>`, not about wrapping every digit). */
export function selectionLabel(count: number): string {
  return count === 1 ? 'נבחר אחד' : `${count} נבחרו`;
}

export function BulkBar({
  count, label, actions, moreActions, onClear,
}: BulkBarProps): ReactElement | null {
  // Ruling 1: at zero the component has nothing to say. No screen should
  // need to write `{count > 0 && <BulkBar .../>}` around this.
  if (count <= 0) return null;

  return (
    <div className={styles.bar} role="region" aria-label={label}>
      {/* Ruling 3: only the count is announced — announcing the whole
          region would re-read every action label on each selection change. */}
      <span className={styles.count} aria-live="polite">{selectionLabel(count)}</span>

      {actions.map((action) => (
        <Button key={action.id} size="sm" disabled={action.disabled} onClick={action.onSelect}>
          {action.icon === undefined ? null : <Icon name={action.icon} size={14} />}
          {action.label}
        </Button>
      ))}

      {moreActions === undefined || moreActions.length === 0 ? null : (
        // C8/R8: destructive actions live behind `עוד` and never on the bar
        // itself. This is `Popover` from Task 11, not a second popover.
        <Popover id="bulk-more" label="עוד" triggerTone="bulk" align="end">
          {moreActions.map((action) => (
            // A native `<button>` keeps its implicit `button` role — a
            // `role="menuitem"` override here would ask a screen reader for
            // a `menu` parent that does not exist, and would also stop
            // `getByRole('button', …)` from finding it. `popover.tsx`
            // already settled the same question for a panel of links: let
            // native semantics stand.
            <button
              key={action.id}
              type="button"
              className={styles.menuItem}
              disabled={action.disabled}
              onClick={action.onSelect}
            >
              {action.icon === undefined ? null : <Icon name={action.icon} size={14} />}
              {action.label}
            </button>
          ))}
        </Popover>
      )}

      {/* Ruling: "clear" must be unmistakable — its own icon-only button,
          never folded into `עוד`, so a selection someone forgot about is
          always one obvious click from gone. */}
      <Button size="sm" iconLabel="ביטול הבחירה" onClick={onClear}>
        <Icon name="x" size={14} />
      </Button>
    </div>
  );
}

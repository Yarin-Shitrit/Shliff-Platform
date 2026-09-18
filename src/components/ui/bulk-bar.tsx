'use client';
/**
 * Client component (R7): R8 requires every destructive bulk action to run
 * through a confirmation that names what will happen, and `BulkBar` — not
 * the calling screen — owns that obligation, so it must hold state (which
 * `moreActions` entry is pending confirmation) and render `ConfirmDialog`
 * itself. Non-destructive `actions` are still plain callbacks into the
 * list's own client tree, the same arrangement as `Table` with a `selection`
 * prop; only the destructive path needed a hook.
 */
import { useState, type ReactElement } from 'react';
import { Icon, type IconName } from '@/components/ui/icon';
import { Button } from './button';
import { ConfirmDialog } from './confirm-dialog';
import { Popover } from './popover';
import styles from './bulk-bar.module.css';

export type BulkAction = {
  id: string;
  label: string;
  icon?: IconName;
  onSelect: () => void;
  disabled?: boolean;
};

export type DestructiveBulkAction = {
  id: string;
  label: string;
  icon?: IconName;
  disabled?: boolean;
  /** R8: the confirmation, in Hebrew, naming what will happen to `count` rows.
   *  Required — there is no destructive bulk action without one. */
  confirm: {
    title: string;
    consequence: (count: number) => string;
    confirmLabel: string;
  };
  /** Runs only after the reader confirms. BulkBar owns the dialog. */
  onConfirmed: () => void;
};

export type BulkBarProps = {
  count: number;
  /** The region's accessible name, e.g. `פעולות על הנבחרים`. */
  label: string;
  actions: readonly BulkAction[];
  /** C8/R8: destructive actions, behind `עוד`. Never mixed into `actions`,
   *  and never fired without the confirmation named on `confirm` — `BulkBar`
   *  renders that `ConfirmDialog` itself, so no caller can wire past it. */
  moreActions?: readonly DestructiveBulkAction[];
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
}: BulkBarProps): ReactElement {
  const [pending, setPending] = useState<DestructiveBulkAction | null>(null);
  const selected = count > 0;

  return (
    <>
      <div
        className={selected ? styles.bar : 'sr-only'}
        role={selected ? 'region' : undefined}
        aria-label={selected ? label : undefined}
      >
        <span className={selected ? styles.count : undefined} aria-live="polite">
          {selected ? selectionLabel(count) : ''}
        </span>

        {selected ? (
          <>
            {actions.map((action) => (
              <Button key={action.id} size="sm" disabled={action.disabled} onClick={action.onSelect}>
                {action.icon === undefined ? null : <Icon name={action.icon} size={14} />}
                {action.label}
              </Button>
            ))}

            {moreActions === undefined || moreActions.length === 0 ? null : (
              <Popover id="bulk-more" label="עוד" triggerTone="bulk" align="end">
                {moreActions.map((action) => (
                  <button
                    key={action.id}
                    type="button"
                    className={styles.menuItem}
                    disabled={action.disabled}
                    onClick={() => { setPending(action); }}
                  >
                    {action.icon === undefined ? null : <Icon name={action.icon} size={14} />}
                    {action.label}
                  </button>
                ))}
              </Popover>
            )}

            <Button size="sm" iconLabel="ביטול הבחירה" onClick={onClear}>
              <Icon name="x" size={14} />
            </Button>
          </>
        ) : null}
      </div>

      {/* Rendered as a sibling of `.bar`, never a child: `.bar` sits at
          `--z-bulk` (15) and establishes its own stacking context, so a
          `ConfirmDialog` at `--z-dialog` (60) nested inside it would still
          paint below anything above 15 (a drawer, a toast). A fragment lets
          the dialog escape that context and stack on its own terms. */}
      {pending === null ? null : (
        <ConfirmDialog
          title={pending.confirm.title}
          consequence={pending.confirm.consequence(count)}
          confirmLabel={pending.confirm.confirmLabel}
          onCancel={() => { setPending(null); }}
          onConfirm={() => {
            const action = pending;
            setPending(null);
            action.onConfirmed();
          }}
        />
      )}
    </>
  );
}

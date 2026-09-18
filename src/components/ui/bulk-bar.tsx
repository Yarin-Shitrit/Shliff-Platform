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
import { Button, ButtonLink } from './button';
import { ConfirmDialog } from './confirm-dialog';
import { Popover } from './popover';
import styles from './bulk-bar.module.css';

type BulkActionShared = {
  id: string;
  label: string;
  icon?: IconName;
  disabled?: boolean;
};

/**
 * Exactly one of `onSelect` and `href` is given, and the union — rather than
 * two optional props — is what says so to the compiler: `onSelect` stays
 * *required* for every caller that does not opt into the link, so nothing
 * written before `href` existed changes meaning.
 *
 * An action that only navigates was a button that navigated. Merge pushed
 * through the router; export reached for `window.location.assign` and an
 * eslint disable, because the client router would have fetched the CSV as an
 * RSC payload and left nothing in the downloads folder. The disable was the
 * tell: a link had been written as a button. It also cost the reader
 * everything an anchor gives for free — a visible destination, middle-click,
 * open-in-new-tab, copy-link.
 *
 * `href` is a variant of the *non-destructive* list alone. **R8 is untouched
 * and this is not a way around it**: a link cannot carry a confirmation, so a
 * destructive action stays a `DestructiveBulkAction` behind `עוד`, where
 * `BulkBar` owns the dialog and no caller can wire past it.
 */
export type BulkAction = BulkActionShared & (
  | { onSelect: () => void; href?: undefined; download?: undefined }
  /** `download` when the destination is a file rather than a page. */
  | { href: string; download?: boolean; onSelect?: undefined }
);

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
            {actions.map((action) => {
              const face = (
                <>
                  {action.icon === undefined ? null : <Icon name={action.icon} size={14} />}
                  {action.label}
                </>
              );
              /* Disabled wins over the link: an anchor cannot be disabled, and
                 the alternative — withholding the control — teaches nothing
                 about why it is unavailable. `Drawer`'s stepper already turns
                 an unavailable link into a disabled button for the same
                 reason. Merge is exactly this case: a link once two rows are
                 selected, and visibly unavailable until then. */
              return action.href === undefined || action.disabled === true ? (
                <Button key={action.id} size="sm" disabled={action.disabled} onClick={action.onSelect}>
                  {face}
                </Button>
              ) : (
                <ButtonLink key={action.id} size="sm" href={action.href} download={action.download}>
                  {face}
                </ButtonLink>
              );
            })}

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

'use client';
/**
 * Client component: it opens with focus on cancel and holds a verb disabled
 * behind an acknowledgement, which is DOM lifecycle. Trapping Tab, closing on
 * `esc` without disturbing an enclosing Drawer, and restoring the opener are
 * the shared `useFocusTrap` (also used by `Drawer`).
 */
import { useId, useRef, type ReactElement, type ReactNode } from 'react';
import { Button } from './button';
import { Checkbox } from './field';
import { cx } from './cx';
import { useFocusTrap } from './use-focus-trap';
import styles from './confirm-dialog.module.css';

export type ConfirmDialogProps = {
  /** `מחיקת תשלום` */
  title: string;
  /** One sentence naming the record and the consequence. */
  consequence: ReactNode;
  /** The verb itself — `מחיקת התשלום`, `ביטול המשימה`, `הסרת השיוך`. Never `אישור`. */
  confirmLabel: string;
  cancelLabel?: string;
  tone?: 'danger' | 'default';
  onCancel: () => void;
  /** A bound Server Action. Exactly one of `action` and `onConfirm` is given. */
  action?: (formData: FormData) => void | Promise<void>;
  onConfirm?: () => void;
  /** Merge's preview of what moves, and anything else that must be read first. */
  children?: ReactNode;
  /** R8's acknowledgement checkbox, for the irreversible cases. */
  acknowledge?: { id: string; label: string; checked: boolean; onChange: (checked: boolean) => void };
};

/** R8: the confirmation names what will happen. These name nothing. */
const EMPTY_VERBS = new Set(['אישור', 'אוקיי', 'אוקי', 'כן', 'המשך', 'ביצוע']);

export function ConfirmDialog({
  title, consequence, confirmLabel, cancelLabel = 'ביטול', tone = 'danger',
  onCancel, action, onConfirm, children, acknowledge,
}: ConfirmDialogProps): ReactElement {
  if (process.env.NODE_ENV !== 'production' && EMPTY_VERBS.has(confirmLabel.trim())) {
    throw new Error(`ConfirmDialog: כפתור האישור חייב לשאת את הפועל עצמו, לא ״${confirmLabel}״`);
  }

  const titleId = useId();
  const bodyId = useId();
  /** A wrapper, because `Button` does not forward a ref and does not need to. */
  const cancelRef = useRef<HTMLDivElement | null>(null);
  const { rootRef, onKeyDown } = useFocusTrap<HTMLDivElement>({
    onEscape: onCancel,
    getInitialFocus: () => cancelRef.current?.querySelector('button') ?? null,
  });

  const blocked = acknowledge !== undefined && !acknowledge.checked;

  const confirmButton = (
    <Button
      tone={tone === 'danger' ? 'primary' : 'default'}
      type={action === undefined ? 'button' : 'submit'}
      disabled={blocked}
      onClick={action === undefined ? onConfirm : undefined}
    >
      {confirmLabel}
    </Button>
  );

  return (
    <>
      <div className={styles.scrim} aria-hidden="true" onClick={onCancel} />
      <div
        className={styles.dialog}
        ref={rootRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        onKeyDown={onKeyDown}
      >
        <h2 className={styles.title} id={titleId}>{title}</h2>
        <p className={cx(styles.consequence, tone === 'danger' && styles.danger)} id={bodyId}>
          {consequence}
        </p>
        {children === undefined ? null : <div className={styles.preview}>{children}</div>}
        {acknowledge === undefined ? null : (
          <Checkbox
            id={acknowledge.id}
            label={acknowledge.label}
            checked={acknowledge.checked}
            onChange={acknowledge.onChange}
          />
        )}
        <div className={styles.actions}>
          <div ref={cancelRef}>
            <Button tone="ghost" onClick={onCancel}>{cancelLabel}</Button>
          </div>
          {action === undefined
            ? confirmButton
            : <form action={action}>{confirmButton}</form>}
        </div>
      </div>
    </>
  );
}

'use client';
/**
 * Client component: it opens with focus on cancel and holds a verb disabled
 * behind an acknowledgement, which is DOM lifecycle. Trapping Tab, closing on
 * `esc` without disturbing an enclosing Drawer, restoring the opener, and
 * hiding everything else — including a Drawer it was raised over — from the
 * accessibility tree while it is open are the shared `useFocusTrap` (also
 * used by `Drawer`); `scrimRef` is what keeps this dialog's own scrim (a
 * click-to-cancel target) out of what gets marked `inert`.
 */
import { useId, useRef, type ReactElement, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Button, ButtonLink } from './button';
import { Checkbox } from './field';
import { cx } from './cx';
import { useFocusTrap } from './use-focus-trap';
import styles from './confirm-dialog.module.css';

type ConfirmDialogShared = {
  /** `מחיקת תשלום` */
  title: string;
  /** One sentence naming the record and the consequence. */
  consequence: ReactNode;
  /** The verb itself — `מחיקת התשלום`, `ביטול המשימה`, `הסרת השיוך`. Never `אישור`. */
  confirmLabel: string;
  cancelLabel?: string;
  tone?: 'danger' | 'default';
  /** A bound Server Action. Exactly one of `action` and `onConfirm` is given. */
  action?: (formData: FormData) => void | Promise<void>;
  onConfirm?: () => void;
  /** Merge's preview of what moves, and anything else that must be read first. */
  children?: ReactNode;
  /** R8's acknowledgement checkbox, for the irreversible cases. */
  acknowledge?: { id: string; label: string; checked: boolean; onChange: (checked: boolean) => void };
};

/**
 * Exactly one of `onCancel` and `cancelHref` is given, and the union — rather
 * than two optional props — is what says so to the compiler: `onCancel` stays
 * *required* for every caller that does not opt into the link, so nothing
 * written before `cancelHref` existed changes meaning.
 *
 * `cancelHref` makes the dialog URL-driven: esc, the scrim and the cancel
 * control all go to that href, so a **Server Component** can raise the dialog
 * with a bound Server Action on `action` and pass no function props at all.
 * That is what lets a URL-driven confirmation (`?unlink=<id>`) exist on a
 * screen whose client-component budget is already spent (plan 06, R7).
 */
export type ConfirmDialogProps = ConfirmDialogShared & (
  | { onCancel: () => void; cancelHref?: undefined }
  | { cancelHref: string; onCancel?: undefined }
);

/** R8: the confirmation names what will happen. These name nothing. */
const EMPTY_VERBS = new Set(['אישור', 'אוקיי', 'אוקי', 'כן', 'המשך', 'ביצוע']);

/**
 * `useRouter` is called here and never in `ConfirmDialog` itself: the
 * closure-driven dialog (`BulkBar`'s, and every screen that had one before
 * `cancelHref` existed) must keep rendering in a tree with no router at all,
 * which an unconditional hook would end. The branch is on a prop a call site
 * fixes once, so no instance ever swaps between the two.
 */
function UrlCancelConfirmDialog(
  props: ConfirmDialogProps & { cancelHref: string },
): ReactElement {
  const router = useRouter();
  const { cancelHref } = props;
  return <ConfirmDialogPanel {...props} cancel={() => { router.replace(cancelHref); }} />;
}

export function ConfirmDialog(props: ConfirmDialogProps): ReactElement {
  return props.cancelHref === undefined
    ? <ConfirmDialogPanel {...props} cancel={props.onCancel} />
    : <UrlCancelConfirmDialog {...props} cancelHref={props.cancelHref} />;
}

function ConfirmDialogPanel({
  title, consequence, confirmLabel, cancelLabel = 'ביטול', tone = 'danger',
  cancelHref, cancel, action, onConfirm, children, acknowledge,
}: ConfirmDialogProps & { cancel: () => void }): ReactElement {
  if (process.env.NODE_ENV !== 'production' && EMPTY_VERBS.has(confirmLabel.trim())) {
    throw new Error(`ConfirmDialog: כפתור האישור חייב לשאת את הפועל עצמו, לא ״${confirmLabel}״`);
  }

  const titleId = useId();
  const bodyId = useId();
  /** A wrapper, because `Button` does not forward a ref and does not need to. */
  const cancelRef = useRef<HTMLDivElement | null>(null);
  const { rootRef, scrimRef, onKeyDown } = useFocusTrap<HTMLDivElement>({
    onEscape: cancel,
    // `a` as well as `button`: with `cancelHref` the cancel control is a link,
    // and the dialog must still open with focus on it rather than on the verb.
    getInitialFocus: () => cancelRef.current?.querySelector<HTMLElement>('button, a') ?? null,
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
      <div className={styles.scrim} ref={scrimRef} aria-hidden="true" onClick={cancel} />
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
            {cancelHref === undefined
              ? <Button tone="ghost" onClick={cancel}>{cancelLabel}</Button>
              : <ButtonLink tone="ghost" href={cancelHref} replace>{cancelLabel}</ButtonLink>}
          </div>
          {action === undefined
            ? confirmButton
            : <form action={action}>{confirmButton}</form>}
        </div>
      </div>
    </>
  );
}

'use client';
/**
 * Client component: it opens with focus on the title and hands the rest of
 * its DOM lifecycle — trapping Tab, closing on `esc`, restoring the opener,
 * and hiding everything else from the accessibility tree while it is open —
 * to the shared `useFocusTrap` (also used by `ConfirmDialog`). `aria-modal`
 * is a promise to a screen reader in browse mode, not just to Tab, so the
 * hook also marks the rest of the page `inert`; handing the panel *and* the
 * scrim (via `scrimRef`) is what keeps the scrim's own click-to-dismiss
 * reachable while that happens.
 *
 * Everything the drawer *shows* is still server-rendered: the page reads
 * `?peek=` in its Server Component, loads the record, and passes it as
 * `children`. This file holds behaviour, never data.
 */
import { useId, useRef, type ReactElement, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Icon } from '@/components/ui/icon';
import { Button, ButtonLink } from './button';
import { cx } from './cx';
import { useFocusTrap } from './use-focus-trap';
import styles from './drawer.module.css';

export type DrawerStepper = {
  /** 1-based, for `1 מתוך 9`. */
  position: number;
  total: number;
  /** `null` at the ends: the button renders disabled, never absent. */
  previousHref: string | null;
  nextHref: string | null;
};

export type DrawerProps = {
  title: string;
  subtitle?: ReactNode;
  /** Rendered before the title — an `Avatar` on a person drawer. */
  lead?: ReactNode;
  stepper?: DrawerStepper;
  /** The record's full-page home, when it has one. */
  expandHref?: string;
  /** Where the close button and `esc` both go. Built with `closePeekHref`. */
  closeHref: string;
  /** 460 by default; 500 for a drawer that holds a grid. */
  width?: 460 | 500;
  /**
   * How it lands below 767.98px. `'sheet'` rises from the block-end edge and
   * stops at 92svh, leaving the page it came from visible above it — right for
   * a record a lead is glancing at. `'full'` takes the whole screen, for a
   * form with its own header and a sticky footer (D11's payment flow), where
   * the page behind is a distraction and the confirm button must be pinned.
   * Default `'sheet'`.
   */
  phone?: 'sheet' | 'full';
  footer?: ReactNode;
  children: ReactNode;
};

export function Drawer({
  title, subtitle, lead, stepper, expandHref, closeHref, width = 460,
  phone = 'sheet', footer, children,
}: DrawerProps): ReactElement {
  const router = useRouter();
  const titleId = useId();
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const { rootRef: panelRef, scrimRef, onKeyDown } = useFocusTrap<HTMLElement>({
    onEscape: () => router.replace(closeHref),
    getInitialFocus: () => headingRef.current,
    getExtraStart: () => headingRef.current,
  });

  return (
    <>
      <div
        className={styles.scrim}
        ref={scrimRef}
        aria-hidden="true"
        onClick={() => { router.replace(closeHref); }}
      />
      <aside
        className={cx(styles.drawer, width === 500 && styles.wide)}
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-phone={phone}
        onKeyDown={onKeyDown}
      >
        <header className={styles.head}>
          {lead}
          <div className={styles.titles}>
            <h2 className={styles.title} id={titleId} ref={headingRef} tabIndex={-1}>{title}</h2>
            {subtitle === undefined ? null : <span className={styles.subtitle}>{subtitle}</span>}
          </div>

          <div className={styles.headActions}>
            {stepper === undefined ? null : (
              <>
                <span className={styles.position}>
                  <bdi>{stepper.position} מתוך {stepper.total}</bdi>
                </span>
                {stepper.previousHref === null
                  ? <Button tone="ghost" size="sm" iconLabel="הקודם" disabled><Icon name="up" size={15} /></Button>
                  : <ButtonLink tone="ghost" size="sm" iconLabel="הקודם" href={stepper.previousHref}><Icon name="up" size={15} /></ButtonLink>}
                {stepper.nextHref === null
                  ? <Button tone="ghost" size="sm" iconLabel="הבא" disabled><Icon name="down" size={15} /></Button>
                  : <ButtonLink tone="ghost" size="sm" iconLabel="הבא" href={stepper.nextHref}><Icon name="down" size={15} /></ButtonLink>}
              </>
            )}
            {expandHref === undefined ? null : (
              <ButtonLink tone="ghost" size="sm" iconLabel="פתיחה בעמוד מלא" href={expandHref}>
                <Icon name="expand" size={15} />
              </ButtonLink>
            )}
            <ButtonLink tone="ghost" size="sm" iconLabel="סגירה" href={closeHref} replace>
              <Icon name="x" size={15} />
            </ButtonLink>
          </div>
        </header>

        <div className={styles.body}>{children}</div>

        {footer === undefined ? null : <footer className={styles.foot}>{footer}</footer>}
      </aside>
    </>
  );
}

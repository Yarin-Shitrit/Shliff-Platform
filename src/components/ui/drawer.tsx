'use client';
/**
 * Client component: trapping Tab inside the panel, closing on `esc`, and
 * giving focus back to whatever opened it are all DOM lifecycle. R1 rules out
 * the headless-UI dependency that would supply them, so this is hand-written
 * and the test above is what keeps it honest.
 *
 * Everything the drawer *shows* is still server-rendered: the page reads
 * `?peek=` in its Server Component, loads the record, and passes it as
 * `children`. This file holds behaviour, never data.
 */
import { useEffect, useId, useRef, type KeyboardEvent, type ReactElement, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Icon } from '@/components/ui/icon';
import { Button, ButtonLink } from './button';
import { cx } from './cx';
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
  footer?: ReactNode;
  children: ReactNode;
};

const TABBABLE = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled])',
  'select:not([disabled])', 'textarea:not([disabled])', '[tabindex]:not([tabindex="-1"])',
].join(', ');

function tabbableIn(root: HTMLElement | null): HTMLElement[] {
  if (root === null) return [];
  return [...root.querySelectorAll<HTMLElement>(TABBABLE)]
    .filter((element) => element.closest('[hidden]') === null);
}

export function Drawer({
  title, subtitle, lead, stepper, expandHref, closeHref, width = 460, footer, children,
}: DrawerProps): ReactElement {
  const router = useRouter();
  const titleId = useId();
  const panelRef = useRef<HTMLElement | null>(null);
  const openerRef = useRef<Element | null>(null);
  const headingRef = useRef<HTMLHeadingElement | null>(null);

  useEffect(() => {
    openerRef.current = document.activeElement;
    headingRef.current?.focus();
    return () => {
      const opener = openerRef.current;
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
      else document.body.focus();
    };
  }, []);

  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === 'Escape') {
      // Only the innermost overlay closes: a ConfirmDialog or a Popover over
      // this drawer stops the event before it reaches here.
      event.stopPropagation();
      event.preventDefault();
      router.replace(closeHref);
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = tabbableIn(panelRef.current);
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === headingRef.current)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <>
      <div
        className={styles.scrim}
        aria-hidden="true"
        onClick={() => { router.replace(closeHref); }}
      />
      <aside
        className={cx(styles.drawer, width === 500 && styles.wide)}
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
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

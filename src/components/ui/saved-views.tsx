/**
 * C2: a tab strip of named views, each one a URL. Every view is a link,
 * never a button — R6's reasoning about drawers applies to lists too, and a
 * view a lead can send to someone else is worth more than a tab that only
 * exists in one browser tab. `role="tablist"` of `role="tab"` anchors, with
 * `aria-selected` on the current one, is exactly what the mock draws.
 *
 * The count and the view's own contents must come from one source on the
 * screen that renders this — this component only ever displays the count it
 * is given; it never derives or re-counts anything itself.
 *
 * A count of `0` is shown: `טרם שילמו 0` is the best news on the page, unlike
 * the sidebar's "a permanent zero is noise" rule.
 *
 * Server component: every view is a plain link, so there is nothing here
 * that needs `'use client'` (R7).
 */
import type { ReactElement } from 'react';
import Link from 'next/link';
import { Icon } from '@/components/ui/icon';
import { cx } from './cx';
import styles from './saved-views.module.css';

export type SavedView = {
  id: string;
  label: string;
  /** Rendered in a `<bdi>`. `undefined` means the screen cannot count it cheaply. */
  count?: number;
  href: string;
};

export type SavedViewsProps = {
  /** The strip's accessible name, e.g. `תצוגות שמורות`. */
  label: string;
  views: readonly SavedView[];
  currentId: string;
  /** The `+`. Omitted while a screen has no way to save one. */
  newHref?: string;
  newLabel?: string;
};

export function SavedViews({
  label, views, currentId, newHref, newLabel = 'תצוגה שמורה חדשה',
}: SavedViewsProps): ReactElement {
  return (
    <div className={styles.strip} role="tablist" aria-label={label}>
      {views.map((view) => {
        const current = view.id === currentId;
        return (
          <Link
            key={view.id}
            className={cx(styles.tab, current && styles.current)}
            href={view.href}
            role="tab"
            aria-selected={current}
          >
            {view.label}
            {view.count === undefined ? null : (
              <span className={styles.count}><bdi>{view.count}</bdi></span>
            )}
          </Link>
        );
      })}
      {newHref === undefined ? null : (
        <Link className={styles.add} href={newHref} aria-label={newLabel}>
          <Icon name="plus" size={14} />
        </Link>
      )}
    </div>
  );
}

import { Fragment, type ReactNode } from 'react';
import Link from 'next/link';
import { Icon, type IconName } from '@/components/ui/icon';
import styles from './top-bar.module.css';

export interface Crumb {
  label: string;
  /** Omitted on the last crumb, which is where you already are. */
  href?: string;
}

/**
 * The 52px bar at the head of the main panel (B6): breadcrumbs, the page's
 * scope chip, and its global actions.
 *
 * Rendered by the page rather than the layout (Ruling S1): every artboard in
 * the mock carries different crumbs, a different chip — or none, on a
 * person's page — and different actions. A layout can know none of it. See
 * `docs/superpowers/mock/main.html`, `people.html` and `person.html`'s
 * `<header class="topbar">` for the three shapes this takes.
 */
export function TopBar({
  crumbs, chip, actions,
}: {
  crumbs: Crumb[];
  chip?: ReactNode;
  actions?: ReactNode;
}) {
  const last = crumbs.length - 1;

  return (
    <header className={styles.topbar}>
      <nav className={styles.crumbs} aria-label="מיקום">
        {crumbs.map((crumb, index) => (
          <Fragment key={crumb.label}>
            {index > 0 && <Icon name="left" size={14} />}
            {crumb.href && index !== last ? (
              <Link href={crumb.href}>{crumb.label}</Link>
            ) : (
              <span className={styles.here} aria-current="page">{crumb.label}</span>
            )}
          </Fragment>
        ))}
      </nav>
      {chip}
      <span className={styles.spacer} />
      {actions}
    </header>
  );
}

/**
 * What season the figures below belong to (B6, R5). The page resolves the
 * season with `resolveSeason` and hands this only the name it picked — this
 * component holds no data access of its own.
 */
export function SeasonChip({ seasonName }: { seasonName: string }) {
  return (
    <span className={styles.scopechip}>
      <Icon name="calendar" size={14} />
      <span>{seasonName}</span>
    </span>
  );
}

/**
 * The same chip for a scope that is not a season — coverage on `/tasks`, the
 * gate countdown on `/`. Camp-wide screens say so here instead of pretending
 * to belong to a season (R5).
 */
export function ScopeChip({
  icon, children,
}: {
  icon: IconName;
  children: ReactNode;
}) {
  return (
    <span className={styles.scopechip}>
      <Icon name={icon} size={14} />
      <span>{children}</span>
    </span>
  );
}

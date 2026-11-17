'use client';

/**
 * Client component for two reasons, both of them things the server cannot
 * answer from inside a layout: which path the reader is on after a soft
 * navigation, and which season `?season=` names (Ruling S2). Everything
 * else about the rail is static.
 */
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { Icon } from '@/components/ui/icon';
import { NAV_GROUPS, activeItemId, type NavItem } from './nav-data';
import { carrySeason } from './season-href';
import { useShellCounts } from './shell-counts';
import { useAccess } from './access-context';
import styles from './sidebar.module.css';

export function NavList() {
  const pathname = usePathname();
  const active = activeItemId(pathname);
  // The year is changed in the switcher and nowhere else: a rail link keeps it.
  const season = useSearchParams().get('season');
  // counts.ts's own docblock: "a count in the chrome that disagrees with the
  // page it links to is worse than no count." B7's tab bar now carries the
  // same figures, so the fetch and its `season`/`pathname` dependencies moved
  // into `shell-counts.tsx` and both surfaces read one value.
  const counts = useShellCounts();
  // A link the account cannot open is not offered: the page would refuse it,
  // and a rail full of refusals teaches a reader to stop trusting the rail.
  // Display only — every page still calls `requireAdmin` on its own.
  const { visible } = useAccess();

  function badge(item: NavItem) {
    const value = item.count ? counts[item.count] : 0;
    // B2: a count that reads zero is not shown at all. Zero members is not a
    // number anybody needs on the rail; it is the absence of a number.
    if (value <= 0) return null;
    return (
      <span className={item.hot ? `${styles.count} ${styles.hot}` : styles.count}>
        <bdi>{value}</bdi>
      </span>
    );
  }

  function body(item: NavItem) {
    return (
      <>
        <Icon name={item.icon} size={16} />
        <span className={styles.navlabel_text}>{item.label}</span>
        {badge(item)}
      </>
    );
  }

  return (
    <div className={styles.navstack}>
      {NAV_GROUPS.map((group) => ({ ...group, items: group.items.filter(visible) }))
        .filter((group) => group.items.length > 0)
        .map((group, index) => (
        <nav
          key={group.label ?? 'primary'}
          className={styles.navgroup}
          aria-label={group.label ?? 'ראשי'}
        >
          {group.label && <div className={styles.grouplabel}>{group.label}</div>}
          {group.items.map((item) => (item.planned ? (
            <span
              key={item.id}
              className={styles.planned}
              aria-disabled="true"
              data-active={item.id === active ? 'true' : undefined}
            >
              {body(item)}
              <span className={styles.soon}>בקרוב</span>
            </span>
          ) : (
            <Link
              key={item.id}
              href={carrySeason(item.href, season)}
              className={styles.navitem}
              aria-current={item.id === active ? 'page' : undefined}
            >
              {body(item)}
            </Link>
          )))}
          {index === 0 && <span className={styles.groupgap} />}
        </nav>
        ))}
    </div>
  );
}

'use client';

/**
 * Client component for two reasons, both of them things the server cannot
 * answer from inside a layout: which path the reader is on after a soft
 * navigation, and which season `?season=` names (Ruling S2). Everything
 * else about the rail is static.
 */
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Icon } from '@/components/ui/icon';
import { NAV_GROUPS, activeItemId, type NavItem } from './nav-data';
import { useShellCounts } from './shell-counts';
import styles from './sidebar.module.css';

export function NavList() {
  const pathname = usePathname();
  const active = activeItemId(pathname);
  // counts.ts's own docblock: "a count in the chrome that disagrees with the
  // page it links to is worse than no count." B7's tab bar now carries the
  // same figures, so the fetch and its `season`/`pathname` dependencies moved
  // into `shell-counts.tsx` and both surfaces read one value.
  const counts = useShellCounts();

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
      {NAV_GROUPS.map((group, index) => (
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
              href={item.href}
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

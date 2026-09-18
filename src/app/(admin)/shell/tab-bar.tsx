'use client';

/**
 * Client component: it marks the current tab from the browser's path, it
 * carries B2's live counts, and it opens the עוד sheet — none of which the
 * server can answer from inside a layout.
 *
 * B7, shown only below 767.98px (integration Ruling I5). Plan 12 owns the
 * finished five-item phone behaviour, which is this file's three additions
 * over plan 02's build: the count rides in the tab's accessible name, the עוד
 * sheet is a real modal, and the safe-area inset is in the stylesheet.
 *
 * The sheet uses the kit's `useFocusTrap` rather than a hand-written trap.
 * A19's lesson is the reason: a correct duplicate is how this kind of rule
 * erodes, and this would have been the third copy of `esc` + restore + Tab
 * wrapping after `Drawer` and `ConfirmDialog` had already collapsed into one.
 */
import { useRef, useState } from 'react';
import Link from 'next/link';
import { Icon } from '@/components/ui/icon';
import { useFocusTrap } from '@/components/ui/use-focus-trap';
import { usePathname } from 'next/navigation';
import { NAV_GROUPS, NAV_ITEMS, activeItemId, type NavItem } from './nav-data';
import { useShellCounts } from './shell-counts';
import styles from './tab-bar.module.css';

/** B7's five, in B7's order. `more` is not a section, so it carries no id. */
const PRIMARY_IDS = ['home', 'people', 'money', 'inbox'];

/**
 * `money`'s own row names the sub-page the rail opens ("סקירה כספית"); the
 * tab stands for the whole finance section, so it borrows the section's own
 * name from `NAV_GROUPS` rather than a second, hand-typed "כספים" living
 * only here — nav-data.ts stays the one place that string is spelled. The
 * mock's bottom nav (docs/superpowers/mock/mobile-home.html) labels this
 * same tab "כספים" for the same reason. Every other primary tab already
 * carries the right word on its own item, so this is the one exception.
 */
function tabLabel(item: NavItem): string {
  if (item.id !== 'money') return item.label;
  const group = NAV_GROUPS.find((candidate) => candidate.items.some((row) => row.id === item.id));
  return group?.label ?? item.label;
}

/**
 * The sheet behind עוד. Split out so the trap mounts with the panel and
 * unmounts with it — `useFocusTrap` does its work on mount, which is what
 * gives focus-in, `esc` and focus-return for free.
 */
function MoreSheet({ items, onClose }: { items: NavItem[]; onClose: () => void }) {
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const { rootRef, onKeyDown } = useFocusTrap<HTMLDivElement>({
    onEscape: onClose,
    getInitialFocus: () => headingRef.current,
    getExtraStart: () => headingRef.current,
  });

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-label="עוד"
      className={styles.sheet}
      onKeyDown={onKeyDown}
    >
      <h2 className="sr-only" ref={headingRef} tabIndex={-1}>עוד</h2>
      {items.map((item) => (item.planned ? (
        <span key={item.id} className={styles.sheetPlanned} aria-disabled="true">
          <Icon name={item.icon} size={20} />
          <span>{item.label}</span>
          <span className={styles.soon}>בקרוב</span>
        </span>
      ) : (
        <Link key={item.id} href={item.href} className={styles.sheetItem} onClick={onClose}>
          <Icon name={item.icon} size={20} />
          <span>{item.label}</span>
        </Link>
      )))}
      <button type="button" className={styles.sheetClose} onClick={onClose}>סגירה</button>
    </div>
  );
}

export function TabBar() {
  const active = activeItemId(usePathname());
  const [more, setMore] = useState(false);
  const counts = useShellCounts();

  const tabs = PRIMARY_IDS.map((id) => NAV_ITEMS.find((item) => item.id === id)!);
  const rest = NAV_ITEMS.filter((item) => !PRIMARY_IDS.includes(item.id));

  /**
   * B2: a count that would read zero is not shown, and it is not announced
   * either — so the accessible name is gated on the same test as the badge,
   * not just the badge. The badge itself is `aria-hidden`: a bare "12" beside
   * "לטיפול" reads as two unrelated things, where "לטיפול, 12 פריטים" is a
   * sentence. A17 — one `<bdi>` for the phrase, not one per number.
   */
  function countOf(item: NavItem): number {
    const value = item.count ? counts[item.count] : 0;
    return value > 0 ? value : 0;
  }

  return (
    <>
      {more && <MoreSheet items={rest} onClose={() => setMore(false)} />}

      <nav className={styles.bar} aria-label="ניווט מהיר">
        {tabs.map((item) => {
          const count = countOf(item);
          const label = tabLabel(item);
          return item.planned ? (
            <span key={item.id} className={styles.tab} aria-disabled="true">
              <Icon name={item.icon} size={20} />
              <span>{label}</span>
            </span>
          ) : (
            <Link
              key={item.id}
              href={item.href}
              className={styles.tab}
              aria-label={count > 0 ? `${label}, ${count} פריטים` : undefined}
              aria-current={item.id === active ? 'page' : undefined}
            >
              <span className={styles.glyph}>
                <Icon name={item.icon} size={20} />
                {count > 0 && (
                  <span className={item.hot ? `${styles.badge} ${styles.hot}` : styles.badge} aria-hidden="true">
                    <bdi>{count}</bdi>
                  </span>
                )}
              </span>
              <span>{label}</span>
            </Link>
          );
        })}
        <button
          type="button"
          className={styles.tab}
          aria-expanded={more}
          onClick={() => setMore((value) => !value)}
        >
          <Icon name="menu" size={20} />
          <span>עוד</span>
        </button>
      </nav>
    </>
  );
}

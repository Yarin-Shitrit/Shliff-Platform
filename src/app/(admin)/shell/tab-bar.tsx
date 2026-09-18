'use client';

/**
 * Client component: it marks the current tab from the browser's path and it
 * toggles the עוד sheet — both are things only the browser can answer.
 *
 * B7, shown only below 767.98px (integration Ruling I5). Plan 12 modifies
 * this file and owns the finished five-item phone behaviour, so this build
 * makes it work rather than final: no safe-area insets, no season sheet, no
 * search sheet yet.
 */
import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Icon } from '@/components/ui/icon';
import { NAV_GROUPS, NAV_ITEMS, activeItemId, type NavItem } from './nav-data';
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

export function TabBar() {
  const active = activeItemId(usePathname());
  const [more, setMore] = useState(false);

  const tabs = PRIMARY_IDS.map((id) => NAV_ITEMS.find((item) => item.id === id)!);
  const rest = NAV_ITEMS.filter((item) => !PRIMARY_IDS.includes(item.id));

  return (
    <>
      {more && (
        <div className={styles.sheet}>
          {rest.map((item) => (item.planned ? (
            <span key={item.id} className={styles.sheetPlanned} aria-disabled="true">
              <Icon name={item.icon} size={20} />
              <span>{item.label}</span>
              <span className={styles.soon}>בקרוב</span>
            </span>
          ) : (
            <Link
              key={item.id}
              href={item.href}
              className={styles.sheetItem}
              onClick={() => setMore(false)}
            >
              <Icon name={item.icon} size={20} />
              <span>{item.label}</span>
            </Link>
          )))}
        </div>
      )}

      <nav className={styles.bar} aria-label="ניווט מהיר">
        {tabs.map((item) => (item.planned ? (
          <span key={item.id} className={styles.tab} aria-disabled="true">
            <Icon name={item.icon} size={20} />
            <span>{tabLabel(item)}</span>
          </span>
        ) : (
          <Link
            key={item.id}
            href={item.href}
            className={styles.tab}
            aria-current={item.id === active ? 'page' : undefined}
          >
            <Icon name={item.icon} size={20} />
            <span>{tabLabel(item)}</span>
          </Link>
        )))}
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

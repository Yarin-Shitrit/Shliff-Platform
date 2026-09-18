import Link from 'next/link';
import type { InboxItem, InboxGroup } from '@/lib/inbox/items';
import { groupOf } from '@/lib/inbox/items';
import { Pill, type PillTone } from '@/components/ui/pill';
import styles from './inbox.module.css';

/** R3: every state carries a word, never a colour alone. */
function badge(item: InboxItem): { tone: PillTone; word: string } {
  if (item.snoozedUntil !== null) return { tone: 'neutral', word: 'נדחה' };
  switch (item.kind) {
    case 'unlinked-name': return { tone: 'info', word: 'שם' };
    case 'sheet-season':
    case 'sheet-collision': return { tone: 'warn', word: 'חוסם' };
    case 'block-undecided': return { tone: 'brand', word: 'סיווג' };
    case 'unnamed-debt': return { tone: 'bad', word: 'חוב בלי שם' };
    case 'refused-row': return { tone: 'neutral', word: 'סורב' };
    case 'arithmetic-flag': return { tone: 'neutral', word: 'חשבון' };
  }
}

export function itemHref(tab: string, kind: string, itemId: string): string {
  const params = new URLSearchParams({ tab, kind, item: itemId });
  return `/inbox?${params.toString()}`;
}

/**
 * A Server Component, and every row is a `<Link>` rather than a button (R6).
 * The open decision is then a URL a lead can send to whoever knows the
 * answer, and it survives a refresh without any client state at all.
 */
export function ItemRail({
  items, groups, activeId, tab, kind,
}: {
  items: InboxItem[];
  groups: Array<{ group: InboxGroup; label: string; count: number }>;
  activeId: string | null;
  tab: 'decide' | 'notice' | 'done';
  kind: InboxGroup | 'all';
}) {
  return (
    <div className={styles.rail}>
      <div className={styles.seg} role="group" aria-label="סינון לפי סוג">
        {/*
          `aria-current="page"` here and `"true"` on the open item below. Both
          are current, in different senses — this filter is applied, that item
          is open — and giving them the same value makes them one
          indistinguishable set to a screen reader and to any query over them.
        */}
        <Link
          href={`/inbox?tab=${tab}&kind=all`}
          className={styles.segLink}
          aria-current={kind === 'all' ? 'page' : undefined}
        >
          {/* A17: one isolate per phrase, not one per number. */}
          <bdi>הכול {items.length}</bdi>
        </Link>
        {groups.map((g) => (
          <Link
            key={g.group}
            href={`/inbox?tab=${tab}&kind=${g.group}`}
            className={styles.segLink}
            aria-current={kind === g.group ? 'page' : undefined}
          >
            <bdi>{g.label} {g.count}</bdi>
          </Link>
        ))}
      </div>

      <ul className={styles.list} aria-label="פריטים לטיפול">
        {items.map((item) => {
          const mark = badge(item);
          return (
            <li key={item.id}>
              <Link
                href={itemHref(tab, kind, item.id)}
                className={styles.row}
                aria-current={item.id === activeId ? 'true' : undefined}
                data-group={groupOf(item)}
              >
                <span className={styles.rowText}>
                  <span className={styles.rowTitle}>{item.title}</span>
                  <span className={styles.rowDetail}>{item.detail}</span>
                </span>
                <Pill tone={mark.tone}>{mark.word}</Pill>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

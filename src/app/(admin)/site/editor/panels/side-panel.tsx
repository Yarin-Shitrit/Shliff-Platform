'use client';

/**
 * The panel at the inline start (spec §10): two tabs, adding to the map and
 * what is on it. On an empty map it opens on the library, invites the first
 * item, and leaves how a tile is placed to the library's own hint (§13: an
 * empty state is an invitation).
 */

import { useEffect, useId, useRef, type KeyboardEvent, type ReactElement, type ReactNode } from 'react';
import { cx } from '@/components/ui/cx';
import chrome from './panel.module.css';
import styles from './side-panel.module.css';

export type SideTab = 'library' | 'objects';

export function SidePanel({ tab, onTab, library, objects, count }: {
  tab: SideTab;
  onTab: (tab: SideTab) => void;
  library: ReactNode;
  objects: ReactNode;
  count: number;
}): ReactElement {
  const id = useId();
  const libraryTab = useRef<HTMLButtonElement>(null);
  const objectsTab = useRef<HTMLButtonElement>(null);
  const shownTab = useRef(tab);

  /* A control inside a tab can open the other one — the empty list's
     invitation does. That control leaves with its tab, and the focus with
     it; the focus goes to the tab that opened rather than to the page. */
  useEffect(() => {
    if (shownTab.current === tab) return;
    shownTab.current = tab;
    if (document.activeElement === null || document.activeElement === document.body) {
      (tab === 'library' ? libraryTab : objectsTab).current?.focus();
    }
  }, [tab]);

  /* Two tabs, so either arrow goes to the other one. Handled here and kept
     from the editor's root, where an arrow would nudge the selection. */
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    event.stopPropagation();
    const next: SideTab = tab === 'library' ? 'objects' : 'library';
    onTab(next);
    (next === 'library' ? libraryTab : objectsTab).current?.focus();
  }

  return (
    <section className={cx(chrome.panel, styles.side)} aria-label="הוספה ורשימת הפריטים" data-panel="true">
      <div className={styles.tabs} role="tablist" aria-label="הוספה ורשימה" onKeyDown={onKeyDown}>
        <button
          ref={libraryTab}
          type="button"
          role="tab"
          id={`${id}-library`}
          className={styles.tab}
          aria-selected={tab === 'library'}
          aria-controls={`${id}-panel`}
          tabIndex={tab === 'library' ? 0 : -1}
          onClick={() => { onTab('library'); }}
        >
          הוספה למפה
        </button>
        <button
          ref={objectsTab}
          type="button"
          role="tab"
          id={`${id}-objects`}
          className={styles.tab}
          aria-selected={tab === 'objects'}
          aria-controls={`${id}-panel`}
          tabIndex={tab === 'objects' ? 0 : -1}
          onClick={() => { onTab('objects'); }}
        >
          במפה
          {' '}
          <span className={styles.tabCount}><bdi>{count}</bdi></span>
        </button>
      </div>
      <div className={chrome.body} role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-${tab}`}>
        {count === 0 && tab === 'library' ? (
          <p className={chrome.invite}>המפה ריקה. אפשר להתחיל מכל פריט שכאן.</p>
        ) : null}
        {tab === 'library' ? library : objects}
      </div>
    </section>
  );
}

'use client';

/**
 * Client component: it owns open/closed state, a keyboard selection, and two
 * window-level shortcuts. None of that has a server answer.
 */
import { useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Icon, type IconName } from '@/components/ui/icon';
import type { PaletteHit } from '@/lib/search/palette';
import { searchCommandPalette } from './actions';
import styles from './command-palette.module.css';

interface Row {
  key: string;
  group: string;
  title: string;
  meta: string;
  href: string;
  icon: IconName;
}

/** Always offered (B5), filtered by the same substring as everything else. */
const ACTIONS: Row[] = [
  { key: 'act-pay', group: 'פעולות', title: 'רישום תשלום', meta: '', href: '/fees', icon: 'receipt' },
  { key: 'act-person', group: 'פעולות', title: 'הוספת אדם', meta: '', href: '/members', icon: 'userplus' },
  { key: 'act-upload', group: 'פעולות', title: 'העלאת קובץ', meta: '', href: '/upload', icon: 'upload' },
];

const GROUPS = ['אנשים', 'תנועות', 'סעיפי תקציב', 'קבצים', 'פעולות'];
const KIND: Record<PaletteHit['kind'], { group: string; icon: IconName }> = {
  person: { group: 'אנשים', icon: 'users' },
  movement: { group: 'תנועות', icon: 'ledger' },
  budget: { group: 'סעיפי תקציב', icon: 'pie' },
  file: { group: 'קבצים', icon: 'grid' },
};

/**
 * R10: bound to the physical key, not to what it types. With a Hebrew
 * keyboard layout `event.key` for the physical K key is `ל` and for `/` it
 * is `.` — binding to `event.key` would leave both shortcuts dead for every
 * user of this app. `event.code` names the physical key regardless of
 * layout, so this is right by construction rather than by what a test
 * happens to type.
 */
function isOpenShortcut(event: KeyboardEvent): boolean {
  if (event.code === 'KeyK' && (event.metaKey || event.ctrlKey)) return true;
  if (event.code !== 'Slash') return false;
  if (event.metaKey || event.ctrlKey || event.altKey) return false;
  const target = event.target as HTMLElement | null;
  const tag = target?.tagName;
  return !(tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable);
}

export function CommandPalette() {
  const router = useRouter();
  const season = useSearchParams().get('season');
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<PaletteHit[]>([]);
  const [cursor, setCursor] = useState(0);
  const box = useRef<HTMLInputElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (!isOpenShortcut(event)) return;
      event.preventDefault();
      setOpen(true);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (open) box.current?.focus();
  }, [open]);

  // Esc, a scrim click and a selection all close the same way: focus returns
  // to the trigger that opened the palette, matching season-switch.tsx.
  const wasOpen = useRef(false);
  useEffect(() => {
    if (wasOpen.current && !open) trigger.current?.focus();
    wasOpen.current = open;
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let live = true;
    searchCommandPalette(query, season).then((next) => {
      if (live) { setHits(next); setCursor(0); }
    });
    return () => { live = false; };
  }, [open, query, season]);

  const needle = query.trim();
  const rows: Row[] = [
    ...hits.map((hit) => ({
      key: `${hit.kind}-${hit.id}`,
      group: KIND[hit.kind].group,
      icon: KIND[hit.kind].icon,
      title: hit.title,
      meta: hit.meta,
      href: hit.href,
    })),
    ...ACTIONS.filter((action) => !needle || action.title.includes(needle)),
  ];
  const ordered = GROUPS.flatMap((group) => rows.filter((row) => row.group === group));

  function close() {
    setOpen(false);
    setQuery('');
    setHits([]);
  }

  function onBoxKey(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.code === 'Escape') { close(); return; }
    if (event.code === 'ArrowDown') {
      event.preventDefault();
      setCursor((at) => Math.min(at + 1, ordered.length - 1));
      return;
    }
    if (event.code === 'ArrowUp') {
      event.preventDefault();
      setCursor((at) => Math.max(at - 1, 0));
      return;
    }
    if (event.code === 'Enter' || event.code === 'NumpadEnter') {
      const row = ordered[cursor];
      if (!row) return;
      event.preventDefault();
      close();
      router.push(row.href);
    }
  }

  return (
    <>
      <button ref={trigger} type="button" className={styles.trigger} onClick={() => setOpen(true)}>
        <Icon name="search" size={16} />
        <span>חיפוש</span>
        <span className={styles.kbd}>⌘K</span>
      </button>

      {open && (
        <>
          <button type="button" className={styles.scrim} aria-label="סגירה" onClick={close} />
          <div className={styles.pop} role="dialog" aria-modal="true" aria-label="חיפוש ופעולות">
            <div className={styles.boxrow}>
              <Icon name="search" size={16} />
              <input
                ref={box}
                role="combobox"
                aria-expanded="true"
                aria-controls="palette-results"
                aria-label="חיפוש על פני אנשים, תנועות, סעיפים וקבצים"
                className={styles.box}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={onBoxKey}
              />
              <span className={styles.kbd}>esc</span>
            </div>

            <div className={styles.results} id="palette-results" role="listbox">
              {GROUPS.map((group) => {
                const inGroup = ordered.filter((row) => row.group === group);
                if (inGroup.length === 0) return null;
                return (
                  <div key={group}>
                    <div className={styles.menusect}>{group}</div>
                    {inGroup.map((row) => (
                      <button
                        key={row.key}
                        type="button"
                        role="option"
                        aria-selected={ordered[cursor]?.key === row.key}
                        className={styles.row}
                        onClick={() => { close(); router.push(row.href); }}
                      >
                        <Icon name={row.icon} size={16} />
                        <span>{row.title}</span>
                        {row.meta && <bdi className={styles.rowmeta}>{row.meta}</bdi>}
                      </button>
                    ))}
                  </div>
                );
              })}
            </div>

            <div className={styles.foot}>
              <span>↑↓ ניווט</span>
              <span>↵ פתיחה</span>
              <span>esc סגירה</span>
              <span className={styles.footnote}>חיפוש על פני אנשים, תנועות, סעיפים וקבצים</span>
            </div>
          </div>
        </>
      )}
    </>
  );
}

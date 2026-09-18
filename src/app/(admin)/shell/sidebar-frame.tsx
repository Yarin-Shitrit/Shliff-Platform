'use client';

/**
 * Client component: below 1024px the rail becomes a panel that opens and
 * closes, and open/closed is browser state kept only here. The rail inside
 * it stays a Server Component — it arrives as `children` and never re-runs
 * when this file toggles.
 */
import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { Icon } from '@/components/ui/icon';
import styles from './sidebar.module.css';

export function SidebarFrame({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Going somewhere closes it: on a phone or a tablet the panel covers the
  // page you just asked for.
  //
  // Adjusted during render rather than in an effect. An effect paints the panel
  // open over the new page and only then closes it — a cascading render, which
  // is what the lint rule objects to. Setting state during render instead makes
  // React discard this render and re-run before committing anything, so the new
  // page never appears with the panel over it. The effects below still see
  // `open` change, so Escape, the scrim and focus-return behave exactly as
  // they did.
  const [seenPathname, setSeenPathname] = useState(pathname);
  if (pathname !== seenPathname) {
    setSeenPathname(pathname);
    setOpen(false);
  }

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.code === 'Escape') setOpen(false);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  // A9: the button that opens the panel is the only shell control a phone or
  // tablet reader reaches first, so it must never disappear from under a
  // focused element. It stays mounted the whole time — `.menubutton[data-open]`
  // hides it with CSS instead — and opening moves focus into the panel itself,
  // since nothing inside `children` is guaranteed to be a sensible target.
  useEffect(() => {
    if (open) panelRef.current?.focus();
  }, [open]);

  // Whatever closes the panel — the scrim, Escape, or a navigation — hands
  // focus back to the button that opened it, matching season-switch.tsx and
  // command-palette.tsx (both use the same `wasOpen` ref for the same reason:
  // a keyboard user must never be dropped onto <body> with nothing focused).
  const wasOpen = useRef(false);
  useEffect(() => {
    if (wasOpen.current && !open) triggerRef.current?.focus();
    wasOpen.current = open;
  }, [open]);

  // While the panel covers the page, the column behind it must stop being
  // tabbable too — not just hidden — or Tab still walks a keyboard user
  // through a page they cannot see (A9/E4). `panelRef` (`.rail`) is always
  // this fragment's last rendered node, so its next sibling is `layout.tsx`'s
  // `.column`, regardless of what the DOM looks like at 1024px and above.
  useEffect(() => {
    const behind = panelRef.current?.nextElementSibling;
    if (!(behind instanceof HTMLElement)) return;
    behind.toggleAttribute('inert', open);
    return () => behind.removeAttribute('inert');
  }, [open]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={styles.menubutton}
        data-open={open ? 'true' : 'false'}
        aria-label="תפריט"
        onClick={() => setOpen(true)}
      >
        <Icon name="menu" size={20} />
      </button>
      {open && (
        <button
          type="button"
          className={styles.railScrim}
          aria-label="סגירה"
          onClick={() => setOpen(false)}
        />
      )}
      <div
        ref={panelRef}
        className={styles.rail}
        data-open={open ? 'true' : 'false'}
        tabIndex={-1}
      >
        {children}
      </div>
    </>
  );
}

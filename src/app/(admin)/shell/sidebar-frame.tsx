'use client';

/**
 * Client component: below 1024px the rail becomes a panel that opens and
 * closes, and open/closed is browser state kept only here. The rail inside
 * it stays a Server Component — it arrives as `children` and never re-runs
 * when this file toggles.
 */
import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { Icon } from '@/components/ui/icon';
import styles from './sidebar.module.css';

export function SidebarFrame({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // Going somewhere closes it: on a phone or a tablet the panel covers the
  // page you just asked for.
  useEffect(() => { setOpen(false); }, [pathname]);

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.code === 'Escape') setOpen(false);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <>
      {!open && (
        <button
          type="button"
          className={styles.menubutton}
          aria-label="תפריט"
          onClick={() => setOpen(true)}
        >
          <Icon name="menu" size={20} />
        </button>
      )}
      {open && (
        <button
          type="button"
          className={styles.railScrim}
          aria-label="סגירה"
          onClick={() => setOpen(false)}
        />
      )}
      <div className={styles.rail} data-open={open ? 'true' : 'false'}>
        {children}
      </div>
    </>
  );
}

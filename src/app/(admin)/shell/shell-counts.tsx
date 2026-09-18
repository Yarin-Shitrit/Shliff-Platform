'use client';

/**
 * Client module: B2's three counts depend on `?season=`, which a layout cannot
 * read (Ruling S2), so they are fetched in the browser.
 *
 * It exists because B2's counts now have **two** surfaces — the rail's badges
 * and B7's phone tab bar — and `counts.ts`'s own rule is that "a count in the
 * chrome that disagrees with the page it links to is worse than no count".
 * Two components each running their own fetch could disagree for a whole
 * request, so the layout mounts one provider and both read it.
 *
 * `useShellCounts` still works with no provider above it, and then fetches for
 * itself. That is not a convenience: `nav-list.test.tsx` and `tab-bar.test.tsx`
 * both render their component bare, and a hook that silently reported zeros
 * outside a provider would make every badge assertion in those files pass
 * against a component that had stopped counting.
 */
import { createContext, useContext, useEffect, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import type { ShellCounts } from '@/lib/shell/counts';
import { loadShellCounts } from './actions';

const NOTHING: ShellCounts = { openDecisions: 0, rosterSize: 0, understaffedTasks: 0 };

const ShellCountsContext = createContext<ShellCounts | null>(null);

/**
 * `pathname` is a dependency for the reason `nav-list.tsx` gave when it owned
 * this effect: the chrome stays mounted across every soft navigation, so
 * without it a write followed by a navigation leaves the badge showing what it
 * loaded when the tab was opened. It depends only on values it does not set,
 * so it cannot loop.
 */
function useFetchedCounts(active: boolean): ShellCounts {
  const season = useSearchParams().get('season');
  const pathname = usePathname();
  const [counts, setCounts] = useState<ShellCounts>(NOTHING);

  useEffect(() => {
    if (!active) return undefined;
    let live = true;
    loadShellCounts(season).then((next) => {
      if (live && next) setCounts(next);
    });
    return () => { live = false; };
  }, [season, pathname, active]);

  return counts;
}

export function ShellCountsProvider({ children }: { children: React.ReactNode }) {
  const counts = useFetchedCounts(true);
  return <ShellCountsContext value={counts}>{children}</ShellCountsContext>;
}

export function useShellCounts(): ShellCounts {
  const shared = useContext(ShellCountsContext);
  const own = useFetchedCounts(shared === null);
  return shared ?? own;
}

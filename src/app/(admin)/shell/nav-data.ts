import type { IconName } from '@/components/ui/icon';

export interface NavItem {
  /** Stable id — the React key, the active mark, and the tab bar's selector. */
  id: string;
  label: string;
  href: string;
  icon: IconName;
  /** Which of the three counts this item carries (B2). */
  count?: 'openDecisions' | 'rosterSize' | 'understaffedTasks';
  /** Brand-coloured: an open decision is the one count that is a to-do. */
  hot?: boolean;
  /**
   * The route does not exist yet, so the item is text with a בקרוב pill and
   * never a link (Ruling S3). The screen plan that creates the route drops
   * this flag in the same commit.
   */
  planned?: boolean;
  /** A screen the redesign retires, kept only while its replacement is planned. */
  transitional?: boolean;
}

export interface NavGroup {
  label: string | null;
  items: NavItem[];
}

/**
 * B1, top to bottom. Labels, order and grouping are the spec's, verbatim.
 *
 * תקציב points into `/money`'s budget band rather than at a route of its own:
 * D6 keeps the budget on the money page. It therefore never wins the active
 * mark — `/money` matches סקירה כספית first, and that is correct, because
 * they are one route.
 */
export const NAV_GROUPS: NavGroup[] = [
  {
    label: null,
    items: [
      { id: 'home', label: 'בית', href: '/', icon: 'home' },
      {
        id: 'inbox', label: 'לטיפול', href: '/inbox', icon: 'inbox',
        count: 'openDecisions', hot: true, planned: true,
      },
    ],
  },
  {
    label: 'הקאמפ',
    items: [
      { id: 'people', label: 'אנשים', href: '/members', icon: 'users', count: 'rosterSize' },
      { id: 'dues', label: 'דמי קאמפ', href: '/fees', icon: 'receipt' },
      { id: 'tasks', label: 'משימות', href: '/tasks', icon: 'tasks', count: 'understaffedTasks' },
    ],
  },
  {
    label: 'כספים',
    items: [
      { id: 'money', label: 'סקירה כספית', href: '/money', icon: 'wallet' },
      { id: 'ledger', label: 'תנועות', href: '/money/ledger', icon: 'ledger', planned: true },
      { id: 'budget', label: 'תקציב', href: '/money#budget', icon: 'pie' },
      { id: 'debts', label: 'חובות', href: '/money/debts', icon: 'scale', planned: true },
    ],
  },
  {
    label: 'נתונים',
    items: [
      { id: 'files', label: 'קבצים וייבוא', href: '/imports', icon: 'sheet', planned: true },
      {
        id: 'upload', label: 'העלאת קובץ', href: '/upload', icon: 'upload',
        transitional: true,
      },
    ],
  },
];

export const NAV_ITEMS: NavItem[] = NAV_GROUPS.flatMap((group) => group.items);

/** The path an item owns, with any anchor stripped — `usePathname` has none. */
function pathOf(item: NavItem): string {
  return item.href.split('#')[0];
}

/**
 * Matched by path prefix (B3), whole segments only, longest first.
 *
 * The nav this replaces compared `pathname === href`, so `/members/[id]` and
 * `/imports/[id]` left the whole rail unmarked — a reader on a person's page
 * could not see which section they were in. Prefix matching fixes that;
 * requiring a `/` after the prefix keeps `/membership` from marking אנשים;
 * and longest-first keeps `/money/ledger` from being claimed by `/money`.
 */
export function activeItemId(pathname: string): string | null {
  const path = pathname.replace(/\/+$/, '') || '/';
  let best: NavItem | null = null;

  for (const item of NAV_ITEMS) {
    const owned = pathOf(item);
    const matches = owned === '/'
      ? path === '/'
      : path === owned || path.startsWith(`${owned}/`);
    if (!matches) continue;
    if (!best || owned.length > pathOf(best).length) best = item;
  }

  return best?.id ?? null;
}

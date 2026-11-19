import type { IconName } from '@/components/ui/icon';
import { isPageKey, type PageKey } from '@/lib/auth/pages';

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
   *
   * No item carries it today: לטיפול, תנועות, חובות and קבצים וייבוא all
   * shipped during waves 3–4 and each left the flag behind, so the rail went
   * on offering "בקרוב" for four screens a lead could already open. The field
   * stays for the next route that is announced before it exists.
   */
  planned?: boolean;
  /** A screen the redesign retires, kept only while its replacement is planned. */
  transitional?: boolean;
  /**
   * The page whose grant opens this item, when it is not the item's own id:
   * תקציב is an anchor into `/money`, so it opens with סקירה כספית. Every
   * other item's id is itself a `PageKey` (`src/lib/auth/pages.ts`).
   */
  access?: PageKey;
  /** Shown to the admin role alone, and never granted: משתמשים והרשאות. */
  adminOnly?: boolean;
  /**
   * The screen is leaving: the rail, the tab bar and the "more" sheet no
   * longer offer it, but its route still answers and its grant still opens
   * it, because another screen links there. It stays in this list so the
   * path keeps resolving to its own page — the view-only banner and the
   * palette's access check both find a page through here — and it goes, with
   * its route, once nothing links to it.
   */
  offRail?: boolean;
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
        count: 'openDecisions', hot: true,
      },
    ],
  },
  {
    label: 'הקאמפ',
    items: [
      { id: 'people', label: 'אנשים', href: '/members', icon: 'users', count: 'rosterSize' },
      { id: 'dues', label: 'דמי קאמפ', href: '/fees', icon: 'receipt' },
      { id: 'tasks', label: 'משימות', href: '/tasks', icon: 'tasks', count: 'understaffedTasks' },
      /* The shift schedule: types of shift and one season's board of them.
         Beside משימות rather than under לוגיסטיקה because staffing the event
         is the camp's own concern — who stands where, not what is kept or
         built — and because every slot on it is also a task the משימות
         board already shows. The route keeps its `/logistics/` prefix so no
         saved link breaks. */
      { id: 'shifts', label: 'משמרות', href: '/logistics/shifts', icon: 'clock' },
      /* Who was at which work day, build day or shopping run during the
         year, and how often. Beside משמרות for the same reason it sits
         there: it is about the camp's people and what they gave, not about
         what is kept or built. The route keeps the `/logistics/` prefix
         because the screen is the logistics area's to maintain. */
      { id: 'attendance', label: 'נוכחות', href: '/logistics/attendance', icon: 'check' },
      /* Not in B1: the camp map came after the twelve plans. It sits with
         the camp's own things — people, dues, tasks — because it is where
         those people and tasks physically land, not a logistics list. */
      { id: 'site', label: 'מפת הקאמפ', href: '/site', icon: 'tent' },
    ],
  },
  {
    label: 'כספים',
    items: [
      { id: 'money', label: 'סקירה כספית', href: '/money', icon: 'wallet' },
      { id: 'ledger', label: 'תנועות', href: '/money/ledger', icon: 'ledger' },
      /* Typing one expense from a phone, with the receipt's photo. Its own
         page and its own grant, so someone who buys for the camp can record
         what they spent without being shown the whole ledger. */
      { id: 'expenses', label: 'הוצאות', href: '/money/expenses', icon: 'cash' },
      /* Parties are where the camp's money comes from, so their history sits
         with the money rather than with the camp's tasks. */
      { id: 'events', label: 'מסיבות', href: '/money/events', icon: 'calendar' },
      { id: 'budget', label: 'תקציב', href: '/money#budget', icon: 'pie', access: 'money' },
      { id: 'debts', label: 'חובות', href: '/money/debts', icon: 'scale' },
    ],
  },
  /*
   * Logistics sits after כספים and before נתונים: it is camp operations, and
   * נתונים is the utility tail (import, upload) rather than a peer of it.
   *
   * There is no hub item. `/logistics` redirects to the warehouse, and a
   * fourth entry holding four tiles is not worth the rail space; the
   * screens themselves are what a lead actually opens.
   */
  {
    label: 'לוגיסטיקה',
    items: [
      { id: 'warehouse', label: 'מחסן', href: '/logistics/warehouse', icon: 'layers' },
      { id: 'acquisitions', label: 'רכש', href: '/logistics/acquisitions', icon: 'list' },
      /* הקמה is off the rail and on its way out: ימי עבודה took its place.
         The route stays until מפת הקאמפ's build-task links point somewhere
         else (`site-table.tsx` builds them from `BUILD_PATH`), and so does
         its grant. */
      { id: 'build', label: 'הקמה', href: '/logistics/build', icon: 'board', offRail: true },
      /* The work plan: what the camp builds before the burn, under which
         topic, in what order and on which days. The rail reads from what is
         kept to what is done: the gear, what is bought, and the calendar
         that gets the camp to it. */
      { id: 'plan', label: 'לוח עבודה', href: '/logistics/plan', icon: 'board' },
      /* Who works on what on each work day. A screen under the plan's own
         route, opened by the plan's grant; it has a rail entry because it is
         the one a lead opens on the morning of a work day, and the only way
         to it was a button on לוח עבודה. Longest-prefix matching gives it
         the active mark over לוח עבודה. */
      {
        id: 'workdays', label: 'ימי עבודה', href: '/logistics/plan/workdays', icon: 'calendar',
        access: 'plan',
      },
    ],
  },
  {
    label: 'נתונים',
    items: [
      { id: 'files', label: 'קבצים וייבוא', href: '/imports', icon: 'sheet' },
      {
        id: 'upload', label: 'העלאת קובץ', href: '/upload', icon: 'upload',
        transitional: true,
      },
    ],
  },
  /*
   * Who may open what. Last, and for the admin role only: it is the page
   * that hands out every other item's grant, so it is the one page no grant
   * can name.
   */
  {
    label: 'ניהול',
    items: [
      { id: 'users', label: 'משתמשים והרשאות', href: '/users', icon: 'user', adminOnly: true },
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

/**
 * The grant an item needs: its `access` override, else its own id. `null`
 * for an item no grant can open (`adminOnly`), and for an id the registry
 * does not know — which `nav-data.test.ts` keeps from ever being the case.
 */
export function pageOfItem(item: NavItem): PageKey | null {
  if (item.adminOnly) return null;
  const key = item.access ?? item.id;
  return isPageKey(key) ? key : null;
}

/**
 * The grant a link needs, by the same prefix match that marks the rail — so
 * a palette hit on `/members/<id>` asks for אנשים. `null` for a path no item
 * owns, which a caller treats as closed: an unknown destination is not an
 * open one.
 */
export function pageOfHref(href: string): PageKey | null {
  const id = activeItemId(href.split('#')[0].split('?')[0]);
  const item = NAV_ITEMS.find((candidate) => candidate.id === id);
  return item ? pageOfItem(item) : null;
}

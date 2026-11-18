/**
 * The pages an account can be granted, one entry per screen the rail names.
 *
 * `key` is the rail item's own id (`src/app/(admin)/shell/nav-data.ts`), so
 * a grant and the link it unlocks can never disagree on which page they
 * mean — `pages.test.ts` holds the two lists to each other. The keys are
 * what `user_page_access.page` stores, which is why they are words rather
 * than paths: a route can move (משמרות kept its `/logistics/` prefix when it
 * left the logistics group) without every grant in the table going stale.
 *
 * משתמשים והרשאות itself is not here. It is the page that hands out these
 * grants, so it belongs to the admin role alone and is never granted.
 */

export const ACCESS_LEVELS = ['view', 'edit'] as const;

/**
 * Here rather than in `./users` because the drawer checks it in the browser
 * before the round trip, and `./users` reaches argon2 and the schema — a
 * client module must not import it.
 */
export const MIN_PASSWORD_LENGTH = 8;
export type AccessLevel = (typeof ACCESS_LEVELS)[number];

/** The three words a grant can read as on screen; `none` is the absent row. */
export const ACCESS_LABELS: Readonly<Record<AccessLevel | 'none', string>> = {
  none: 'בלי גישה',
  view: 'צפייה בלבד',
  edit: 'צפייה ועריכה',
};

export interface PageDef {
  key: string;
  /** The rail's own word for the page. */
  label: string;
  href: string;
  /** The rail's group heading, for the grid on משתמשים והרשאות. */
  group: string;
}

export const PAGES = [
  { key: 'home', label: 'בית', href: '/', group: 'ראשי' },
  { key: 'inbox', label: 'לטיפול', href: '/inbox', group: 'ראשי' },
  { key: 'people', label: 'אנשים', href: '/members', group: 'הקאמפ' },
  { key: 'dues', label: 'דמי קאמפ', href: '/fees', group: 'הקאמפ' },
  { key: 'tasks', label: 'משימות', href: '/tasks', group: 'הקאמפ' },
  { key: 'shifts', label: 'משמרות', href: '/logistics/shifts', group: 'הקאמפ' },
  { key: 'attendance', label: 'נוכחות', href: '/logistics/attendance', group: 'הקאמפ' },
  { key: 'site', label: 'מפת הקאמפ', href: '/site', group: 'הקאמפ' },
  { key: 'money', label: 'סקירה כספית', href: '/money', group: 'כספים' },
  { key: 'ledger', label: 'תנועות', href: '/money/ledger', group: 'כספים' },
  { key: 'expenses', label: 'הוצאות', href: '/money/expenses', group: 'כספים' },
  { key: 'events', label: 'מסיבות', href: '/money/events', group: 'כספים' },
  { key: 'debts', label: 'חובות', href: '/money/debts', group: 'כספים' },
  { key: 'warehouse', label: 'מחסן', href: '/logistics/warehouse', group: 'לוגיסטיקה' },
  { key: 'acquisitions', label: 'רכש', href: '/logistics/acquisitions', group: 'לוגיסטיקה' },
  { key: 'build', label: 'הקמה', href: '/logistics/build', group: 'לוגיסטיקה' },
  { key: 'plan', label: 'לוח עבודה', href: '/logistics/plan', group: 'לוגיסטיקה' },
  { key: 'files', label: 'קבצים וייבוא', href: '/imports', group: 'נתונים' },
  { key: 'upload', label: 'העלאת קובץ', href: '/upload', group: 'נתונים' },
] as const satisfies readonly PageDef[];

export type PageKey = (typeof PAGES)[number]['key'];

export const PAGE_KEYS: readonly PageKey[] = PAGES.map((page) => page.key);

export function isPageKey(value: unknown): value is PageKey {
  return typeof value === 'string' && (PAGE_KEYS as readonly string[]).includes(value);
}

export function isAccessLevel(value: unknown): value is AccessLevel {
  return typeof value === 'string' && (ACCESS_LEVELS as readonly string[]).includes(value);
}

export function pageByKey(key: PageKey): PageDef {
  return PAGES.find((page) => page.key === key)!;
}

/** Which pages an account may open, and how far. Absent means closed. */
export type AccessMap = Partial<Record<PageKey, AccessLevel>>;

export interface AccessShape {
  /** The role is `admin`: every page, at `edit`, plus משתמשים והרשאות. */
  admin: boolean;
  /** Empty for an admin — the role answers before the rows are asked. */
  pages: AccessMap;
}

/** How far this account may go on this page; `null` is closed. */
export function levelOf(grants: AccessShape | null, page: PageKey): AccessLevel | null {
  if (grants === null) return null;
  if (grants.admin) return 'edit';
  return grants.pages[page] ?? null;
}

/** `edit` includes `view`; nothing includes `edit` but itself. */
export function allows(level: AccessLevel | null, need: AccessLevel): boolean {
  if (level === null) return false;
  return need === 'view' || level === 'edit';
}

/** The pages this account can open, in the rail's order. */
export function visiblePages(grants: AccessShape | null): PageKey[] {
  return PAGES.map((page) => page.key).filter((key) => levelOf(grants, key) !== null);
}

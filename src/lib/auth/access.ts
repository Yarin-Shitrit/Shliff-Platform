import { eq } from 'drizzle-orm';
import type { AnyDb } from '@/lib/db-types';
import { users, userPageAccess } from '@/db/schema/auth';
import { isAccessLevel, isPageKey, type AccessMap, type AccessShape } from './pages';

/**
 * The pure half — `levelOf`, `allows`, `visiblePages`, the map type — lives
 * in `./pages` so the rail's client islands can read a grant without
 * dragging Drizzle into the browser bundle. This module is the server half:
 * the one that opens the database.
 */
export { levelOf, allows, visiblePages, type AccessMap } from './pages';

export interface Grants extends AccessShape {
  id: string;
  email: string;
}

export const ADMIN_ROLE = 'admin';

/**
 * Reads what an account may do, from the database and never from the
 * session: a grant taken away on משתמשים והרשאות is gone on the next request,
 * not on the next sign-in. `null` when there is no account for the address —
 * a session outliving its row is refused everywhere, not trusted anywhere.
 */
export async function loadGrants(db: AnyDb, email: string): Promise<Grants | null> {
  const [user] = await db
    .select({ id: users.id, email: users.email, role: users.role })
    .from(users)
    .where(eq(users.email, email));
  if (!user) return null;

  const admin = user.role === ADMIN_ROLE;
  if (admin) return { id: user.id, email: user.email, admin, pages: {} };

  const rows = await db
    .select({ page: userPageAccess.page, level: userPageAccess.level })
    .from(userPageAccess)
    .where(eq(userPageAccess.userId, user.id));

  return { id: user.id, email: user.email, admin, pages: accessMapOf(rows) };
}

/**
 * Rows to a map, dropping anything the registry no longer knows. A page
 * that was retired leaves its rows behind; reading them as a grant to
 * nothing is harmless, and reading them as an error would lock the account
 * out of pages it still has.
 */
export function accessMapOf(
  rows: ReadonlyArray<{ page: string; level: string }>,
): AccessMap {
  const map: AccessMap = {};
  for (const row of rows) {
    if (isPageKey(row.page) && isAccessLevel(row.level)) map[row.page] = row.level;
  }
  return map;
}

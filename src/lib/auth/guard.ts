import { cache } from 'react';
import { auth } from './config';
import { db } from '@/db';
import { allows, levelOf, loadGrants, type Grants } from './access';
import type { AccessLevel, PageKey } from './pages';

/**
 * `level` and `admin` are optional on the admit branch only so that a test
 * fixture written as `{ ok: true, email }` keeps compiling; the guard itself
 * always fills them in.
 */
export type AdminCheck =
  | { ok: true; email: string; level?: AccessLevel; admin?: boolean }
  | { ok: false };

/**
 * Once per request, not once per call: the layout, the rail and the page
 * each ask who is signed in, and the answer cannot differ between them.
 */
const grantsFor = cache(async (email: string): Promise<Grants | null> => loadGrants(db, email));

/**
 * The signed-in account and what it may open — `null` when there is no
 * session, or no account behind it. For the chrome: the rail's footer, the
 * links it shows, the not-found boundary's sentence. Enforcement is
 * `requireAdmin`, on every page and every action, and never this.
 */
export async function currentUser(): Promise<Grants | null> {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return null;
  return grantsFor(email);
}

/**
 * Server-side authorization gate. Every page, route handler and server
 * action calls this. UI hiding is never the enforcement mechanism.
 *
 * Three shapes, read from the database on every request (`loadGrants`):
 *
 * - `requireAdmin()` — the admin role alone. משתמשים והרשאות, a new season.
 * - `requireAdmin('people')` — anyone who may open the page: an admin, or
 *   an account granted `view` or `edit` on it. A page, an export, a read.
 * - `requireAdmin('people', 'edit')` — anyone who may change it: an admin,
 *   or an account granted `edit`. Every action that writes.
 *
 * A page is named by its rail id, never by the request's path: a server
 * action is dispatched by its own id whatever URL it was posted to, so the
 * path says nothing about which page's rules apply.
 *
 * It fails closed: anything short of a signed-in account with a row in
 * `users` is refused, and a grant on one page says nothing about another.
 */
export async function requireAdmin(
  page?: PageKey, need: AccessLevel = 'view',
): Promise<AdminCheck> {
  const user = await currentUser();
  if (user === null) return { ok: false };

  if (page === undefined) {
    if (!user.admin) return { ok: false };
    return { ok: true, email: user.email, level: 'edit', admin: true };
  }

  const level = levelOf(user, page);
  if (level === null || !allows(level, need)) return { ok: false };
  return { ok: true, email: user.email, level, admin: user.admin };
}

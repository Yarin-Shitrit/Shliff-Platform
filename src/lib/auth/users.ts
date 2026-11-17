import { asc, eq } from 'drizzle-orm';
import type { AnyDb } from '@/lib/db-types';
import { users, userPageAccess } from '@/db/schema/auth';
import { HebrewRefusal, type HebrewConstraints } from '@/lib/errors/hebrew';
import { isBlank } from '@/lib/text/normalize';
import { hashPassword } from './password';
import { ADMIN_ROLE, accessMapOf, type AccessMap } from './access';
import {
  MIN_PASSWORD_LENGTH, isAccessLevel, isPageKey, type AccessLevel, type PageKey,
} from './pages';

export { MIN_PASSWORD_LENGTH } from './pages';

/**
 * What משתמשים והרשאות reads and writes. Every refusal here is a
 * `HebrewRefusal`, because each one is a sentence for the lead on that page
 * and not a stack-trace note; the action boundary returns it verbatim.
 */

/** The one constraint the insert can still hit after the checks below. */
export const USER_CONSTRAINTS: HebrewConstraints = [
  ['users_email_unique', 'כבר קיים חשבון עם הכתובת הזו.'],
];

export interface UserRow {
  id: string;
  email: string;
  admin: boolean;
  createdAt: Date;
  pages: AccessMap;
}

export async function listUsers(db: AnyDb): Promise<UserRow[]> {
  const rows = await db
    .select({ id: users.id, email: users.email, role: users.role, createdAt: users.createdAt })
    .from(users)
    .orderBy(asc(users.email));
  const grants = await db
    .select({ userId: userPageAccess.userId, page: userPageAccess.page, level: userPageAccess.level })
    .from(userPageAccess);

  return rows.map((row) => ({
    id: row.id,
    email: row.email,
    admin: row.role === ADMIN_ROLE,
    createdAt: row.createdAt,
    pages: row.role === ADMIN_ROLE
      ? {}
      : accessMapOf(grants.filter((grant) => grant.userId === row.id)),
  }));
}

export interface NewUser {
  email: string;
  password: string;
  admin: boolean;
  pages: AccessMap;
}

function cleanEmail(raw: string): string {
  if (isBlank(raw)) throw new HebrewRefusal('יש להזין כתובת אימייל.');
  const email = raw.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new HebrewRefusal('כתובת האימייל אינה תקינה.');
  }
  return email;
}

function checkPassword(password: string): void {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    throw new HebrewRefusal(`הסיסמה חייבת להכיל לפחות ${MIN_PASSWORD_LENGTH} תווים.`);
  }
}

/**
 * Only known pages at known levels reach the table. A key the registry does
 * not hold is refused rather than stored: a grant to a page that does not
 * exist would sit in the table as a decision nobody could see or undo.
 */
function cleanPages(pages: AccessMap): Array<{ page: PageKey; level: AccessLevel }> {
  const out: Array<{ page: PageKey; level: AccessLevel }> = [];
  for (const [page, level] of Object.entries(pages)) {
    if (level === undefined) continue;
    if (!isPageKey(page)) throw new HebrewRefusal(`עמוד לא מוכר: ${page}`);
    if (!isAccessLevel(level)) throw new HebrewRefusal(`רמת הרשאה לא מוכרת: ${level}`);
    out.push({ page, level });
  }
  return out;
}

/** Returns the new account's id. */
export async function createUser(db: AnyDb, input: NewUser): Promise<string> {
  const email = cleanEmail(input.email);
  checkPassword(input.password);
  const pages = input.admin ? [] : cleanPages(input.pages);

  const passwordHash = await hashPassword(input.password);
  const [row] = await db
    .insert(users)
    .values({ email, passwordHash, role: input.admin ? ADMIN_ROLE : 'viewer' })
    .returning();

  if (pages.length > 0) {
    await db.insert(userPageAccess).values(pages.map((grant) => ({ userId: row.id, ...grant })));
  }
  return row.id;
}

async function findUser(db: AnyDb, userId: string): Promise<{ id: string; email: string; role: string }> {
  const [row] = await db
    .select({ id: users.id, email: users.email, role: users.role })
    .from(users)
    .where(eq(users.id, userId));
  if (!row) throw new HebrewRefusal('החשבון לא נמצא.');
  return row;
}

export interface AccessChange {
  /** Who is making the change — the one account it may not lock out. */
  actorEmail: string;
  userId: string;
  admin: boolean;
  pages: AccessMap;
}

/**
 * Replaces the account's role and every one of its grants with what the
 * drawer holds. The acting admin may not take the admin role off their own
 * account: there is always at least one admin, and the only way to reach
 * zero is through the account that is itself doing the removing.
 */
export async function setUserAccess(db: AnyDb, change: AccessChange): Promise<void> {
  const user = await findUser(db, change.userId);
  if (user.email === change.actorEmail && !change.admin) {
    throw new HebrewRefusal('אי אפשר להסיר את הרשאת הניהול מהחשבון המחובר כרגע.');
  }
  const pages = change.admin ? [] : cleanPages(change.pages);

  await db.update(users)
    .set({ role: change.admin ? ADMIN_ROLE : 'viewer' })
    .where(eq(users.id, user.id));
  await db.delete(userPageAccess).where(eq(userPageAccess.userId, user.id));
  if (pages.length > 0) {
    await db.insert(userPageAccess).values(pages.map((grant) => ({ userId: user.id, ...grant })));
  }
}

export async function setUserPassword(db: AnyDb, userId: string, password: string): Promise<void> {
  const user = await findUser(db, userId);
  checkPassword(password);
  const passwordHash = await hashPassword(password);
  await db.update(users).set({ passwordHash }).where(eq(users.id, user.id));
}

/** The grants go with the row (`onDelete: 'cascade'`). */
export async function deleteUser(
  db: AnyDb, change: { actorEmail: string; userId: string },
): Promise<void> {
  const user = await findUser(db, change.userId);
  if (user.email === change.actorEmail) {
    throw new HebrewRefusal('אי אפשר למחוק את החשבון המחובר כרגע.');
  }
  await db.delete(users).where(eq(users.id, user.id));
}

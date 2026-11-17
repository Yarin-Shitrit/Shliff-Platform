import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Session } from 'next-auth';
import { createTestDb, type TestDb } from '@/test/db';
import { users, userPageAccess } from '@/db/schema/auth';

const { sessionRef, dbRef, dbProxy } = vi.hoisted(() => {
  const sessionRef = { current: null as Session | null };
  const dbRef: { current: TestDb | null } = { current: null };
  const dbProxy = new Proxy({} as TestDb, {
    get(_target, property) {
      const db = dbRef.current;
      if (!db) throw new Error('test database not initialised');
      const value = Reflect.get(db, property) as unknown;
      return typeof value === 'function' ? value.bind(db) : value;
    },
  });
  return { sessionRef, dbRef, dbProxy };
});

/**
 * `guard.ts` reads its session from `@/lib/auth/config`, the Node-runtime
 * NextAuth instance — importing that for real pulls in argon2 and the whole
 * Credentials provider. `auth()` is the only thing the guard uses from it,
 * so it is the only thing stubbed. The database is real: a PGlite instance
 * behind `@/db`, because what the guard decides is read from `users` and
 * `user_page_access` on every call, never from the session's own claims.
 */
vi.mock('@/lib/auth/config', () => ({ auth: async () => sessionRef.current }));
vi.mock('@/db', () => ({ db: dbProxy }));

import { currentUser, requireAdmin } from '@/lib/auth/guard';

function session(user: { email?: string; role?: string } | undefined): Session {
  return { user, expires: '' } as Session;
}

async function account(email: string, role: string, pages: Array<[string, string]> = []): Promise<void> {
  const [row] = await (dbRef.current!).insert(users).values({ email, passwordHash: 'x', role }).returning();
  if (pages.length > 0) {
    await (dbRef.current!).insert(userPageAccess)
      .values(pages.map(([page, level]) => ({ userId: row.id, page, level })));
  }
}

describe('requireAdmin', () => {
  beforeEach(async () => {
    sessionRef.current = null;
    dbRef.current = await createTestDb();
    await account('admin@example.com', 'admin');
    await account('noa@example.com', 'viewer', [['people', 'view'], ['dues', 'edit']]);
  });

  it('refuses when there is no session at all', async () => {
    expect(await requireAdmin()).toEqual({ ok: false });
    expect(await requireAdmin('people')).toEqual({ ok: false });
  });

  it('refuses a session that carries no email, even with the admin role', async () => {
    sessionRef.current = session({ role: 'admin' });
    expect(await requireAdmin()).toEqual({ ok: false });
  });

  /**
   * The session's `role` claim is set at sign-in and lives as long as the
   * token does. A grant taken away on משתמשים והרשאות has to hold on the
   * next request, so the row is what decides and the claim is ignored.
   */
  it('decides from the database, never from the session claim', async () => {
    sessionRef.current = session({ email: 'noa@example.com', role: 'admin' });
    expect(await requireAdmin()).toEqual({ ok: false });
    sessionRef.current = session({ email: 'admin@example.com', role: 'viewer' });
    expect(await requireAdmin()).toMatchObject({ ok: true, admin: true });
  });

  it('refuses a session whose account no longer exists', async () => {
    sessionRef.current = session({ email: 'gone@example.com', role: 'admin' });
    expect(await requireAdmin()).toEqual({ ok: false });
    expect(await requireAdmin('people')).toEqual({ ok: false });
  });

  it('bare: admits the admin role alone, returning the email the audit trail is written with', async () => {
    sessionRef.current = session({ email: 'admin@example.com' });
    expect(await requireAdmin()).toEqual({ ok: true, email: 'admin@example.com', level: 'edit', admin: true });
    sessionRef.current = session({ email: 'noa@example.com' });
    expect(await requireAdmin()).toEqual({ ok: false });
  });

  it('with a page: admits an admin at edit on every page', async () => {
    sessionRef.current = session({ email: 'admin@example.com' });
    expect(await requireAdmin('money', 'edit')).toEqual({ ok: true, email: 'admin@example.com', level: 'edit', admin: true });
  });

  it('with a page: admits a granted account to view where it has view, and refuses it edit there', async () => {
    sessionRef.current = session({ email: 'noa@example.com' });
    expect(await requireAdmin('people')).toEqual({ ok: true, email: 'noa@example.com', level: 'view', admin: false });
    expect(await requireAdmin('people', 'view')).toMatchObject({ ok: true });
    expect(await requireAdmin('people', 'edit')).toEqual({ ok: false });
  });

  it('with a page: admits a granted account to edit where it has edit, which includes view', async () => {
    sessionRef.current = session({ email: 'noa@example.com' });
    expect(await requireAdmin('dues', 'edit')).toEqual({ ok: true, email: 'noa@example.com', level: 'edit', admin: false });
    expect(await requireAdmin('dues')).toMatchObject({ ok: true, level: 'edit' });
  });

  it('with a page: refuses a granted account on a page it has no row for, at either level', async () => {
    sessionRef.current = session({ email: 'noa@example.com' });
    expect(await requireAdmin('money')).toEqual({ ok: false });
    expect(await requireAdmin('money', 'edit')).toEqual({ ok: false });
  });
});

describe('currentUser', () => {
  beforeEach(async () => {
    sessionRef.current = null;
    dbRef.current = await createTestDb();
    await account('noa@example.com', 'viewer', [['people', 'view']]);
  });

  it('is nobody without a session, and nobody for an address with no account', async () => {
    expect(await currentUser()).toBeNull();
    sessionRef.current = session({ email: 'gone@example.com' });
    expect(await currentUser()).toBeNull();
  });

  it('hands back the account and what it may open', async () => {
    sessionRef.current = session({ email: 'noa@example.com' });
    expect(await currentUser()).toMatchObject({ email: 'noa@example.com', admin: false, pages: { people: 'view' } });
  });
});

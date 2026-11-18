import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createTestDb, type TestDb } from '@/test/db';
import { users, userPageAccess } from '@/db/schema/auth';
import type { AdminCheck } from '@/lib/auth/guard';
import { loadGrants } from '@/lib/auth/access';

/**
 * The same shape as `shell/actions.test.ts`: `@/db` is a proxy onto
 * whichever PGlite instance the current test built, and the guard is a ref
 * each test sets. The actions are then genuinely database-backed — what is
 * under test is the boundary: the refusal in Hebrew, and the layout
 * revalidated so the rail follows a changed grant.
 */
const { dbRef, adminRef, dbProxy, revalidatePath } = vi.hoisted(() => {
  const dbRef: { current: TestDb | null } = { current: null };
  const adminRef: { current: AdminCheck } = {
    current: { ok: true, email: 'shira@shliff.camp', level: 'edit', admin: true },
  };
  const dbProxy = new Proxy({} as TestDb, {
    get(_target, property) {
      const db = dbRef.current;
      if (!db) throw new Error('test database not initialised');
      const value = Reflect.get(db, property) as unknown;
      return typeof value === 'function' ? value.bind(db) : value;
    },
  });
  return { dbRef, adminRef, dbProxy, revalidatePath: vi.fn() };
});

vi.mock('@/db', () => ({ db: dbProxy }));
vi.mock('@/lib/auth/guard', () => ({ requireAdmin: async () => adminRef.current }));
vi.mock('next/cache', () => ({ revalidatePath }));

import {
  createUserAction, deleteUserAction, setUserAccessAction, setUserPasswordAction,
} from './actions';

const PASSWORD = 'correct horse battery';

async function actor(): Promise<string> {
  const [row] = await dbRef.current!.insert(users)
    .values({ email: 'shira@shliff.camp', passwordHash: 'x', role: 'admin' }).returning();
  return row.id;
}

describe('the users actions', () => {
  beforeEach(async () => {
    dbRef.current = await createTestDb();
    adminRef.current = { ok: true, email: 'shira@shliff.camp', level: 'edit', admin: true };
    revalidatePath.mockClear();
  });

  it('refuse anyone but an admin, in Hebrew, and write nothing', async () => {
    adminRef.current = { ok: false };
    const results = await Promise.all([
      createUserAction({ email: 'noa@shliff.camp', password: PASSWORD, admin: false, pages: {} }),
      setUserAccessAction('6f1c0e0e-0000-4000-8000-000000000000', { admin: false, pages: {} }),
      setUserPasswordAction('6f1c0e0e-0000-4000-8000-000000000000', PASSWORD),
      deleteUserAction('6f1c0e0e-0000-4000-8000-000000000000'),
    ]);
    for (const result of results) expect(result).toEqual({ ok: false, error: 'אין הרשאה' });
    expect(await dbRef.current!.select().from(users)).toEqual([]);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('create an account, hand back its id, and refresh the whole layout so the rail follows', async () => {
    const result = await createUserAction({
      email: 'noa@shliff.camp', password: PASSWORD, admin: false, pages: { people: 'view' },
    });
    expect(result.ok).toBe(true);
    const grants = await loadGrants(dbRef.current!, 'noa@shliff.camp');
    expect(grants).toMatchObject({ admin: false, pages: { people: 'view' } });
    expect(result).toEqual({ ok: true, value: grants!.id });
    expect(revalidatePath).toHaveBeenCalledWith('/', 'layout');
  });

  it('name a duplicate address in Hebrew, from the constraint and not from the SQL', async () => {
    await createUserAction({ email: 'noa@shliff.camp', password: PASSWORD, admin: false, pages: {} });
    const result = await createUserAction({ email: 'noa@shliff.camp', password: PASSWORD, admin: false, pages: {} });
    expect(result).toEqual({ ok: false, error: 'כבר קיים חשבון עם הכתובת הזו.' });
  });

  it('pass a refusal from the library through verbatim', async () => {
    const result = await createUserAction({ email: 'noa', password: PASSWORD, admin: false, pages: {} });
    expect(result).toEqual({ ok: false, error: 'כתובת האימייל אינה תקינה.' });
  });

  it('change a grid, and refuse the acting admin their own demotion', async () => {
    const self = await actor();
    const created = await createUserAction({ email: 'noa@shliff.camp', password: PASSWORD, admin: false, pages: {} });
    const noaId = (created as { value: string }).value;

    expect(await setUserAccessAction(noaId, { admin: false, pages: { dues: 'edit' } })).toEqual({ ok: true });
    expect(await loadGrants(dbRef.current!, 'noa@shliff.camp')).toMatchObject({ pages: { dues: 'edit' } });

    expect(await setUserAccessAction(self, { admin: false, pages: {} }))
      .toEqual({ ok: false, error: 'אי אפשר להסיר את הרשאת הניהול מהחשבון המחובר כרגע.' });
  });

  it('replace a password without touching the grid', async () => {
    const created = await createUserAction({ email: 'noa@shliff.camp', password: PASSWORD, admin: false, pages: { people: 'view' } });
    const noaId = (created as { value: string }).value;
    expect(await setUserPasswordAction(noaId, 'another long secret')).toEqual({ ok: true });
    expect(await setUserPasswordAction(noaId, 'short')).toEqual({ ok: false, error: 'הסיסמה חייבת להכיל לפחות 8 תווים.' });
    expect(await loadGrants(dbRef.current!, 'noa@shliff.camp')).toMatchObject({ pages: { people: 'view' } });
  });

  it('delete an account with its rows, and refuse the acting admin their own deletion', async () => {
    const self = await actor();
    const created = await createUserAction({ email: 'noa@shliff.camp', password: PASSWORD, admin: false, pages: { people: 'view' } });
    const noaId = (created as { value: string }).value;

    expect(await deleteUserAction(noaId)).toEqual({ ok: true });
    expect(await loadGrants(dbRef.current!, 'noa@shliff.camp')).toBeNull();
    expect(await dbRef.current!.select().from(userPageAccess)).toEqual([]);

    expect(await deleteUserAction(self)).toEqual({ ok: false, error: 'אי אפשר למחוק את החשבון המחובר כרגע.' });
  });
});

import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb, type TestDb } from '@/test/db';
import { users, userPageAccess } from '@/db/schema/auth';
import { accessMapOf, loadGrants } from './access';

let db: TestDb;

async function account(email: string, role: string): Promise<string> {
  const [row] = await db.insert(users).values({ email, passwordHash: 'x', role }).returning();
  return row.id;
}

describe('loadGrants', () => {
  beforeEach(async () => {
    db = await createTestDb();
  });

  it('answers null for an address with no account — a session outliving its row is nobody', async () => {
    expect(await loadGrants(db, 'ghost@shliff.camp')).toBeNull();
  });

  it('reads the admin role as admin, with no rows to consult', async () => {
    const id = await account('shira@shliff.camp', 'admin');
    // A stray row on an admin changes nothing: the role answers first.
    await db.insert(userPageAccess).values({ userId: id, page: 'people', level: 'view' });
    expect(await loadGrants(db, 'shira@shliff.camp'))
      .toEqual({ id, email: 'shira@shliff.camp', admin: true, pages: {} });
  });

  it('reads any other role as the rows it has, and only those', async () => {
    const id = await account('noa@shliff.camp', 'viewer');
    await db.insert(userPageAccess).values([
      { userId: id, page: 'people', level: 'view' },
      { userId: id, page: 'dues', level: 'edit' },
    ]);
    expect(await loadGrants(db, 'noa@shliff.camp'))
      .toEqual({ id, email: 'noa@shliff.camp', admin: false, pages: { people: 'view', dues: 'edit' } });
  });

  it('reads an account with no rows as closed everywhere, not as an error', async () => {
    const id = await account('new@shliff.camp', 'viewer');
    expect(await loadGrants(db, 'new@shliff.camp')).toEqual({ id, email: 'new@shliff.camp', admin: false, pages: {} });
  });

  it('drops a row for a page the registry no longer knows, keeping the rest', async () => {
    const id = await account('old@shliff.camp', 'viewer');
    await db.insert(userPageAccess).values([
      { userId: id, page: 'retired-page', level: 'edit' },
      { userId: id, page: 'tasks', level: 'owner' },
      { userId: id, page: 'tasks', level: 'view' },
    ].filter((row, index, all) => all.findIndex((r) => r.page === row.page) === index));
    const grants = await loadGrants(db, 'old@shliff.camp');
    expect(grants?.pages).toEqual({});
  });

  it('takes the grants with the account when the account goes', async () => {
    const id = await account('gone@shliff.camp', 'viewer');
    await db.insert(userPageAccess).values({ userId: id, page: 'people', level: 'view' });
    await db.delete(users).where((await import('drizzle-orm')).eq(users.id, id));
    expect(await db.select().from(userPageAccess)).toEqual([]);
  });
});

describe('accessMapOf', () => {
  it('keeps known pages at known levels and nothing else', () => {
    expect(accessMapOf([
      { page: 'people', level: 'view' },
      { page: 'people', level: 'edit' },
      { page: 'nowhere', level: 'view' },
      { page: 'dues', level: 'all' },
    ])).toEqual({ people: 'edit' });
  });
});

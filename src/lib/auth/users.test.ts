import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDb, type TestDb } from '@/test/db';
import { users, userPageAccess } from '@/db/schema/auth';
import { isHebrewRefusal } from '@/lib/errors/hebrew';
import { verifyPassword } from './password';
import { loadGrants } from './access';
import {
  MIN_PASSWORD_LENGTH, createUser, deleteUser, listUsers, setUserAccess, setUserPassword,
} from './users';

let db: TestDb;

const PASSWORD = 'correct horse battery';

async function refusal(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    if (isHebrewRefusal(error)) return error.message;
    throw error;
  }
  throw new Error('expected a refusal');
}

describe('createUser', () => {
  beforeEach(async () => {
    db = await createTestDb();
  });

  it('creates a granted account with exactly the rows asked for, and a hash rather than the password', async () => {
    const id = await createUser(db, {
      email: ' noa@shliff.camp ', password: PASSWORD, admin: false, pages: { people: 'view', dues: 'edit' },
    });
    const [row] = await db.select().from(users).where(eq(users.id, id));
    expect(row.email).toBe('noa@shliff.camp');
    expect(row.role).toBe('viewer');
    expect(row.passwordHash).not.toContain(PASSWORD);
    expect(await verifyPassword(row.passwordHash, PASSWORD)).toBe(true);
    expect(await loadGrants(db, 'noa@shliff.camp')).toMatchObject({ admin: false, pages: { people: 'view', dues: 'edit' } });
  });

  it('creates an admin with the role and no rows, whatever grid was sent', async () => {
    const id = await createUser(db, {
      email: 'shira@shliff.camp', password: PASSWORD, admin: true, pages: { people: 'view' },
    });
    const [row] = await db.select().from(users).where(eq(users.id, id));
    expect(row.role).toBe('admin');
    expect(await db.select().from(userPageAccess)).toEqual([]);
  });

  it('refuses a blank address, a malformed one, and a short password — in Hebrew, creating nothing', async () => {
    expect(await refusal(() => createUser(db, { email: '  ', password: PASSWORD, admin: false, pages: {} })))
      .toBe('יש להזין כתובת אימייל.');
    expect(await refusal(() => createUser(db, { email: 'noa', password: PASSWORD, admin: false, pages: {} })))
      .toBe('כתובת האימייל אינה תקינה.');
    expect(await refusal(() => createUser(db, { email: 'noa@shliff.camp', password: 'short', admin: false, pages: {} })))
      .toBe(`הסיסמה חייבת להכיל לפחות ${MIN_PASSWORD_LENGTH} תווים.`);
    expect(await db.select().from(users)).toEqual([]);
  });

  it('refuses a grant to a page the registry does not know, rather than storing it', async () => {
    const pages = { nowhere: 'edit' } as unknown as Parameters<typeof createUser>[1]['pages'];
    expect(await refusal(() => createUser(db, { email: 'noa@shliff.camp', password: PASSWORD, admin: false, pages })))
      .toBe('עמוד לא מוכר: nowhere');
    expect(await db.select().from(users)).toEqual([]);
  });

  it('lets the unique constraint name a duplicate address', async () => {
    await createUser(db, { email: 'noa@shliff.camp', password: PASSWORD, admin: false, pages: {} });
    await expect(createUser(db, { email: 'noa@shliff.camp', password: PASSWORD, admin: false, pages: {} }))
      .rejects.toThrow();
  });
});

describe('listUsers', () => {
  beforeEach(async () => {
    db = await createTestDb();
  });

  it('lists every account by address, each with its own grants', async () => {
    await createUser(db, { email: 'noa@shliff.camp', password: PASSWORD, admin: false, pages: { people: 'view' } });
    await createUser(db, { email: 'avi@shliff.camp', password: PASSWORD, admin: true, pages: {} });
    await createUser(db, { email: 'dana@shliff.camp', password: PASSWORD, admin: false, pages: {} });
    const rows = await listUsers(db);
    expect(rows.map((row) => [row.email, row.admin, row.pages])).toEqual([
      ['avi@shliff.camp', true, {}],
      ['dana@shliff.camp', false, {}],
      ['noa@shliff.camp', false, { people: 'view' }],
    ]);
    expect(rows[0].createdAt).toBeInstanceOf(Date);
  });
});

describe('setUserAccess', () => {
  const actor = 'shira@shliff.camp';
  let actorId: string;
  let noaId: string;

  beforeEach(async () => {
    db = await createTestDb();
    actorId = await createUser(db, { email: actor, password: PASSWORD, admin: true, pages: {} });
    noaId = await createUser(db, { email: 'noa@shliff.camp', password: PASSWORD, admin: false, pages: { people: 'view' } });
  });

  it('replaces the grid whole: a page left out is closed, a page added is open', async () => {
    await setUserAccess(db, { actorEmail: actor, userId: noaId, admin: false, pages: { dues: 'edit', tasks: 'view' } });
    expect(await loadGrants(db, 'noa@shliff.camp')).toMatchObject({ admin: false, pages: { dues: 'edit', tasks: 'view' } });
  });

  it('promotes to admin and clears the rows, and demotes back to exactly the grid sent', async () => {
    await setUserAccess(db, { actorEmail: actor, userId: noaId, admin: true, pages: {} });
    expect(await loadGrants(db, 'noa@shliff.camp')).toMatchObject({ admin: true, pages: {} });
    expect(await db.select().from(userPageAccess)).toEqual([]);

    await setUserAccess(db, { actorEmail: actor, userId: noaId, admin: false, pages: { home: 'view' } });
    expect(await loadGrants(db, 'noa@shliff.camp')).toMatchObject({ admin: false, pages: { home: 'view' } });
  });

  it('refuses to take the admin role off the account doing the taking', async () => {
    expect(await refusal(() => setUserAccess(db, { actorEmail: actor, userId: actorId, admin: false, pages: {} })))
      .toBe('אי אפשר להסיר את הרשאת הניהול מהחשבון המחובר כרגע.');
    expect(await loadGrants(db, actor)).toMatchObject({ admin: true });
  });

  it('refuses an account that does not exist, in Hebrew', async () => {
    expect(await refusal(() => setUserAccess(db, {
      actorEmail: actor, userId: '6f1c0e0e-0000-4000-8000-000000000000', admin: false, pages: {},
    }))).toBe('החשבון לא נמצא.');
  });
});

describe('setUserPassword / deleteUser', () => {
  const actor = 'shira@shliff.camp';
  let actorId: string;
  let noaId: string;

  beforeEach(async () => {
    db = await createTestDb();
    actorId = await createUser(db, { email: actor, password: PASSWORD, admin: true, pages: {} });
    noaId = await createUser(db, { email: 'noa@shliff.camp', password: PASSWORD, admin: false, pages: { people: 'view' } });
  });

  it('replaces the password, so the old one stops working and the new one works', async () => {
    await setUserPassword(db, noaId, 'a brand new secret');
    const [row] = await db.select().from(users).where(eq(users.id, noaId));
    expect(await verifyPassword(row.passwordHash, PASSWORD)).toBe(false);
    expect(await verifyPassword(row.passwordHash, 'a brand new secret')).toBe(true);
  });

  it('refuses a short replacement and keeps the old one', async () => {
    expect(await refusal(() => setUserPassword(db, noaId, 'short')))
      .toBe(`הסיסמה חייבת להכיל לפחות ${MIN_PASSWORD_LENGTH} תווים.`);
    const [row] = await db.select().from(users).where(eq(users.id, noaId));
    expect(await verifyPassword(row.passwordHash, PASSWORD)).toBe(true);
  });

  it('deletes an account and its grants with it', async () => {
    await deleteUser(db, { actorEmail: actor, userId: noaId });
    expect(await loadGrants(db, 'noa@shliff.camp')).toBeNull();
    expect(await db.select().from(userPageAccess)).toEqual([]);
  });

  it('refuses to delete the account doing the deleting', async () => {
    expect(await refusal(() => deleteUser(db, { actorEmail: actor, userId: actorId })))
      .toBe('אי אפשר למחוק את החשבון המחובר כרגע.');
    expect(await loadGrants(db, actor)).not.toBeNull();
  });
});

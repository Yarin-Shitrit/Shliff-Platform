/**
 * The contract of `createTestDb()`, stated as tests, because the helper now
 * reuses one Postgres per worker instead of booting one per test and the
 * suites that depend on it were written against fresh instances.
 *
 * What a suite may assume, and what this file holds it to:
 *
 * - every migrated table is there and empty, whatever the previous test did;
 * - a schema change in one test is not visible to the next;
 * - a broken instance is replaced, not handed back.
 *
 * The fingerprint must notice each kind of change a test can make to the
 * shape of the database. Each case here is one such kind; if a new one
 * appears in a suite, add it here first and watch it fail.
 */
import { describe, it, expect } from 'vitest';
import { sql } from 'drizzle-orm';
import { createTestDb } from './db';
import { persons, seasons } from '@/db/schema/camp';
import { accounts } from '@/db/schema/money';

async function constraintNames(db: Awaited<ReturnType<typeof createTestDb>>) {
  const rows = await db.execute<{ conname: string }>(sql`
    select conname from pg_constraint where connamespace = 'public'::regnamespace order by conname
  `);
  return rows.rows.map((r) => r.conname);
}

async function tableNames(db: Awaited<ReturnType<typeof createTestDb>>) {
  const rows = await db.execute<{ relname: string }>(sql`
    select relname from pg_class
     where relnamespace = 'public'::regnamespace and relkind = 'r' order by relname
  `);
  return rows.rows.map((r) => r.relname);
}

describe('createTestDb — rows never survive into the next call', () => {
  it('starts empty after the previous call wrote rows', async () => {
    const first = await createTestDb();
    await first.insert(persons).values({ displayName: 'אופק' });
    await first.insert(seasons).values({ name: 'ברן 26', year: 2026, flatRate: '1200.00' });
    expect(await first.select().from(persons)).toHaveLength(1);

    const second = await createTestDb();
    expect(await second.select().from(persons)).toEqual([]);
    expect(await second.select().from(seasons)).toEqual([]);
    expect(await second.select().from(accounts)).toEqual([]);
  });

  it('empties every table in one go, whichever side of a foreign key it is on', async () => {
    const db = await createTestDb();
    const [season] = await db.insert(seasons)
      .values({ name: 'ברן 26', year: 2026, flatRate: '1200.00' }).returning();
    const [person] = await db.insert(persons).values({ displayName: 'נועה' }).returning();
    await db.execute(sql`
      insert into memberships (person_id, season_id) values (${person.id}, ${season.id})
    `);

    const next = await createTestDb();
    for (const table of await tableNames(next)) {
      const { rows } = await next.execute<{ n: number }>(
        sql.raw(`select count(*)::int as n from "${table}"`),
      );
      expect(rows[0].n, table).toBe(0);
    }
  });

  it('hands back the same instance when nothing changed its shape', async () => {
    const a = await createTestDb();
    await a.insert(persons).values({ displayName: 'אופק' });
    const b = await createTestDb();
    // Same drizzle handle is the whole point: a truncate, not a boot.
    expect(b).toBe(a);
  });
});

describe('createTestDb — a schema change in one test never reaches the next', () => {
  it('restores a foreign key a test dropped', async () => {
    const db = await createTestDb();
    const before = await constraintNames(db);
    expect(before).toContain('memberships_person_id_persons_id_fk');
    await db.execute(sql.raw(
      'ALTER TABLE memberships DROP CONSTRAINT memberships_person_id_persons_id_fk',
    ));
    expect(await constraintNames(db)).not.toContain('memberships_person_id_persons_id_fk');

    const next = await createTestDb();
    expect(next).not.toBe(db);
    expect(await constraintNames(next)).toEqual(before);
  });

  it('removes a check constraint a test added', async () => {
    const db = await createTestDb();
    const before = await constraintNames(db);
    await db.execute(sql.raw(
      "ALTER TABLE persons ADD CONSTRAINT test_no_boom CHECK (display_name <> 'בום')",
    ));

    const next = await createTestDb();
    expect(await constraintNames(next)).toEqual(before);
    await expect(next.insert(persons).values({ displayName: 'בום' })).resolves.toBeDefined();
  });

  it('drops a table a test created', async () => {
    const db = await createTestDb();
    const before = await tableNames(db);
    await db.execute(sql.raw(
      'CREATE TABLE test_pin (person_id uuid NOT NULL REFERENCES persons(id) ON DELETE RESTRICT)',
    ));

    const next = await createTestDb();
    expect(await tableNames(next)).toEqual(before);
  });

  it('drops a column a test added', async () => {
    const db = await createTestDb();
    await db.execute(sql.raw('ALTER TABLE persons ADD COLUMN test_extra text'));

    const next = await createTestDb();
    const { rows } = await next.execute<{ attname: string }>(sql`
      select attname from pg_attribute
       where attrelid = 'persons'::regclass and attname = 'test_extra' and not attisdropped
    `);
    expect(rows).toEqual([]);
  });

  it('forgets a default a test changed', async () => {
    const db = await createTestDb();
    await db.execute(sql.raw("ALTER TABLE persons ALTER COLUMN display_name SET DEFAULT 'x'"));

    const next = await createTestDb();
    const { rows } = await next.execute<{ def: string | null }>(sql`
      select pg_get_expr(d.adbin, d.adrelid) as def
        from pg_attribute a
        left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
       where a.attrelid = 'persons'::regclass and a.attname = 'display_name'
    `);
    expect(rows[0].def).toBeNull();
  });

  it('drops an index a test created', async () => {
    const db = await createTestDb();
    await db.execute(sql.raw('CREATE INDEX test_idx ON persons (display_name)'));

    const next = await createTestDb();
    const { rows } = await next.execute(sql`
      select 1 from pg_class where relname = 'test_idx'
    `);
    expect(rows).toEqual([]);
  });
});

describe('createTestDb — an instance the last test broke is replaced', () => {
  it('does not hand back a closed backend', async () => {
    const db = await createTestDb();
    // Drizzle's pglite driver keeps the client on `$client`.
    await db.$client.close();

    const next = await createTestDb();
    expect(next).not.toBe(db);
    expect(await next.select().from(persons)).toEqual([]);
  });
});

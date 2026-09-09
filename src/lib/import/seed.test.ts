import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb, type TestDb } from '@/test/db';
import { uploads, sheets } from '@/db/schema/source';
import { seedReferenceWorkbooks } from '@/lib/import/seed';

describe('seedReferenceWorkbooks', () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await createTestDb();
  });

  it('imports all three reference workbooks', async () => {
    const result = await seedReferenceWorkbooks(db);
    expect(result.imported).toHaveLength(3);
    expect(result.skipped).toHaveLength(0);
    expect(await db.select().from(uploads)).toHaveLength(3);
    expect(await db.select().from(sheets)).toHaveLength(19);
  });

  it('is idempotent — seeding twice does not duplicate anything', async () => {
    await seedReferenceWorkbooks(db);
    const second = await seedReferenceWorkbooks(db);

    expect(second.imported).toHaveLength(0);
    expect(second.skipped).toHaveLength(3);
    expect(await db.select().from(uploads)).toHaveLength(3);
    expect(await db.select().from(sheets)).toHaveLength(19);
  });
});

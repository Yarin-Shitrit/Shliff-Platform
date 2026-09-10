import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import * as source from '@/db/schema/source';
import * as camp from '@/db/schema/camp';

export type TestDb = ReturnType<typeof drizzle<typeof source & typeof camp>>;

/**
 * Creates a fresh in-memory Postgres with the current migrations applied.
 * Each test gets its own instance, so tests never share state.
 */
export async function createTestDb(): Promise<TestDb> {
  const client = new PGlite();
  const dir = join(process.cwd(), 'drizzle');
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();

  for (const file of files) {
    const sql = readFileSync(join(dir, file), 'utf8');
    for (const statement of sql.split('--> statement-breakpoint')) {
      const trimmed = statement.trim();
      if (trimmed) await client.exec(trimmed);
    }
  }

  return drizzle(client, { schema: { ...source, ...camp } });
}

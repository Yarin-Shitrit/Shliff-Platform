import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import * as source from '@/db/schema/source';
import * as camp from '@/db/schema/camp';
import * as money from '@/db/schema/money';

export type TestDb = ReturnType<typeof drizzle<typeof source & typeof camp & typeof money>>;

/**
 * Gives a test an empty Postgres with the current migrations applied.
 *
 * The contract is the one every suite was written against: what comes back
 * holds every migrated table and no rows, and nothing one test wrote is
 * visible to the next. What changed is how that is paid for.
 *
 * Booting a PGlite instance costs about a second on the dev box — the
 * WebAssembly Postgres, not the migrations, which add a fifth of that. The
 * suite asked for one per test: 857 boots in a full run, 178 s for the
 * promote suite alone, and the `Hook timed out` storm CLAUDE.md describes
 * when four workers boot at once. Truncating 28 tables costs 20 ms.
 *
 * So the worker keeps one instance and hands it back emptied. Vitest
 * isolates each file in its own worker, so the instance is per file, never
 * shared across files, and tests within a file run one at a time.
 *
 * Two things would make a reused instance differ from a fresh one, and the
 * helper checks for both rather than trusting the tests:
 *
 * - A test that alters the schema (promote.test.ts drops a foreign key and
 *   adds check constraints to provoke failures). The schema fingerprint
 *   taken right after the migrations is compared on every call; a mismatch
 *   throws the instance away and boots a fresh one.
 * - An instance the last test left unusable (an aborted transaction, a
 *   crashed backend). Any error on the reset path also falls back to a
 *   fresh boot.
 *
 * Every table uses uuid keys and the migrations insert no rows, so an
 * emptied table and a migrated one are the same thing. `RESTART IDENTITY`
 * is there for the day a sequence appears.
 */
export async function createTestDb(): Promise<TestDb> {
  if (pool) {
    const reused = await resetForReuse(pool);
    if (reused) return pool.db;
    await discard(pool);
  }
  pool = await boot();
  return pool.db;
}

type Pooled = { client: PGlite; db: TestDb; fingerprint: string; tables: string[] };

let pool: Pooled | undefined;

async function boot(): Promise<Pooled> {
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

  const fingerprint = await schemaFingerprint(client);
  const tables = (await client.query<{ name: string }>(
    `select c.relname as name from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r', 'p')`,
  )).rows.map((r) => `"${r.name.replace(/"/g, '""')}"`);

  return {
    client,
    db: drizzle(client, { schema: { ...source, ...camp, ...money } }),
    fingerprint,
    tables,
  };
}

/** Empties the instance in place. `false` means it cannot be trusted. */
async function resetForReuse(p: Pooled): Promise<boolean> {
  try {
    if (p.client.closed) return false;
    if (await schemaFingerprint(p.client) !== p.fingerprint) return false;
    await p.client.exec(`TRUNCATE ${p.tables.join(', ')} RESTART IDENTITY CASCADE`);
    return true;
  } catch {
    return false;
  }
}

async function discard(p: Pooled): Promise<void> {
  try {
    if (!p.client.closed) await p.client.close();
  } catch {
    // A backend that cannot even close is one we are already replacing.
  }
}

/**
 * Everything a test could change about the shape of the database, as one
 * ordered string: relations, columns with their types and defaults,
 * constraints, indexes, triggers, functions, enums and their labels.
 * Row contents are deliberately not part of it — those are what TRUNCATE
 * is for.
 */
async function schemaFingerprint(client: PGlite): Promise<string> {
  const { rows } = await client.query<{ fp: string | null }>(`
    select string_agg(x, '|' order by x) as fp from (
      select 'rel:' || c.relname || ':' || c.relkind::text as x
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public'
      union all
      select 'col:' || a.attrelid::regclass::text || '.' || a.attname || ':'
             || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull::text || ':'
             || coalesce(pg_get_expr(d.adbin, d.adrelid), '')
        from pg_attribute a
        join pg_class c on c.oid = a.attrelid
        join pg_namespace n on n.oid = c.relnamespace
        left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
       where n.nspname = 'public' and a.attnum > 0 and not a.attisdropped
      union all
      select 'con:' || conname || ':' || conrelid::regclass::text || ':' || pg_get_constraintdef(oid)
        from pg_constraint where connamespace = 'public'::regnamespace
      union all
      select 'idx:' || indexrelid::regclass::text || ':' || pg_get_indexdef(indexrelid)
        from pg_index
       where indrelid in (select oid from pg_class where relnamespace = 'public'::regnamespace)
      union all
      select 'trg:' || tgname || ':' || tgrelid::regclass::text || ':' || pg_get_triggerdef(oid)
        from pg_trigger where not tgisinternal
      union all
      select 'fn:' || proname || ':' || pg_get_functiondef(oid)
        from pg_proc where pronamespace = 'public'::regnamespace
      union all
      select 'enum:' || t.typname || ':' || e.enumlabel || ':' || e.enumsortorder::text
        from pg_type t join pg_enum e on e.enumtypid = t.oid
       where t.typnamespace = 'public'::regnamespace
    ) s
  `);
  return rows[0]?.fp ?? '';
}

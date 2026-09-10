import type { Db } from '@/db';
import type { TestDb } from '@/test/db';

/**
 * Either the real Postgres handle or a PGlite test handle.
 *
 * Both imports are type-only and erased at compile time, so importing this
 * never triggers `@/db`'s `DATABASE_URL` check. Every domain module takes
 * `db: AnyDb` as its first parameter rather than importing `@/db` itself —
 * that is what keeps them testable and keeps `@/db` out of the module graph
 * of `'use server'` files.
 */
export type AnyDb = Db | TestDb;

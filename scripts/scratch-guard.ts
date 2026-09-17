/**
 * The guard that keeps `scripts/dry-run-promote.ts` off the live database.
 *
 * It lives in its own module so it can be unit-tested: importing
 * `dry-run-promote.ts` would run it.
 *
 * It is an ALLOWLIST, not a blacklist. A blacklist on "is the name `shliff`?"
 * has two holes, and both of them land on live:
 *
 *  1. `postgres://shliff:pw@localhost:5433` — the clone URL with the database
 *     trimmed off. Its path is empty, so a blacklist reading only
 *     `URL.pathname` sees no name and lets it through. postgres.js then falls
 *     through its own chain to the *username*, which here is `shliff`, and
 *     opens on live.
 *  2. `postgres://shliff:pw@localhost:5433/shliff_evidence?database=shliff` —
 *     the path says the clone, so a path-only check is satisfied. But
 *     postgres.js puts every unrecognised query parameter into
 *     `options.connection`, and `connection.js`'s `StartupMessage` builds
 *     `Object.assign({ user, database, ... }, options.connection)` — so the
 *     query parameter overrides the database in the startup packet and the
 *     session opens on live.
 *
 * So the name is resolved the way postgres.js resolves it and then has to
 * *equal* the expected scratch database. Anything else — including a name
 * this module cannot determine — is refused.
 */

/** The only database `dry-run-promote.ts` is allowed to open. */
export const SCRATCH_DATABASE = 'shliff_evidence';

/**
 * The environment the resolution reads: `PGDATABASE`, `PGUSERNAME`, `PGUSER`.
 *
 * Typed as an open record rather than those three keys so that `process.env`
 * — an index signature — is assignable, while a test can still pass `{}`.
 */
export type DatabaseEnv = Record<string, string | undefined>;

/**
 * The database a `postgres()` call on this URL would actually open.
 *
 * Mirrors `parseOptions` in `node_modules/postgres/cjs/src/index.js`:
 *
 *     database: o.database || o.db || (url.pathname || '').slice(1)
 *               || env.PGDATABASE || user
 *     user:     o.user || o.username || url.username
 *               || env.PGUSERNAME || env.PGUSER || osUsername()
 *
 * with two deliberate differences, both of which can only make this stricter:
 *
 *  - `o.database` / `o.db` are the *options object*, which `@/db` never
 *    passes. The query parameters `?database=` / `?db=` are read in their
 *    place because they reach the same decision by the other route described
 *    in this module's header.
 *  - `osUsername()` is not consulted. A URL that gets that far resolves to ''
 *    here, and `assertScratchDatabase` refuses an empty name outright rather
 *    than guess which database the process would land in.
 *
 * Throws on a string that is not a URL at all, rather than returning a name
 * nobody can act on.
 */
export function resolveDatabaseName(url: string, env: DatabaseEnv = process.env): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('DATABASE_URL is not a valid URL');
  }

  const user = decodeURIComponent(parsed.username)
    || env.PGUSERNAME
    || env.PGUSER
    || '';

  return parsed.searchParams.get('database')
    || parsed.searchParams.get('db')
    || decodeURIComponent(parsed.pathname.replace(/^\//, ''))
    || env.PGDATABASE
    || user;
}

/**
 * Returns the database name, or throws unless it is exactly `expected`.
 *
 * `dry-run-promote.ts` calls this before it imports `@/db`, which builds its
 * client at import time — so a refused URL is never even connected to.
 */
export function assertScratchDatabase(
  url: string,
  expected: string = SCRATCH_DATABASE,
  env: DatabaseEnv = process.env,
): string {
  const name = resolveDatabaseName(url, env);

  if (name === '') {
    throw new Error(
      'refusing to run: DATABASE_URL names no database, and postgres.js would '
      + 'fall through to the operating-system user name to pick one. Point '
      + `DATABASE_URL at ${expected} explicitly.`,
    );
  }
  if (name !== expected) {
    throw new Error(
      `refusing to run against the database "${name}". This script writes `
      + 'season labels, authority flags and block confirmations, so it may '
      + `only run on the scratch clone "${expected}". Create it with: create `
      + `database ${expected} template shliff;`,
    );
  }
  return name;
}

/**
 * The guard that keeps `scripts/dry-run-promote.ts` and `scripts/cutover.ts`
 * off the live database.
 *
 * It lives in its own module so it can be unit-tested: importing either script
 * would run it.
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
 * *equal* one of the expected scratch databases. Anything else — including a
 * name this module cannot determine — is refused.
 *
 * A third hole, found while writing the cutover and closed here: a repeated
 * query key. `URLSearchParams.get('database')` returns the FIRST value, while
 * postgres.js builds its query object by assigning every entry in order
 * (`[...url.searchParams].reduce((a, [k, v]) => (a[k] = v, a), {})`) and so
 * keeps the LAST. `?database=shliff_cutover&database=shliff` therefore read as
 * the clone here and opened live on the wire. `getAll(...).at(-1)` is what
 * matches postgres.js, and it is what this module uses.
 */

/** The clone `dry-run-promote.ts` is allowed to open. */
export const SCRATCH_DATABASE = 'shliff_evidence';

/** The clone `cutover.ts` is allowed to open. It deletes real financial rows,
 *  so it names this one on its own rather than taking the whole allowlist. */
export const CUTOVER_DATABASE = 'shliff_cutover';

/**
 * Every database any script in this directory may open — the allowlist in
 * full, and the default for `assertScratchDatabase`.
 *
 * Listing two names does not widen the guard toward live: both are clones,
 * created with `create database … template shliff`, and `shliff` itself is in
 * neither this list nor any other code path here. A caller that wants a
 * narrower gate passes its own single name.
 */
export const SCRATCH_DATABASES: readonly string[] = [SCRATCH_DATABASE, CUTOVER_DATABASE];

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
 *    in this module's header. Each is read with `getAll(...).at(-1)`, not
 *    `get(...)`: postgres.js's reduce over the entries keeps the last value of
 *    a repeated key, and `get` returns the first.
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

  return parsed.searchParams.getAll('database').at(-1)
    || parsed.searchParams.getAll('db').at(-1)
    || decodeURIComponent(parsed.pathname.replace(/^\//, ''))
    || env.PGDATABASE
    || user;
}

/**
 * Returns the database name, or throws unless it is one of `expected`.
 *
 * `dry-run-promote.ts` and `cutover.ts` both call this before they import
 * `@/db`, which builds its client at import time — so a refused URL is never
 * even connected to.
 */
export function assertScratchDatabase(
  url: string,
  expected: string | readonly string[] = SCRATCH_DATABASES,
  env: DatabaseEnv = process.env,
): string {
  const allowed = typeof expected === 'string' ? [expected] : [...expected];
  const named = allowed.join(', ');
  const name = resolveDatabaseName(url, env);

  if (name === '') {
    throw new Error(
      'refusing to run: DATABASE_URL names no database, and postgres.js would '
      + 'fall through to the operating-system user name to pick one. Point '
      + `DATABASE_URL at ${named} explicitly.`,
    );
  }
  if (!allowed.includes(name)) {
    throw new Error(
      `refusing to run against the database "${name}". This script writes `
      + 'season labels, authority flags and block confirmations, so it may '
      + `only run on a scratch clone: ${named}. Create one with: create `
      + `database ${allowed[0]} template shliff;`,
    );
  }
  return name;
}

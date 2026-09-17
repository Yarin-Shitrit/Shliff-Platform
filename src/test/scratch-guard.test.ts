/**
 * Covers `scripts/scratch-guard.ts` — the allowlist that keeps
 * `scripts/dry-run-promote.ts` off the live database.
 *
 * It lives under `src/` rather than beside the module it tests because
 * `vitest.config.ts` only discovers `src/**` tests, and widening that config
 * while four lanes are editing the repo in parallel buys a merge conflict for
 * no benefit. The import is relative for the same reason: `@/` resolves to
 * `src/`, and the subject is a script.
 */
import { describe, it, expect } from 'vitest';
import {
  SCRATCH_DATABASE, CUTOVER_DATABASE, SCRATCH_DATABASES,
  resolveDatabaseName, assertScratchDatabase,
} from '../../scripts/scratch-guard';

/** The real clone URL, with the password elided. */
const CLONE = `postgres://shliff:pw@localhost:5433/${SCRATCH_DATABASE}`;
const CUTOVER = `postgres://shliff:pw@localhost:5433/${CUTOVER_DATABASE}`;
const LIVE = 'postgres://shliff:pw@localhost:5433/shliff';

describe('resolveDatabaseName — the name postgres.js would actually open', () => {
  it('reads the path when there is one', () => {
    expect(resolveDatabaseName(CLONE, {})).toBe('shliff_evidence');
  });

  it('falls through an absent path to the user name, as postgres.js does', () => {
    // The hole a blacklist on URL.pathname leaves open: the role here IS
    // `shliff`, so this URL opens on live while looking nameless.
    expect(resolveDatabaseName('postgres://shliff:pw@localhost:5433', {})).toBe('shliff');
  });

  it('treats a bare trailing slash as no path at all', () => {
    expect(resolveDatabaseName('postgres://shliff:pw@localhost:5433/', {})).toBe('shliff');
  });

  it('lets ?database= override the path, as the startup packet does', () => {
    expect(resolveDatabaseName(`${CLONE}?database=shliff`, {})).toBe('shliff');
  });

  it('lets ?db= override the path too', () => {
    expect(resolveDatabaseName(`${CLONE}?db=shliff`, {})).toBe('shliff');
  });

  /**
   * The hole this guard shipped with. `URLSearchParams.get` returns the FIRST
   * value for a repeated key; postgres.js builds its query object with
   * `[...url.searchParams].reduce((a, [k, v]) => (a[k] = v, a), {})`, which
   * assigns every entry in order and therefore keeps the LAST. So a URL
   * carrying `?database=shliff_cutover&database=shliff` read the scratch name,
   * passed the allowlist, and then opened live on the wire.
   */
  it('keeps the LAST ?database= of a repeated key, as postgres.js does', () => {
    expect(resolveDatabaseName(`${CLONE}?database=${CUTOVER_DATABASE}&database=shliff`, {}))
      .toBe('shliff');
  });

  it('keeps the LAST ?db= of a repeated key too', () => {
    expect(resolveDatabaseName(`${CLONE}?db=${CUTOVER_DATABASE}&db=shliff`, {}))
      .toBe('shliff');
  });

  /** The same rule in the harmless direction: live first, scratch last, and
   *  the session really does open on the scratch clone. */
  it('keeps the LAST value even when the last one is the scratch clone', () => {
    expect(resolveDatabaseName(`${CLONE}?database=shliff&database=${CUTOVER_DATABASE}`, {}))
      .toBe(CUTOVER_DATABASE);
  });

  it('uses PGDATABASE when the URL carries no path', () => {
    expect(resolveDatabaseName('postgres://shliff:pw@localhost:5433', {
      PGDATABASE: 'shliff',
    })).toBe('shliff');
  });

  it('prefers an explicit path over PGDATABASE', () => {
    expect(resolveDatabaseName(CLONE, { PGDATABASE: 'shliff' })).toBe('shliff_evidence');
  });

  it('ignores an unrelated query parameter', () => {
    expect(resolveDatabaseName(`${LIVE}?sslmode=require`, {})).toBe('shliff');
  });

  it('resolves to an empty string when nothing in the chain names anything', () => {
    expect(resolveDatabaseName('postgres://localhost:5433', {})).toBe('');
  });

  it('throws on a string that is not a URL', () => {
    expect(() => resolveDatabaseName('not a url', {})).toThrow(/valid URL/);
  });
});

describe('assertScratchDatabase — an allowlist, not a blacklist', () => {
  it('allows the clone', () => {
    expect(assertScratchDatabase(CLONE, SCRATCH_DATABASE, {})).toBe('shliff_evidence');
  });

  it('refuses the live database named outright', () => {
    expect(() => assertScratchDatabase(LIVE, SCRATCH_DATABASE, {}))
      .toThrow(/refusing to run against the database "shliff"/);
  });

  it('refuses the live database reached through sslmode noise', () => {
    expect(() => assertScratchDatabase(`${LIVE}?sslmode=require`, SCRATCH_DATABASE, {}))
      .toThrow(/refusing to run against the database "shliff"/);
  });

  it('refuses the clone URL with its database trimmed off', () => {
    expect(() => assertScratchDatabase(
      'postgres://shliff:pw@localhost:5433', SCRATCH_DATABASE, {},
    )).toThrow(/refusing to run against the database "shliff"/);
  });

  it('refuses a bare trailing slash', () => {
    expect(() => assertScratchDatabase(
      'postgres://shliff:pw@localhost:5433/', SCRATCH_DATABASE, {},
    )).toThrow(/refusing to run against the database "shliff"/);
  });

  it('refuses a ?database= override that points back at live', () => {
    expect(() => assertScratchDatabase(`${CLONE}?database=shliff`, SCRATCH_DATABASE, {}))
      .toThrow(/refusing to run against the database "shliff"/);
  });

  it('refuses a ?db= override that points back at live', () => {
    expect(() => assertScratchDatabase(`${CLONE}?db=shliff`, SCRATCH_DATABASE, {}))
      .toThrow(/refusing to run against the database "shliff"/);
  });

  it('refuses PGDATABASE pointing at live', () => {
    expect(() => assertScratchDatabase(
      'postgres://shliff:pw@localhost:5433', SCRATCH_DATABASE, { PGDATABASE: 'shliff' },
    )).toThrow(/refusing to run against the database "shliff"/);
  });

  it('allows PGDATABASE pointing at the clone', () => {
    expect(assertScratchDatabase(
      'postgres://shliff:pw@localhost:5433',
      SCRATCH_DATABASE,
      { PGDATABASE: SCRATCH_DATABASE },
    )).toBe('shliff_evidence');
  });

  it('refuses a name it cannot determine rather than letting the OS pick one', () => {
    expect(() => assertScratchDatabase('postgres://localhost:5433', SCRATCH_DATABASE, {}))
      .toThrow(/names no database/);
  });

  it('refuses any other database, not only shliff', () => {
    expect(() => assertScratchDatabase(
      'postgres://shliff:pw@localhost:5433/shliff_verify', SCRATCH_DATABASE, {},
    )).toThrow(/refusing to run against the database "shliff_verify"/);
  });

  it('refuses a repeated ?database= whose last value is live', () => {
    expect(() => assertScratchDatabase(
      `${CLONE}?database=${SCRATCH_DATABASE}&database=shliff`, SCRATCH_DATABASE, {},
    )).toThrow(/refusing to run against the database "shliff"/);
  });

  it('refuses a repeated ?db= whose last value is live', () => {
    expect(() => assertScratchDatabase(
      `${CLONE}?db=${SCRATCH_DATABASE}&db=shliff`, SCRATCH_DATABASE, {},
    )).toThrow(/refusing to run against the database "shliff"/);
  });
});

/**
 * The allowlist holds more than one name now: `dry-run-promote.ts` and
 * `cutover.ts` each make their own clone, and both must be runnable without
 * either script relaxing into a blacklist.
 */
describe('assertScratchDatabase — an allowlist of several scratch names', () => {
  it('names both scratch clones and nothing else', () => {
    expect([...SCRATCH_DATABASES]).toEqual(['shliff_evidence', 'shliff_cutover']);
  });

  it('allows the cutover clone under the default allowlist', () => {
    expect(assertScratchDatabase(CUTOVER, SCRATCH_DATABASES, {})).toBe('shliff_cutover');
  });

  it('allows the evidence clone under the default allowlist', () => {
    expect(assertScratchDatabase(CLONE, SCRATCH_DATABASES, {})).toBe('shliff_evidence');
  });

  it('still refuses live under the default allowlist', () => {
    expect(() => assertScratchDatabase(LIVE, SCRATCH_DATABASES, {}))
      .toThrow(/refusing to run against the database "shliff"/);
  });

  it('names every allowed database in the refusal, so the fix is obvious', () => {
    expect(() => assertScratchDatabase(LIVE, SCRATCH_DATABASES, {}))
      .toThrow(/shliff_evidence, shliff_cutover/);
  });

  /** A single name still narrows the allowlist to exactly that name — the
   *  cutover script may not be talked into the evidence clone. */
  it('refuses the evidence clone when only the cutover clone is expected', () => {
    expect(() => assertScratchDatabase(CLONE, CUTOVER_DATABASE, {}))
      .toThrow(/refusing to run against the database "shliff_evidence"/);
  });
});

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
  SCRATCH_DATABASE, resolveDatabaseName, assertScratchDatabase,
} from '../../scripts/scratch-guard';

/** The real clone URL, with the password elided. */
const CLONE = `postgres://shliff:pw@localhost:5433/${SCRATCH_DATABASE}`;
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
});

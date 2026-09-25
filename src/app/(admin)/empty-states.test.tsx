import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

const APP = resolve(process.cwd(), 'src/app');
const rel = (path: string) => relative(process.cwd(), path).split(sep).join('/');

function sourcesUnder(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) sourcesUnder(path, found);
    else if (/\.tsx$/.test(path) && !/\.test\.tsx$/.test(path)) found.push(path);
  }
  return found;
}

/**
 * E1. **An empty state is an invitation, not an apology** — and never silence.
 *
 * A table with no rows draws a grid with nothing in it, which tells a lead
 * nothing about *which* kind of nothing they are looking at: a season with no
 * data, a filter that matched none, a list nobody has added to, or a job that
 * is finished. The four want four different next moves, and three of them
 * send a lead hunting for something that is not the problem.
 *
 * The kit's `EmptyState` owns the copy for all six kinds (C10), so a screen
 * supplies a kind and at most a noun and a season name. This nets the coverage:
 * every screen that draws a `Table` says what its emptiness means, either
 * through the table's own `empty` slot or by rendering the state in place of
 * the table.
 *
 * `ObligationsTable` was the one that did neither. With nothing owed it drew an
 * empty grid under a totals row reading `0 חובות` and `0 ₪` — silence plus two
 * zeroes, which breaks the platform's rule about a figure that would always
 * read zero at the same time as this one.
 */
describe('E1: every table says what it means to be empty', () => {
  it('leaves no table with nothing to show and nothing to say', () => {
    const offenders = sourcesUnder(APP)
      .filter((file) => {
        const source = readFileSync(file, 'utf8');
        if (!/<Table[\s<]/.test(source)) return false;
        // Either the table's own slot, or the state rendered in its place.
        return !/\bempty=\{/.test(source) && !/<EmptyState/.test(source);
      })
      .map(rel);
    expect(offenders).toEqual([]);
  });

  /**
   * A walk that found no tables would pass the case above identically, and a
   * regex that stopped matching `<Table` is exactly the way that happens.
   */
  it('is actually finding the tables', () => {
    const withTables = sourcesUnder(APP)
      .filter((file) => /<Table[\s<]/.test(readFileSync(file, 'utf8')))
      .map(rel);
    expect(withTables.length).toBeGreaterThan(6);
    expect(withTables).toContain('src/app/(admin)/members/people-table.tsx');
    expect(withTables).toContain('src/app/(admin)/money/obligations-table.tsx');
  });

  /**
   * The kinds are not interchangeable, which is the whole reason the kit makes
   * them a union rather than six strings through one door. This pins that the
   * union still has the members the screens are choosing between — a kind
   * quietly removed would make every screen that used it fall back to whatever
   * compiled.
   */
  it('keeps the six kinds distinguishable', async () => {
    const { EMPTY_TITLES } = await import('@/components/ui/empty-state');
    const kinds = Object.keys(EMPTY_TITLES).sort();
    expect(kinds).toEqual([
      'all-clear', 'no-matches', 'none-of-this-kind',
      'not-permitted', 'nothing-this-season', 'nothing-yet',
    ]);
    // Six kinds, six different sentences: a duplicate is a kind that has
    // stopped saying anything the others were not already saying.
    expect(new Set(Object.values(EMPTY_TITLES)).size).toBe(6);
  });
});

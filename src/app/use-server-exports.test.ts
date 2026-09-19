import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * A `'use server'` file may export **only async functions**.
 *
 * Next does not reject the offending export — it rejects the **whole module**.
 * Turbopack then reports `The export X was not found ... The module has no
 * exports at all`, naming whichever import happened to be resolved first, so
 * the error points at an innocent file. Every route importing any action from
 * that module returns 500, `/signin` included, which means the app cannot be
 * reached at all.
 *
 * ## Why this needs its own net
 *
 * Nothing else here can see it. `tsc` is clean — the export is perfectly well
 * typed. `eslint` is clean. `next build` was clean before the export existed.
 * And 868 unit tests passed, because a unit test imports the module
 * **directly**; the rule only applies across Next's server-action boundary,
 * which no test crosses. It took loading a page in a browser.
 *
 * This happened on 2026-09-19: `members/actions.ts` exported
 * `const UNLINK_ERROR_PARAM` beside its actions, to keep one spelling shared
 * between the action and the page that renders its refusal. That is a
 * reasonable thing to want, and it took the whole site down.
 *
 * ## What counts
 *
 * `export type` and `export interface` are fine: they are erased before the
 * rule applies, and four files here legitimately use them. Everything else
 * that reaches runtime is a violation — `const`, `let`, `var`, `class`, a
 * non-async `function`, and a re-export, which can carry anything at all.
 */
function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (/\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

const SRC = join(process.cwd(), 'src');

const serverFiles = walk(SRC).filter((file) => {
  const source = readFileSync(file, 'utf8');
  // The directive has to be the first statement, so a mention deeper in the
  // file (a comment quoting it, say) is not one.
  return /^\s*(['"])use server\1/.test(source);
});

/** Erased before the rule applies; everything else reaches runtime. */
const ERASED = /^export\s+(type|interface)\b/;
const ASYNC_FN = /^export\s+async\s+function\b/;

describe("a 'use server' file exports only async functions", () => {
  // Without this, a directive regex that stopped matching would make the whole
  // suite vacuously pass — the shape this file exists to catch.
  it('found use-server files to check', () => {
    expect(serverFiles.length).toBeGreaterThan(3);
  });

  it.each(serverFiles.map((f) => [relative(process.cwd(), f), f] as const))(
    '%s',
    (_label, file) => {
      const offenders = readFileSync(file, 'utf8')
        .split('\n')
        .filter((line) => /^export\b/.test(line))
        .filter((line) => !ERASED.test(line) && !ASYNC_FN.test(line));

      // Named rather than counted: the failure should say which line to move,
      // because the runtime error will point somewhere else entirely.
      expect(offenders).toEqual([]);
    },
  );
});

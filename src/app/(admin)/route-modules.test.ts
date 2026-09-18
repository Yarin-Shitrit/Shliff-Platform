import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, dirname, extname, join, relative, resolve } from 'node:path';

const ROOT = resolve(process.cwd(), 'src');
const APP = join(ROOT, 'app');

/** The App Router's own file names. A directory holding one of these is a route. */
const ROUTE_FILE = /^(page|layout|loading|error|global-error|not-found|template|default|route)\.(ts|tsx)$/;

function filesUnder(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) filesUnder(path, found);
    else found.push(path);
  }
  return found;
}

function isSource(path: string): boolean {
  return ['.ts', '.tsx'].includes(extname(path)) && !/\.test\.tsx?$/.test(path);
}

/**
 * Every route module, plus the non-test components sitting beside one. The
 * second half matters as much as the first: a page that imports a sibling
 * which reads the disk is a page that reads the disk, and naming only
 * `page.tsx` would net the symptom rather than the thing.
 */
function routeModules(): string[] {
  const all = filesUnder(APP);
  const routeDirs = new Set(all.filter((path) => ROUTE_FILE.test(basename(path))).map(dirname));
  return all.filter((path) => isSource(path) && routeDirs.has(dirname(path)));
}

/**
 * Source with its comments removed. The two repo-wide nets below would
 * otherwise fire on the sentences explaining what they forbid — including
 * their own regexes — and the cheap fix for that is to weaken the pattern
 * until the prose slips through, which is how a net stops checking the thing
 * it exists to check. Stripping the comments instead keeps the pattern exact
 * and leaves the explanation where a reader will find it.
 *
 * `//` inside a string literal (a URL) survives as a truncated line, which is
 * harmless here: neither pattern can match a URL fragment.
 */
function codeOf(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n');
}

/**
 * Every source file except the tests. A net that policed the other nets would
 * have to quote the thing it forbids in order to look for it.
 */
function allSourceFiles(): string[] {
  return filesUnder(ROOT)
    .filter((path) => /\.(ts|tsx|css)$/.test(path))
    .filter((path) => !/\.test\.tsx?$/.test(path));
}

const rel = (path: string) => relative(process.cwd(), path);

/**
 * E6. `/data` used to open every workbook in a directory with `readFileSync`
 * and parse it, on every request — so the first thing a lead saw was however
 * long it took to read a spreadsheet off the disk, repeated for every reload,
 * with nothing on screen saying why. `/inbox` replaced it and reads the
 * register from the database. This is the net that keeps it gone.
 *
 * `src/lib/storage/index.ts` is deliberately out of scope and stays as it is:
 * it is the local blob driver behind an upload action, writing and reading a
 * file the reader themselves just sent, not a page rendering.
 */
describe('E6: nothing reads the disk while someone waits', () => {
  it('has no /data route left to read a workbook from', () => {
    const admin = readdirSync(join(APP, '(admin)'), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
    expect(admin).not.toContain('data');
  });

  it('keeps the filesystem out of every route module', () => {
    const offenders: string[] = [];
    for (const file of routeModules()) {
      const source = readFileSync(file, 'utf8');
      if (/from '(node:)?fs(\/promises)?'/.test(source)) offenders.push(`${rel(file)}: imports fs`);
      if (/require\(\s*'(node:)?fs(\/promises)?'\s*\)/.test(source)) offenders.push(`${rel(file)}: requires fs`);
      if (/process\.cwd\(\)/.test(source)) offenders.push(`${rel(file)}: process.cwd()`);
      if (/__dirname/.test(source)) offenders.push(`${rel(file)}: __dirname`);
    }
    expect(offenders).toEqual([]);
  });

  /**
   * The net above only works if it is looking at the files it claims to. A
   * regex that matched nothing would pass identically, so this asserts the
   * population is the shape it should be — every admin screen, and more than
   * the route files alone.
   */
  it('is actually looking at the route modules, not at an empty list', () => {
    const modules = routeModules().map(rel);
    expect(modules.length).toBeGreaterThan(40);
    expect(modules).toContain('src/app/(admin)/layout.tsx');
    expect(modules).toContain('src/app/(admin)/inbox/page.tsx');
    // A sibling component, not a route file — the half that is easy to omit.
    expect(modules).toContain('src/app/(admin)/inbox/item-rail.tsx');
  });
});

/**
 * E3. A screen with no `loading.tsx` shows the previous page, frozen, for
 * however long its queries take — so a lead who has just pressed something
 * sees the thing they pressed still sitting there and presses it again.
 */
describe('E3: loading looks like what is coming', () => {
  function segmentsWithPages(dir: string, found: string[] = []): string[] {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) segmentsWithPages(path, found);
      else if (entry.name === 'page.tsx') found.push(dir);
    }
    return found;
  }

  it('gives every screen a skeleton of its own shape', () => {
    const segments = segmentsWithPages(join(APP, '(admin)'));
    expect(segments.length).toBeGreaterThan(10);
    const missing = segments
      .filter((dir) => !existsSync(join(dir, 'loading.tsx')))
      .map(rel);
    expect(missing).toEqual([]);
  });
});

/**
 * The static half of Task 3's and Task 2's rulings. Both are about a choice
 * that looks reasonable in the file where it is made and is wrong for the
 * whole product, which is why neither is left to review.
 */
describe('the phone rules that are easier to net than to remember', () => {
  /**
   * The fix for iOS zooming a form on focus is the 16px input floor, never a
   * viewport that forbids zooming. Suppressing zoom would take away the one
   * gesture a lead standing in bright sun actually needs, and it is the first
   * thing anyone reaches for when a field jumps on focus.
   */
  it('never forbids the reader from zooming', () => {
    const offenders = allSourceFiles()
      .filter((file) => /user-scalable\s*=\s*no|maximumScale|maximum-scale/.test(codeOf(readFileSync(file, 'utf8'))))
      .map(rel);
    expect(offenders).toEqual([]);
  });

  /**
   * A table on a phone becomes a list of cards (Task 2). Wrapping one in a
   * sideways scroller instead hides most of its columns off the edge of a
   * screen nobody thinks to swipe.
   */
  it('leaves no table wrapped in a sideways scroller', () => {
    const offenders = allSourceFiles()
      .filter((file) => /scroll-x/.test(codeOf(readFileSync(file, 'utf8'))))
      .map(rel);
    expect(offenders).toEqual([]);
  });
});

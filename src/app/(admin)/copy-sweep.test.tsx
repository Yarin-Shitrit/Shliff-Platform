import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const SRC = resolve(process.cwd(), 'src');
const rel = (path: string) => relative(process.cwd(), path);

function sourcesUnder(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) sourcesUnder(path, found);
    else if (/\.tsx?$/.test(path) && !/\.test\.tsx?$/.test(path)) found.push(path);
  }
  return found;
}

/** Every `'use server'` module under `src/app` — the R9 boundary. */
function actionFiles(): string[] {
  return sourcesUnder(join(SRC, 'app'))
    .filter((path) => /^['"]use server['"];/.test(readFileSync(path, 'utf8')));
}

/**
 * E5 / R9. **No English error text ever reaches a Hebrew screen.**
 *
 * `src/lib` throws in English by design — `an exception must carry a reason`,
 * `that person is not on this season roster`, `unknown alias <uuid>` — and
 * that is the right place for it: those sentences are for whoever is reading a
 * stack trace. The mapping happens at the action boundary, which is also the
 * only place it can happen without editing files four other lanes have been
 * touching.
 *
 * The rule is therefore narrow and checkable: a server action may not hand a
 * thrown `Error`'s own message back as its `ActionResult.error`.
 */
describe('E5: no server action echoes an English error', () => {
  it('routes every thrown message through the Hebrew boundary', () => {
    const offenders: string[] = [];
    for (const file of actionFiles()) {
      readFileSync(file, 'utf8').split('\n').forEach((line, index) => {
        // `console.error(..., error)` is for the operator, not the screen.
        if (/console\.error/.test(line)) return;
        if (/error instanceof Error \? error\.message/.test(line)
          || /\bString\(error\)/.test(line)) {
          offenders.push(`${rel(file)}:${index + 1}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });

  /**
   * The net above only works if it is reading the action modules. An
   * `actionFiles()` that returned nothing would pass identically.
   */
  it('is actually reading the server actions', () => {
    const files = actionFiles().map(rel);
    expect(files.length).toBeGreaterThan(5);
    expect(files).toContain('src/app/(admin)/members/actions.ts');
    expect(files).toContain('src/app/(admin)/fees/actions.ts');
  });
});

/**
 * The other half of R9, and the harder one: copy a screen *draws*, rather than
 * copy it throws.
 *
 * This reads the JSX text nodes and the props that carry a sentence, which is
 * a static approximation of the rendered-text net — but a deliberate one
 * rather than a shortcut. Rendering all eleven screens here would mean mocking
 * every query module each of them imports, which is the eleven screens' own
 * test files duplicated into one place; when a screen's queries changed, this
 * file would go red for a reason that has nothing to do with copy, and the
 * cheapest repair would be to delete the case. A static read has no such
 * coupling and finds the same class of defect: a sentence somebody typed in
 * English.
 *
 * What it therefore does **not** catch, stated rather than implied: English
 * arriving at runtime from the database, from a thrown error, or from an
 * interpolation. The first is data, the second is what the boundary net above
 * exists for, and the third is A20's job.
 */
describe('E5: no English in the copy a screen draws', () => {
  /**
   * Latin that is allowed on a Hebrew screen, each with its reason.
   *   MOOP  — the Burning Man term the camp itself uses; /tasks says it today.
   *   CSV   — the file format named on /members' export control.
   *   A1    — a spreadsheet cell reference under R11, rendered in mono.
   *   esc   — the key's own name, drawn in a keycap on the command palette.
   *           Translating a key a lead is looking at on their keyboard would
   *           make the hint wrong rather than Hebrew.
   */
  const ALLOWED = [/^MOOP$/, /^CSV$/, /^[A-Z]{1,3}\d+$/, /^esc$/];

  /**
   * JSX text nodes plus the props that carry a sentence. Anything else in a
   * `.tsx` file — a class name, an href, an id, an aria role — is machinery
   * and is not read by anybody.
   */
  const COPY_PROPS = [
    'title', 'label', 'headline', 'detail', 'confirmLabel', 'cancelLabel',
    'caption', 'emptyLabel', 'hint', 'placeholder', 'iconLabel', 'message',
    'aria-label', 'summary', 'noun',
  ];

  /**
   * A `>…<` match is only prose if it could not be something else. Without
   * this the extractor reports `Promise<ActionResult>` as English, and the
   * cheap repair for *that* is to allow-list the word `Promise` — at which
   * point the net has started allow-listing English rather than finding it.
   *
   * The lookbehind is for `() => Promise<void>`: the arrow`s own `>` opens a
   * match whose captured text is just ` Promise`, so the `=>` sits outside the
   * capture and an exclusion inside it never sees it.
   *
   * Excluded: a generic or a type annotation (`: `, `=>`, `??`), a query
   * fragment (`=`, `&`), a call or an index (`(`, `[`), and property access
   * (`.` followed by a letter). Hebrew copy carries none of these — a sentence
   * ending in a full stop is `.` followed by nothing, not by a letter.
   */
  const NOT_PROSE = /[=&([\]]|=>|\?\?|:\s|\.\w/;

  function copyStringsIn(source: string): string[] {
    const found: string[] = [];
    // Comments first: a docblock explaining a rule in English is not copy, and
    // a net that fired on its own explanations would get weakened, not obeyed.
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .split('\n')
      .map((line) => line.replace(/\/\/.*$/, ''))
      .join('\n');

    // `>some text<` — a JSX text node, with expressions and entities dropped.
    for (const match of code.matchAll(/(?<![=])>([^<>{}\n]{2,})</g)) {
      if (!NOT_PROSE.test(match[1])) found.push(match[1]);
    }
    // `prop="some text"` and `prop='some text'` for the copy-bearing props.
    const props = new RegExp(`\\b(?:${COPY_PROPS.join('|')})=(?:"([^"]*)"|'([^']*)')`, 'g');
    for (const match of code.matchAll(props)) {
      found.push(match[1] ?? match[2] ?? '');
    }
    return found;
  }

  /**
   * A string is copy only if somebody wrote words in it. A bare identifier, a
   * path or a number is machinery — and crucially, a string carrying a Hebrew
   * letter is already copy that was written in Hebrew, so only strings with
   * *no* Hebrew at all are candidates for being English by mistake.
   */
  function latinWordsIn(text: string): string[] {
    if (/[֐-׿]/.test(text)) return [];
    return text
      .split(/[\s,.:;·—()[\]!?|/\\#=+*"'`$%&@^~{}<>-]+/)
      .filter((word) => /^[A-Za-z][A-Za-z]+$/.test(word))
      .filter((word) => !ALLOWED.some((allowed) => allowed.test(word)));
  }

  it('leaves no English sentence in a screen a lead reads', () => {
    const offenders: string[] = [];
    for (const file of sourcesUnder(join(SRC, 'app'))) {
      const source = readFileSync(file, 'utf8');
      for (const text of copyStringsIn(source)) {
        const latin = latinWordsIn(text);
        if (latin.length > 0) offenders.push(`${rel(file)}: ${text.trim().slice(0, 60)}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('is actually reading copy, not an empty list', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/app/(admin)/imports/page.tsx'), 'utf8',
    );
    const strings = copyStringsIn(source);
    expect(strings.length).toBeGreaterThan(3);
    expect(strings.some((text) => /[֐-׿]/.test(text))).toBe(true);
  });

  /**
   * A positive control on the extractor, not on the copy.
   *
   * The first version of this net was **blind**: an over-escaped `\n` turned
   * its character class into "anything but `<`, `>`, `{`, `}`, a backslash or
   * the letter n", so every sentence containing a lowercase `n` — which is
   * almost every English sentence — was skipped. The repo-wide case passed,
   * the scan printed nothing, and the net looked like evidence that the
   * screens were clean. Only breaking a screen on purpose found it.
   *
   * So the extractor is now exercised against a string it must match, rather
   * than trusted because the sweep it drives came back empty.
   */
  it('reads a JSX text node containing every ordinary letter', () => {
    expect(copyStringsIn('<p>Nothing here needs your attention</p>'))
      .toEqual(['Nothing here needs your attention']);
    expect(copyStringsIn('<p>אין מה להכריע כרגע</p>')).toEqual(['אין מה להכריע כרגע']);
  });

  it('would name an English sentence if one appeared', () => {
    expect(latinWordsIn('Save and continue')).toEqual(['Save', 'and', 'continue']);
    // Hebrew copy that happens to name a format is left alone.
    expect(latinWordsIn('ייצוא ל־CSV')).toEqual([]);
    expect(latinWordsIn('MOOP')).toEqual([]);
    /*
     * A path is machinery, and it is `copyStringsIn` that keeps it out, not
     * `latinWordsIn` — `href` is not a copy prop and a URL is not a text node.
     * Asserted here rather than the other way round, because the first draft
     * of this test claimed `latinWordsIn` filtered paths and it does not:
     * `/members/p1` splits on the slashes and yields `members`.
     */
    expect(latinWordsIn('/members/p1')).toEqual(['members']);
    expect(copyStringsIn('<a href="/members/p1">קישור</a>')).toEqual(['קישור']);
    // A generic is not a sentence, however much it looks like one to a regex.
    expect(copyStringsIn('const x: Promise<Foo> = y;')).toEqual([]);
    expect(copyStringsIn('onSignOut: () => Promise<void>;')).toEqual([]);
  });
});

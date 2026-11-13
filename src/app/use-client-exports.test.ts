import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { basename, join, relative } from 'node:path';

/**
 * A server entry — a `page.tsx`, a `layout.tsx`, a `route.ts` — may take
 * **only components** from a `'use client'` file.
 *
 * On the server, everything a `'use client'` module exports is a reference
 * to hand to the browser, not the thing itself. Rendering a component
 * through one is the whole point; calling a helper or reading a constant
 * through one throws while the screen is built ("Attempted to call X() from
 * the server but X is on the client").
 *
 * ## Why this needs its own net
 *
 * The sibling of `use-server-exports.test.ts`, for the same reason: nothing
 * else can see it. `tsc` and `eslint` are clean, and a unit test imports the
 * module directly, where the function is a function. It takes a real server
 * render.
 *
 * This happened on 2026-11-13: `logistics/plan/page.tsx` called
 * `itemDrawerKey`, exported from `item-drawer.tsx` beside the drawer. Every
 * item drawer on לוח עבודה — a new item, an open one — answered with the
 * error screen. The helper now lives in `plan-views.ts`.
 *
 * ## What counts
 *
 * A value import whose name does not read as a component (`Capitalised`).
 * `import type` and an inline `type X` are erased and fine. Only server
 * entries are checked: a plain module with no directive may be client code
 * by way of whoever imports it, and this file cannot tell.
 */
function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (/\.tsx?$/.test(entry.name) && !/\.test\./.test(entry.name)) out.push(full);
  }
  return out;
}

const SRC = join(process.cwd(), 'src');
const files = walk(SRC);
const sources = new Map(files.map((file) => [file, readFileSync(file, 'utf8')]));

/** The directive has to be the first statement; a leading comment is allowed. */
const isClient = (source: string) => /^\s*(?:\/\*[\s\S]*?\*\/\s*)?(['"])use client\1/.test(source);
const isServerEntry = (file: string) => /^(?:page|layout|route|template|default)\.tsx?$/.test(basename(file));

const clientFiles = files.filter((file) => isClient(sources.get(file)!));
const entries = files.filter((file) => isServerEntry(file) && !isClient(sources.get(file)!));

const COMPONENT = /^[A-Z][A-Za-z0-9]*[a-z]/;
const IMPORT = /import\s+(?!type\b)([^;'"]*?)\s+from\s+(['"])([^'"]+)\2/g;

/** `{ A, b, type C }` and a default name, as the names that reach runtime. */
function valueNames(clause: string): string[] {
  return clause.split(/[{},]/)
    .map((part) => part.trim())
    .filter((part) => part !== '' && !part.startsWith('type '))
    .map((part) => part.split(/\s+as\s+/)[0]);
}

function resolve(from: string, specifier: string): string | null {
  const base = specifier.startsWith('@/') ? join(SRC, specifier.slice(2))
    : specifier.startsWith('.') ? join(from, '..', specifier) : null;
  if (base === null) return null;
  return [`${base}.tsx`, `${base}.ts`, join(base, 'index.tsx'), join(base, 'index.ts')]
    .find((candidate) => sources.has(candidate)) ?? null;
}

/** The imports of `file` that land in a `'use client'` module. */
function crossings(file: string): Array<{ names: string[]; target: string }> {
  const found: Array<{ names: string[]; target: string }> = [];
  for (const match of sources.get(file)!.matchAll(IMPORT)) {
    const target = resolve(file, match[3]);
    if (target !== null && isClient(sources.get(target)!)) found.push({ names: valueNames(match[1]), target });
  }
  return found;
}

function offences(file: string): string[] {
  return crossings(file).flatMap(({ names, target }) => names
    .filter((name) => !COMPONENT.test(name))
    .map((name) => `${relative(SRC, file)} takes ${name} from ${relative(SRC, target)}`));
}

describe("a server entry takes only components from a 'use client' file", () => {
  // Without these, a regex that stopped matching would pass vacuously.
  it('finds client files, server entries, and imports that cross between them', () => {
    expect(clientFiles.length).toBeGreaterThan(50);
    expect(entries.length).toBeGreaterThan(20);
    expect(entries.filter((file) => crossings(file).length > 0).length).toBeGreaterThan(10);
  });

  it('reads a helper beside a component as an offence, and the component as none', () => {
    expect(valueNames('{ ItemDrawer, itemDrawerKey, type ItemDrawerProps }')).toEqual(['ItemDrawer', 'itemDrawerKey']);
    expect(COMPONENT.test('itemDrawerKey')).toBe(false);
    expect(COMPONENT.test('TITLE_ID')).toBe(false);
    expect(COMPONENT.test('ItemDrawer')).toBe(true);
  });

  it('holds across src', () => {
    expect(entries.flatMap(offences)).toEqual([]);
  });
});

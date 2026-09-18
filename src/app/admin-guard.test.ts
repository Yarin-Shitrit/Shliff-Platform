import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { basename, join, relative, sep } from 'node:path';

/**
 * Spec req 31's "guard lint rule", done as a test rather than a lint plugin:
 * every admin page, route handler and server action must call
 * `requireAdmin(` in its own source. UI hiding is never the enforcement —
 * this net makes that total by walking the filesystem, not a route list
 * someone has to remember to update.
 *
 * `walk` is deliberately generic (no opinion about which files matter) so a
 * later assertion — e.g. "no production file under `src/` imports
 * `@/test/`" — can reuse it against a different directory and filter.
 */
function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walk(full));
    } else {
      out.push(full);
    }
  }
  return out;
}

const APP_DIR = join(process.cwd(), 'src', 'app');
const ADMIN_DIR = join(APP_DIR, '(admin)');
const API_DIR = join(APP_DIR, 'api');
const NEXTAUTH_ROUTE = join(API_DIR, 'auth', '[...nextauth]', 'route.ts');

// Every file convention Next.js can dispatch a request to, under the admin
// route group: pages, route handlers, and server actions.
const ADMIN_CONVENTIONS = new Set(['page.tsx', 'route.ts', 'actions.ts']);

const adminEntryPoints = walk(ADMIN_DIR).filter((file) => ADMIN_CONVENTIONS.has(basename(file)));

// Outside the admin group, only route handlers are in scope, and the
// NextAuth catch-all is the one route that must NOT require an admin
// session — it's how a session is established in the first place.
const apiRouteHandlers = walk(API_DIR)
  .filter((file) => basename(file) === 'route.ts' && file !== NEXTAUTH_ROUTE);

const guardedFiles = [...adminEntryPoints, ...apiRouteHandlers];

describe('every admin entry point calls requireAdmin', () => {
  // A silent empty walk would make every `it.each` below vacuously pass.
  // If the admin route group is ever renamed, this fails loudly instead.
  it('found admin and api entry points to check', () => {
    expect(guardedFiles.length).toBeGreaterThan(0);
    expect(adminEntryPoints.length).toBeGreaterThan(0);
    expect(apiRouteHandlers.length).toBeGreaterThan(0);
  });

  it.each(guardedFiles.map((file) => [relative(process.cwd(), file), file] as const))(
    '%s calls requireAdmin(',
    (_label, file) => {
      const source = readFileSync(file, 'utf8');
      expect(source).toContain('requireAdmin(');
    },
  );
});

/**
 * The check above asks whether the FILE mentions the guard. It cannot see an
 * unguarded action beside a guarded one — a file with five entry points and one
 * `requireAdmin(` passes it. Removing a single action's guard was tried and the
 * suite stayed green, which makes it a net that cannot fail for the thing it
 * claims: every admin entry point is guarded, not every file knows the word.
 *
 * So: each exported action carries its own assertion. A `'use server'` file has
 * no private exports — every `export async function` in one is reachable by
 * anybody who can POST to it, whatever the UI shows.
 *
 * Exemptions are named here with their reason rather than loosening the rule,
 * because an unguarded entry point is either a defect or a decision, and the
 * difference has to be written down by whoever made it.
 */
const GUARD_EXEMPT: Readonly<Record<string, string>> = {
  // Requiring admin to sign out would strand a non-admin holding a session:
  // they could neither use the app nor leave it. Sign-out ends a session and
  // grants nothing, so it is safe for anyone who has one.
  signOutAction: 'ends a session and grants nothing; a non-admin must be able to leave',
};

function exportedActions(source: string): Array<{ name: string; body: string }> {
  // Split on the boundary rather than matching a body: a brace-counting parse
  // would have to understand strings, comments and nested functions, and this
  // only needs "the text belonging to this export".
  return source
    .split(/(?=^export async function )/m)
    .map((part) => ({ match: part.match(/^export async function (\w+)/), body: part }))
    .filter((x): x is { match: RegExpMatchArray; body: string } => x.match !== null)
    .map((x) => ({ name: x.match[1], body: x.body }));
}

describe('every exported action calls requireAdmin, not just every file', () => {
  const cases = guardedFiles.flatMap((file) =>
    exportedActions(readFileSync(file, 'utf8'))
      .map((action) => [`${relative(process.cwd(), file)} → ${action.name}`, action] as const),
  );

  // Without this, a regex that stopped matching would make every case below
  // vacuously pass — the same hole this whole block exists to close.
  it('found exported actions to check', () => {
    expect(cases.length).toBeGreaterThan(10);
  });

  it.each(cases)('%s', (_label, action) => {
    if (action.name in GUARD_EXEMPT) {
      expect(GUARD_EXEMPT[action.name].length).toBeGreaterThan(20);
      return;
    }
    expect(action.body).toContain('requireAdmin(');
  });
});

/**
 * Ruling 1 of the promotion-blockers hardening pass: production code never
 * imports from `src/test/`. `src/test/` reads real files off disk (the
 * camp's actual workbooks, by way of `src/test/fixtures.ts`) and exists only
 * to support tests; a `'use server'` file that reaches it drags dev-only file
 * reads into what gets deployed.
 *
 * `import type { X } from '@/test/...'` is exempt: a type-only import is
 * erased at compile time (see `src/lib/db-types.ts`), so it can never smuggle
 * runtime behaviour into a production bundle no matter which module it names.
 * What's forbidden is a *value* import — anything not spelled `import type`.
 *
 * Four shapes carry a value import, and all four are checked:
 * - `import { X } from '<test>'` — a static declaration with a `from`
 *   clause. `import type { X } from '<test>'` is the one exempt case.
 * - `import '<test>'` — a bare, side-effect-only import. There is no
 *   `import type '<test>'` form, so this is always a value import.
 * - `import('<test>')` — a dynamic import expression. Also always a value
 *   import at runtime (it returns a `Promise`); this codebase's own
 *   `src/lib/storage/index.ts` reaches `@vercel/blob` exactly this way, so a
 *   file reaching `src/test/` through the same idiom is not a hypothetical.
 * - `export { X } from '<test>'` — a re-export. It names no `import` keyword
 *   at all, so the three regexes above all missed it, and it pulls the module
 *   into the graph exactly as an import does. `export type { X } from …` gets
 *   the same carve-out as `import type`.
 *
 * ## The specifier, not the alias
 *
 * All four used to require the literal substring `@/test/`, so a production
 * file writing `import { fixtureBuffer } from '../../test/fixtures'` — or
 * `await import('../test/fixtures')` — walked straight through the net. That
 * is not hypothetical shorthand: production files here already use relative
 * imports (`src/app/(admin)/members/[id]/page.tsx` imports `'../add-member'`),
 * and `eslint.config.mjs` has no `no-restricted-imports` rule that would catch
 * a relative path into `src/test/` independently. Nothing trips it today —
 * this net is the permanent backstop for "the camp's real workbooks never
 * reach a deployed function", and a backstop with a known hole is not one.
 *
 * So the match is on a `/test/` PATH SEGMENT in the specifier, aliased or
 * relative, rather than on the `@/` prefix. It deliberately does not resolve
 * the path against the file's own directory: a `/test/` segment under `src/`
 * that is not `src/test/` would be a false positive, which fails the build
 * loudly rather than passing a real import through silently. An npm package
 * (`'postgres'`, `'@scope/test/x'`) never matches, because the specifier must
 * begin with `@/`, `./` or `../`.
 */
const SRC_DIR = join(process.cwd(), 'src');
const TEST_DIR = join(SRC_DIR, 'test');

/**
 * A module specifier that resolves under a `test/` directory: `@/test/db`,
 * `./test/db`, `../test/db`, `../../test/db`. The leading `@` or `.`/`..` is
 * what keeps package names out.
 */
const TEST_SPECIFIER = String.raw`(?:@|\.\.?)(?:/[^'"]*)?/test/[^'"]*`;

// Matches one whole static import statement naming such a specifier. Bounded
// by the next `;`, which is safe because import clauses never contain a
// semicolon of their own — so this can't run on past a multi-line brace list
// into an unrelated later statement.
const STATIC_FROM_IMPORT_RE = new RegExp(
  String.raw`import\s+[^;]*from\s+['"]${TEST_SPECIFIER}['"]`, 'g',
);

// `import '<test>'` — bare side-effect import, no `from` clause at all.
const BARE_IMPORT_RE = new RegExp(String.raw`import\s*['"]${TEST_SPECIFIER}['"]`, 'g');

// `import('<test>')` — a dynamic import call, however it's awaited/used.
const DYNAMIC_IMPORT_RE = new RegExp(
  String.raw`import\s*\(\s*['"]${TEST_SPECIFIER}['"]\s*\)`, 'g',
);

// `export { X } from '<test>'` / `export * from '<test>'` — a re-export, which
// names no `import` keyword and so matched none of the three above.
const REEXPORT_RE = new RegExp(
  String.raw`export\s+[^;]*from\s+['"]${TEST_SPECIFIER}['"]`, 'g',
);

function valueImportsFromTest(source: string): string[] {
  const staticImports = (source.match(STATIC_FROM_IMPORT_RE) ?? [])
    .filter((statement) => !/^import\s+type\s/.test(statement));
  const bareImports = source.match(BARE_IMPORT_RE) ?? [];
  const dynamicImports = source.match(DYNAMIC_IMPORT_RE) ?? [];
  const reExports = (source.match(REEXPORT_RE) ?? [])
    .filter((statement) => !/^export\s+type\s/.test(statement));
  return [...staticImports, ...bareImports, ...dynamicImports, ...reExports];
}

function isTestOnlyFile(file: string): boolean {
  return file.startsWith(TEST_DIR + sep) || /\.test\.tsx?$/.test(file);
}

const productionFiles = walk(SRC_DIR).filter(
  (file) => /\.tsx?$/.test(file) && !isTestOnlyFile(file),
);

/**
 * Unit-level coverage for the matcher itself, against literal fixture
 * strings rather than real files, so every shape it's supposed to catch (and
 * the one shape it's supposed to let through) is provable without editing a
 * production file to break the net on purpose.
 */
describe('valueImportsFromTest', () => {
  it('flags a static value import with a from clause', () => {
    expect(valueImportsFromTest("import { FIXTURES } from '@/test/fixtures';")).toHaveLength(1);
  });

  it('does not flag a type-only import with a from clause', () => {
    expect(valueImportsFromTest("import type { TestDb } from '@/test/db';")).toEqual([]);
  });

  it('flags a bare side-effect import', () => {
    expect(valueImportsFromTest("import '@/test/fixtures';")).toHaveLength(1);
  });

  it('flags a dynamic import() expression', () => {
    expect(valueImportsFromTest("const mod = await import('@/test/fixtures');")).toHaveLength(1);
  });

  it('does not flag an import that has nothing to do with @/test/', () => {
    expect(valueImportsFromTest("import { db } from '@/db';")).toEqual([]);
  });

  // The blind spot. Every one of these walked through the old net, which
  // required the literal substring `@/test/`.
  it('flags a relative static value import', () => {
    expect(valueImportsFromTest("import { fixtureBuffer } from '../../test/fixtures';"))
      .toHaveLength(1);
  });

  it('flags a relative static import one directory up', () => {
    expect(valueImportsFromTest("import { createTestDb } from '../test/db';")).toHaveLength(1);
  });

  it('flags a relative static import from the same directory', () => {
    expect(valueImportsFromTest("import { x } from './test/fixtures';")).toHaveLength(1);
  });

  it('flags a relative dynamic import', () => {
    expect(valueImportsFromTest("const m = await import('../test/fixtures');")).toHaveLength(1);
  });

  it('flags a relative bare side-effect import', () => {
    expect(valueImportsFromTest("import '../../test/fixtures';")).toHaveLength(1);
  });

  it('keeps the type-only carve-out for a relative specifier too', () => {
    expect(valueImportsFromTest("import type { TestDb } from '../../test/db';")).toEqual([]);
  });

  // The second gap: a re-export names no `import` keyword.
  it('flags a re-export from a test module', () => {
    expect(valueImportsFromTest("export { FIXTURES } from '@/test/fixtures';")).toHaveLength(1);
  });

  it('flags a star re-export from a relative test module', () => {
    expect(valueImportsFromTest("export * from '../test/fixtures';")).toHaveLength(1);
  });

  it('does not flag a type-only re-export', () => {
    expect(valueImportsFromTest("export type { TestDb } from '@/test/db';")).toEqual([]);
  });

  // A package name is not a path into src/test/, however it is spelled.
  it('does not flag a scoped package whose name contains test', () => {
    expect(valueImportsFromTest("import { x } from '@scope/test/thing';")).toEqual([]);
  });

  it('does not flag a bare package name', () => {
    expect(valueImportsFromTest("import postgres from 'postgres';")).toEqual([]);
  });

  // `test` has to be a whole path segment, not a prefix of one.
  it('does not flag a sibling module whose name merely starts with test', () => {
    expect(valueImportsFromTest("import { x } from './test-helpers';")).toEqual([]);
  });

  it('does not flag a directory called tests rather than test', () => {
    expect(valueImportsFromTest("import { x } from '../../tests/fixtures';")).toEqual([]);
  });
});

describe('no production file imports a value from @/test/', () => {
  // Same defence as the admin-entry-points check above: a silent empty walk
  // would make every assertion below vacuously pass.
  it('found production files to check', () => {
    expect(productionFiles.length).toBeGreaterThan(0);
  });

  it.each(productionFiles.map((file) => [relative(process.cwd(), file), file] as const))(
    '%s does not value-import from @/test/',
    (_label, file) => {
      const source = readFileSync(file, 'utf8');
      expect(valueImportsFromTest(source)).toEqual([]);
    },
  );
});

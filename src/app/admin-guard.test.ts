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
 */
const SRC_DIR = join(process.cwd(), 'src');
const TEST_DIR = join(SRC_DIR, 'test');

// Matches one whole import statement that names `@/test/...`. Bounded by the
// next `;`, which is safe because import clauses never contain a semicolon
// of their own — so this can't run on past a multi-line brace list into an
// unrelated later statement.
const TEST_IMPORT_RE = /import\s+[^;]*from\s+['"]@\/test\/[^'"]*['"]/g;

function valueImportsFromTest(source: string): string[] {
  const matches = source.match(TEST_IMPORT_RE) ?? [];
  return matches.filter((statement) => !/^import\s+type\s/.test(statement));
}

function isTestOnlyFile(file: string): boolean {
  return file.startsWith(TEST_DIR + sep) || /\.test\.tsx?$/.test(file);
}

const productionFiles = walk(SRC_DIR).filter(
  (file) => /\.tsx?$/.test(file) && !isTestOnlyFile(file),
);

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

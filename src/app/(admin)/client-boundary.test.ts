import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

/**
 * A `'use client'` module's non-component exports do not cross into a Server
 * Component as values. The import resolves to an opaque client reference, and
 * reading a key off it gives `undefined` — no throw, no log, just a pill with
 * no word and a filter menu with no options, which is how `/members` lost its
 * dues labels (`DUES_STATE_LABELS` lived in `people-table.tsx`, a client
 * module, and was read by the page and the peek drawer).
 *
 * The rule here is the narrowest one that catches that shape: a `const` or
 * `let` exported from a `'use client'` module is imported only by modules that
 * carry the directive themselves. A module that is client-only by being
 * imported from one (no directive) is flagged too; the fix is the same either
 * way — a plain data module such as `src/lib/members/labels.ts` — so the false
 * positive costs a move, never a wrong answer.
 */
const SRC = join(process.cwd(), 'src');
const USE_CLIENT = /^\s*(['"])use client\1;?/m;
const EXPORTED_VALUE = /^export\s+(?:const|let)\s+([A-Za-z_$][\w$]*)/gm;
const IMPORT = /import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+['"]([^'"]+)['"]/g;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(path);
  }
  return out;
}

function resolveImport(from: string, spec: string): string | null {
  const base = spec.startsWith('@/') ? join(SRC, spec.slice(2)) : spec.startsWith('.') ? resolve(dirname(from), spec) : null;
  if (base === null) return null;
  for (const candidate of [base + '.ts', base + '.tsx', join(base, 'index.ts'), join(base, 'index.tsx')]) {
    try { if (statSync(candidate).isFile()) return candidate; } catch { /* next */ }
  }
  return null;
}

describe('client module constants stay on the client side of the boundary', () => {
  it('no module without the directive imports a const from a "use client" module', () => {
    const files = walk(SRC);
    const sources = new Map(files.map((file) => [file, readFileSync(file, 'utf8')]));
    const clientValues = new Map<string, Set<string>>();
    for (const [file, source] of sources) {
      if (!USE_CLIENT.test(source)) continue;
      const names = new Set<string>();
      for (const match of source.matchAll(EXPORTED_VALUE)) names.add(match[1]);
      if (names.size > 0) clientValues.set(file, names);
    }

    const offenders: string[] = [];
    for (const [file, source] of sources) {
      if (USE_CLIENT.test(source)) continue;
      for (const match of source.matchAll(IMPORT)) {
        if (match[0].startsWith('import type')) continue;
        const target = resolveImport(file, match[2]);
        if (target === null || !clientValues.has(target)) continue;
        const exported = clientValues.get(target)!;
        const imported = match[1].split(',')
          .map((part) => part.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0])
          .filter((name) => name !== '' && exported.has(name));
        for (const name of imported) {
          offenders.push(`${relative(SRC, file).split('\\').join('/')} imports ${name} from ${relative(SRC, target).split('\\').join('/')}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

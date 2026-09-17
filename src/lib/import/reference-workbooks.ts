import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const DIR = join(process.cwd(), 'docs', 'reference-data');

/**
 * The camp's real historical workbooks — actual names and amounts, read
 * straight off disk. This lives under `src/lib/import/` rather than
 * `src/test/` because `seedReferenceWorkbooks` (a production code path,
 * gated to non-production environments at its call site) needs it too;
 * production code must never import from `src/test/` (see
 * `src/app/admin-guard.test.ts`'s "no production file imports a value from
 * @/test/" net).
 *
 * `docs/reference-data/` itself is kept out of every deployed function's
 * trace (`next.config.ts`'s `outputFileTracingExcludes`), so reading these
 * files only ever works in development or in tests that run against a real
 * checkout — never in a production build.
 *
 * `src/test/fixtures.ts` re-exports these two names under their old
 * identifiers (`FIXTURES`, `fixtureBuffer`) so every existing test keeps
 * working unchanged.
 */
export const REFERENCE_WORKBOOKS = {
  /** Straight ASCII apostrophes (U+0027). */
  y2324: "קופת קאמפ 23'-24'.xlsx",
  /** Right single quotation mark (U+2019), not an apostrophe. */
  y25: 'קופת קאמפ 25’.xlsx',
  y26: 'קופת קאמפ 2026.xlsx',
} as const;

export function referenceWorkbookBuffer(name: string): Buffer {
  return readFileSync(join(DIR, name));
}

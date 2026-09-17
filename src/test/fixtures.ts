/**
 * Thin re-export so every existing test can keep importing `FIXTURES` and
 * `fixtureBuffer` from `@/test/fixtures` unchanged. The real list and reader
 * live in `src/lib/import/reference-workbooks.ts` — a production module,
 * because `seedReferenceWorkbooks` needs it too, and production code must
 * never import from `src/test/` (see `src/app/admin-guard.test.ts`).
 */
export {
  REFERENCE_WORKBOOKS as FIXTURES,
  referenceWorkbookBuffer as fixtureBuffer,
} from '@/lib/import/reference-workbooks';

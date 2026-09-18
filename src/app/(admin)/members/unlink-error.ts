/**
 * The query param a refused unlink comes back in, so the page and the action
 * agree on one spelling (A38: a server-rendered dialog may not swallow a
 * refusal — it redirects with the reason in the URL, the way `/signin` does).
 *
 * ## Why this is its own module rather than a line in `actions.ts`
 *
 * **A `'use server'` file may export only async functions.** Exporting a value
 * beside them does not fail that one export — Next rejects the **whole module**,
 * and the error says `The module has no exports at all`, naming whichever import
 * happened to be looked up first. Every other file importing any action from it
 * then fails too, so the app returns 500 on every route, including `/signin`.
 *
 * Nothing catches it before a browser does: `tsc` is clean (the export is
 * perfectly well typed), `eslint` is clean, and the unit suites import the
 * module directly rather than through Next's server-action boundary, so they
 * pass. It surfaced only on a page load.
 *
 * `export type` and `export interface` are fine in a `'use server'` file — they
 * are erased before the rule applies. It is only a runtime value that breaks it.
 */
export const UNLINK_ERROR_PARAM = 'unlinkError';

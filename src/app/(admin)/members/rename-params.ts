/**
 * The two query params the rename form lives in, so the page and the action
 * agree on one spelling of each.
 *
 * `?rename=1` opens the form; `?renameError=<sentence>` is where a refused
 * rename comes back (A38: a server-rendered form may not swallow a refusal —
 * it redirects with the reason in the URL, the way the unlink dialog does).
 *
 * Its own module for the reason `unlink-error.ts` gives: a `'use server'`
 * file may export only async functions, and a runtime value beside them
 * breaks the whole module on every route.
 */
export const RENAME_PARAM = 'rename';
export const RENAME_ERROR_PARAM = 'renameError';

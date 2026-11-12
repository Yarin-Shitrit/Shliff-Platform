/**
 * The two query params the delete confirmation lives in, so the page and the
 * action agree on one spelling of each.
 *
 * `?delete=1` raises the dialog; `?deleteError=<sentence>` is where a refused
 * deletion comes back (A38: a server-rendered dialog may not swallow a
 * refusal — it redirects with the reason in the URL, the way the unlink
 * dialog and the rename form do).
 *
 * Its own module for the reason `unlink-error.ts` gives: a `'use server'`
 * file may export only async functions, and a runtime value beside them
 * breaks the whole module on every route.
 */
export const DELETE_PARAM = 'delete';
export const DELETE_ERROR_PARAM = 'deleteError';

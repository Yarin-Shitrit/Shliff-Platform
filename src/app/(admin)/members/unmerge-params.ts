/**
 * The two query params the unmerge confirmation lives in, so the page and
 * the action agree on one spelling of each.
 *
 * `?unmerge=1` raises the dialog on a merged-away record; `?unmergeError=
 * <sentence>` is where a refused unmerge comes back (A38: a server-rendered
 * dialog may not swallow a refusal — it redirects with the reason in the
 * URL, the way the unlink, rename and delete dialogs do).
 *
 * Its own module for the reason `unlink-error.ts` gives: a `'use server'`
 * file may export only async functions, and a runtime value beside them
 * breaks the whole module on every route.
 */
export const UNMERGE_PARAM = 'unmerge';
export const UNMERGE_ERROR_PARAM = 'unmergeError';

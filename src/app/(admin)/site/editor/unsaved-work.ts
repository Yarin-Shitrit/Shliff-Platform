/**
 * After a deploy, an editor left open is still the old build, and its server
 * actions are gone from the new one (review I2). Next throws
 * `UnrecognizedActionError` — "Server Action "…" was not found on the
 * server" (`node_modules/next/dist/client/components/unrecognized-action-error.js`;
 * `node_modules/next/dist/docs/01-app/02-guides/server-actions.md`, "Deployment
 * considerations": surface it as a retry path, a refresh recovers). Only a
 * page refresh gets the new actions, so what is unsaved waits in this tab's
 * `sessionStorage`, under the plan's id, and the next page replays it.
 */

import { isSiteOpType, opRefusal, type SiteOp } from '@/lib/site/editor/ops';

/** What the lead reads when a save reached an older build. */
export const SITE_UPDATED = 'האתר עודכן בזמן העבודה. צריך לרענן את הדף; השינויים שלא נשמרו יחכו אחרי הרענון.';

/** Next's "that server action is not in this build" — by name, or by its sentence if the name is lost in transit. */
export function isStaleBuild(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.name === 'UnrecognizedActionError'
    || /Server Action ".*" was not found on the server|Failed to find Server Action/.test(error.message);
}

const keyOf = (planId: string) => `site-editor:pending:${planId}`;

/**
 * The edits an earlier page of this map left unsaved, or none. Anything that
 * does not read back as ops the server would accept is dropped whole — a
 * guess at half of it would be worse than none — and so is anything when
 * storage is unavailable (a private window, blocked site data). Which op
 * types there are comes from `SITE_OP_TYPES`, beside `SiteOp` — never a list
 * kept here, which once forgot the line ops (#25 review, Critical).
 */
export function readUnsaved(planId: string): SiteOp[] {
  try {
    const text = window.sessionStorage.getItem(keyOf(planId));
    if (text === null) return [];
    const parsed: unknown = JSON.parse(text);
    if (!Array.isArray(parsed)) return [];
    const ok = parsed.every((op: unknown) => typeof op === 'object' && op !== null
      && isSiteOpType((op as { type?: unknown }).type) && opRefusal(op as SiteOp) === null);
    return ok ? (parsed as SiteOp[]) : [];
  } catch {
    return [];
  }
}

export function keepUnsaved(planId: string, ops: readonly SiteOp[]): void {
  try {
    if (ops.length === 0) window.sessionStorage.removeItem(keyOf(planId));
    else window.sessionStorage.setItem(keyOf(planId), JSON.stringify(ops));
  } catch {
    // Storage refused: the beforeunload warning still stands between the lead and a refresh.
  }
}

export function forgetUnsaved(planId: string): void {
  try {
    window.sessionStorage.removeItem(keyOf(planId));
  } catch {
    // Nothing to forget where nothing could be kept.
  }
}

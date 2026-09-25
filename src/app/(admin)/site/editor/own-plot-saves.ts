/**
 * The plot versions this tab's plot drawer saved (#25 fix round, Minor 10).
 * A newer version the page hands the editor is the lead's own plot save
 * only when it is exactly the one noted here; any other came from somewhere
 * else, and the editor says so in the neutral words of a conflict.
 *
 * Module state, on purpose: it lives exactly as long as this tab's page, and
 * the drawer and the editor are both in it. Nothing is cleared — a later
 * version from anyone else simply does not match.
 */

const saved = new Map<string, number>();

/** The drawer saved `planId`'s plot, and the server put it at `version`. */
export function notePlotSaved(planId: string, version: number): void {
  saved.set(planId, version);
}

export function isOwnPlotSave(planId: string, version: number): boolean {
  return saved.get(planId) === version;
}

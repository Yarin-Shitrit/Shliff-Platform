/**
 * Where an enumerated row stands relative to `cutover.ts`'s `--season` scope.
 *
 * It lives in its own module for the reason `scratch-guard.ts` does: importing
 * `cutover.ts` would run it, and this decision is worth a unit test.
 *
 * `unknown` is the whole point. `cutover.ts` used to ask
 * `byBlock.get(id)?.seasonId === scope.seasonId`, which reads `false` for a
 * block that is not in the map at all — the same answer it gives for a block
 * belonging to another season, which is skipped and reported as deliberately
 * left alone. So if the evidence's block ids ever stop matching the target
 * database (a re-import assigns fresh ids, or the clone is not the database the
 * evidence was taken against), a run would file every enumerated row under
 * "left alone", promote, delete nothing, and print `committed`. Nothing would
 * look wrong. An id the database has never heard of therefore gets its own
 * answer, and the caller refuses on it.
 */
export type ScopePlacement = 'in' | 'out' | 'unknown';

/**
 * @param blockId     the block an enumerated row says produces its replacement
 * @param known       every block id this database actually holds
 * @param seasonOf    the season of a known block's sheet, or null if unlabelled
 * @param scopeSeason the `--season` id, or null for every season
 */
export function placeInScope(
  blockId: string,
  known: ReadonlySet<string>,
  seasonOf: (id: string) => string | null,
  scopeSeason: string | null,
): ScopePlacement {
  if (!known.has(blockId)) return 'unknown';
  if (scopeSeason === null) return 'in';
  return seasonOf(blockId) === scopeSeason ? 'in' : 'out';
}

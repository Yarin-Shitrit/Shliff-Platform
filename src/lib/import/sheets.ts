import { eq, inArray } from 'drizzle-orm';
import type { AnyDb } from '@/lib/db-types';
import { sheets, uploads, blocks } from '@/db/schema/source';
import { seasons } from '@/db/schema/camp';
import { promotedRowCounts } from '@/lib/import/owned-rows';

export interface SheetRow {
  id: string;
  name: string;
  uploadId: string;
  filename: string;
  seasonId: string | null;
  seasonName: string | null;
  authoritative: boolean | null;
  /** When a lead marked this sheet as history (R42). Null means live. */
  retiredAt: Date | null;
  retiredBy: string | null;
}

export type SheetState = 'eligible' | 'undecided' | 'ambiguous' | 'superseded';

export interface SheetEligibility {
  sheetId: string;
  state: SheetState;
  /** Ids of the sheets this one conflicts with. Empty when uncontested. */
  contestedWith: string[];
}

/**
 * Clearing the season (`null`) also clears authority. Otherwise a decision
 * made under one season would survive un-labelling and silently re-apply if
 * the sheet is later labelled into a different season — the same "which
 * copy is real" question `setSheetAuthority` refuses to answer without a
 * season would then be answered by a choice nobody made for that season.
 *
 * Refuses an unknown `sheetId` rather than issuing a no-op UPDATE — the
 * quiet alternative is worse than `setSheetAuthority`'s Hebrew refusal
 * below: a lead sets a season, nothing happens, and there is no error to
 * read at all.
 */
export async function setSheetSeason(
  db: AnyDb, sheetId: string, seasonId: string | null,
): Promise<void> {
  const [sheet] = await db.select({ id: sheets.id }).from(sheets)
    .where(eq(sheets.id, sheetId));
  if (!sheet) throw new Error(`unknown sheet ${sheetId}`);

  await db.update(sheets)
    .set(seasonId === null ? { seasonId, authoritative: null } : { seasonId })
    .where(eq(sheets.id, sheetId));
}

/**
 * R53's guard, called from `setSheetAuthority` only on the `true` path.
 *
 * The ordinary way authority moves from one copy to another is:
 * `promoteBlock` reads the loser as `sheet-superseded`, its whole-block
 * `reject()` runs, and the W5 sweep (`sweep` in promote.ts) releases
 * whatever the loser no longer produces (W13/W14). A retired sheet never
 * takes that path — R43 makes a retired sheet's block a SKIP specifically
 * so retiring it can never run that sweep and delete rows nobody asked to
 * delete. Put those two facts together and there is a gap: if a sheet's
 * explicit same-season rival (`conflicts()` below) is retired AND was the
 * chosen copy AND still owns promoted rows, nothing will ever release
 * them — moving authority to `sheetId` does not touch the retired rival at
 * all, and the retired rival's own promote path is a skip, not a sweep.
 * Promoting `sheetId` then INSERTs a second copy of the same money beside
 * the first: no error, and `coverage` will not even show it, since a
 * retired block's rows are excluded there too (R44).
 *
 * The fix is not to let a retired block release its rows on this path —
 * that would make retiring a sheet destroy data as a side effect of an
 * unrelated action, exactly what R43 forbids. Instead this refuses the
 * transfer outright and tells the lead to `unretireSheet` the rival first.
 *
 * That restores the *visible* state exactly — with both copies live again,
 * the rival correctly reads `sheet-superseded` the moment `sheetId` is
 * chosen, so the register stops showing a live-looking sheet with an
 * un-collectable authority conflict. It does NOT, by itself, restore the
 * ordinary SWEEP: `promoteAllGated` (the app's actual bulk promote action)
 * gates on `promotedRowCounts` before ever calling `promoteBlock`, and the
 * rival's block already owns rows — so the gate skips it as
 * `'already-promoted'` and `reject()`/`sweep()` never runs for it through
 * that path. The rival's stale row physically leaves only through a direct
 * `promoteBlock` call, which today means `scripts/cutover.ts` (guarded,
 * evidence-gated, and deliberately the only caller allowed to re-promote a
 * block that already owns rows). The lead can re-retire `sheetId`'s old
 * rival afterwards either way.
 *
 * Not reachable for a season-less retired sheet (the eight ברן 23/24
 * sheets this feature exists for): `conflicts()` only lets a retired sheet
 * stay a rival through an EXPLICIT same-season match, and a season-less
 * sheet can never have been the chosen copy of anything in the first place
 * (`setSheetAuthority`'s own season check above forbids it). This only
 * fires for a sheet that was labelled, chosen, promoted, and only later
 * retired.
 */
async function refuseIfRetiredRivalOwnsRows(db: AnyDb, sheetId: string): Promise<void> {
  const all = await listSheets(db);
  const sheet = all.find((s) => s.id === sheetId);
  if (!sheet) return; // existence already checked by the caller

  const retiredRivals = all.filter((other) => other.retiredAt !== null && conflicts(sheet, other));
  if (retiredRivals.length === 0) return;

  const rivalBlocks = await db.select({ id: blocks.id }).from(blocks)
    .where(inArray(blocks.sheetId, retiredRivals.map((rival) => rival.id)));
  if (rivalBlocks.length === 0) return;

  const owned = await promotedRowCounts(db, rivalBlocks.map((b) => b.id));
  if (owned.size === 0) return;

  throw new Error(
    'אי אפשר לסמן את הגיליון הזה כסמכותי — לעותק שסומן כהיסטוריה של אותו גיליון (אותו שם, אותה עונה) יש '
    + 'עדיין שורות מקודמות, והעברת הסמכות לא תשחרר אותן — קודם צריך לבטל את סימון ההיסטוריה של העותק הישן',
  );
}

/**
 * `true` is refused on an unlabelled sheet. The season label is what tells
 * a repeated copy of one year's budget apart from a different year's, so
 * "which copy is real" has no defined answer before a season is set — see
 * conflicts() below. `true` is also refused when a retired, same-season
 * rival still owns promoted rows (R53; see `refuseIfRetiredRivalOwnsRows`).
 * Clearing (`false` or `null`) is always allowed, including on an
 * unlabelled sheet.
 *
 * The not-found case is a different failure from the unlabelled case and
 * gets a different message: a bad `sheetId` is a programmer error (an
 * English message, matching `applyConfirmation`'s `unknown block ${blockId}`
 * in confirm.ts), while an unlabelled sheet is a state a lead can act on by
 * setting a season, which the Hebrew message tells them to do. Conflating
 * the two would tell a caller with a bad id that the season is the problem,
 * which is simply false.
 */
export async function setSheetAuthority(
  db: AnyDb, sheetId: string, authoritative: boolean | null,
): Promise<void> {
  // Existence is checked on every path, not only `true`: an UPDATE with no
  // matching row silently no-ops, and a bad `sheetId` on the clearing paths
  // deserves the same not-found error the `true` path already throws.
  const [sheet] = await db.select({ seasonId: sheets.seasonId }).from(sheets)
    .where(eq(sheets.id, sheetId));
  if (!sheet) throw new Error(`unknown sheet ${sheetId}`);

  if (authoritative === true && sheet.seasonId === null) {
    throw new Error(
      'אי אפשר לסמן גיליון כסמכותי בלי עונה — בלי עונה אי אפשר להבחין בין גרסה כפולה של אותה שנה לגיליון של שנה אחרת',
    );
  }
  if (authoritative === true) {
    await refuseIfRetiredRivalOwnsRows(db, sheetId);
  }
  await db.update(sheets).set({ authoritative }).where(eq(sheets.id, sheetId));
}

/**
 * Marks a sheet as retired — history, not a decision waiting (R42). Refuses
 * an unknown `sheetId`, the same not-found error `setSheetSeason` throws: a
 * bad id here is a programmer error, not a state a lead can act on.
 *
 * Orthogonal to season and authority (R45): neither column is touched, and
 * neither is required. The eight closed-season sheets this exists for are
 * retired precisely because they have no season — the column records the
 * retirement, never the reason for it.
 */
export async function retireSheet(db: AnyDb, sheetId: string, email: string): Promise<void> {
  const [sheet] = await db.select({ id: sheets.id }).from(sheets)
    .where(eq(sheets.id, sheetId));
  if (!sheet) throw new Error(`unknown sheet ${sheetId}`);

  await db.update(sheets)
    .set({ retiredAt: new Date(), retiredBy: email })
    .where(eq(sheets.id, sheetId));
}

/**
 * Clears retirement. Season and authority are left exactly as they were —
 * see `retireSheet`. Refuses an unknown `sheetId` the same way.
 */
export async function unretireSheet(db: AnyDb, sheetId: string): Promise<void> {
  const [sheet] = await db.select({ id: sheets.id }).from(sheets)
    .where(eq(sheets.id, sheetId));
  if (!sheet) throw new Error(`unknown sheet ${sheetId}`);

  await db.update(sheets)
    .set({ retiredAt: null, retiredBy: null })
    .where(eq(sheets.id, sheetId));
}

export async function listSheets(db: AnyDb): Promise<SheetRow[]> {
  const rows = await db.select({
    id: sheets.id,
    name: sheets.name,
    uploadId: sheets.uploadId,
    filename: uploads.filename,
    seasonId: sheets.seasonId,
    seasonName: seasons.name,
    authoritative: sheets.authoritative,
    retiredAt: sheets.retiredAt,
    retiredBy: sheets.retiredBy,
  })
    .from(sheets)
    .innerJoin(uploads, eq(uploads.id, sheets.uploadId))
    .leftJoin(seasons, eq(seasons.id, sheets.seasonId));
  return rows;
}

/**
 * Two sheets conflict when they share a name and either share a season or
 * either one's season is unset — with one narrowing for retirement (R44),
 * and it is narrower than "a retired sheet conflicts with nothing":
 *
 * - Two retired sheets have nothing left to resolve between them: skip.
 * - An EXPLICIT contest — both sides name the same season — survives
 *   retirement. This is the case that matters: if sheet `a` was marked
 *   authoritative for season S, its block promoted, and `a` is later
 *   retired, sheet `b` (same name, same season S, never chosen) must NOT
 *   read as uncontested just because its only rival went away. `b` was
 *   never chosen either — retiring `a` answers "should we keep asking about
 *   `a`", not "is `b` now the real copy" — so the contest, and the
 *   requirement that a lead choose, must survive. (`sheetEligibility`
 *   below additionally never lets a retired sheet's stale `authoritative`
 *   flag count as the chosen one, so retiring the chosen copy of a contest
 *   does not silently crown the other side either — see `chosen` there.)
 * - Only the WILDCARD case — a season-less sheet conflicting with every
 *   same-named sheet regardless of year, because neither side has said
 *   which year it is — is suppressed by retirement. This is what the
 *   eight closed-season sheets need: they have no season (that is why
 *   they are retired), and without this line the wildcard would still pull
 *   each of them into every live, same-named sheet's collision forever.
 *
 * The unset case itself is deliberate: until a lead says which season a
 * sheet belongs to, the system genuinely cannot tell a second revision of
 * one season's budget from a different year's. Refusing is correct, and it
 * resolves the moment the season is set.
 */
function conflicts(a: SheetRow, b: SheetRow): boolean {
  if (a.id === b.id || a.name !== b.name) return false;
  if (a.retiredAt !== null && b.retiredAt !== null) return false;
  if (a.seasonId !== null && a.seasonId === b.seasonId) return true;
  if (a.retiredAt !== null || b.retiredAt !== null) return false;
  return a.seasonId === b.seasonId || a.seasonId === null || b.seasonId === null;
}

export async function sheetEligibility(db: AnyDb): Promise<Map<string, SheetEligibility>> {
  const all = await listSheets(db);
  const out = new Map<string, SheetEligibility>();

  for (const sheet of all) {
    const contested = all.filter((other) => conflicts(sheet, other));
    if (contested.length === 0) {
      out.set(sheet.id, { sheetId: sheet.id, state: 'eligible', contestedWith: [] });
      continue;
    }

    const group = [sheet, ...contested];
    // A retired sheet never counts as the chosen one, even if it still
    // carries `authoritative: true` from before it was retired (R45:
    // retiring does not clear authority). Retiring a sheet must never
    // TRANSFER its authority to the sheet it used to contest — that would
    // answer "which copy is real" with a choice nobody made, the exact
    // silent default the product's rules forbid. So a contest whose only
    // `true` is on a now-retired sheet reads as `chosen.length === 0`,
    // i.e. `undecided`: retiring the chosen copy of a contest puts the
    // decision back in front of a lead rather than crowning the survivor.
    const chosen = group.filter((s) => s.authoritative === true && s.retiredAt === null);
    const contestedWith = contested.map((s) => s.id);

    let state: SheetState;
    if (chosen.length === 0) state = 'undecided';
    else if (chosen.length > 1) state = 'ambiguous';
    else state = chosen[0].id === sheet.id ? 'eligible' : 'superseded';

    out.set(sheet.id, { sheetId: sheet.id, state, contestedWith });
  }

  return out;
}

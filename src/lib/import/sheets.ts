import { eq } from 'drizzle-orm';
import type { AnyDb } from '@/lib/db-types';
import { sheets, uploads } from '@/db/schema/source';
import { seasons } from '@/db/schema/camp';

export interface SheetRow {
  id: string;
  name: string;
  uploadId: string;
  filename: string;
  seasonId: string | null;
  seasonName: string | null;
  authoritative: boolean | null;
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
 * `true` is refused on an unlabelled sheet. The season label is what tells
 * a repeated copy of one year's budget apart from a different year's, so
 * "which copy is real" has no defined answer before a season is set — see
 * conflicts() below. Clearing (`false` or `null`) is always allowed,
 * including on an unlabelled sheet.
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
  if (authoritative === true) {
    const [sheet] = await db.select({ seasonId: sheets.seasonId }).from(sheets)
      .where(eq(sheets.id, sheetId));
    if (!sheet) throw new Error(`unknown sheet ${sheetId}`);
    if (sheet.seasonId === null) {
      throw new Error(
        'אי אפשר לסמן גיליון כסמכותי בלי עונה — בלי עונה אי אפשר להבחין בין גרסה כפולה של אותה שנה לגיליון של שנה אחרת',
      );
    }
  }
  await db.update(sheets).set({ authoritative }).where(eq(sheets.id, sheetId));
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
  })
    .from(sheets)
    .innerJoin(uploads, eq(uploads.id, sheets.uploadId))
    .leftJoin(seasons, eq(seasons.id, sheets.seasonId));
  return rows;
}

/**
 * Two sheets conflict when they share a name and either share a season or
 * either one's season is unset.
 *
 * The unset case is deliberate: until a lead says which season a sheet
 * belongs to, the system genuinely cannot tell a second revision of one
 * season's budget from a different year's. Refusing is correct, and it
 * resolves the moment the season is set.
 */
function conflicts(a: SheetRow, b: SheetRow): boolean {
  if (a.id === b.id || a.name !== b.name) return false;
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
    const chosen = group.filter((s) => s.authoritative === true);
    const contestedWith = contested.map((s) => s.id);

    let state: SheetState;
    if (chosen.length === 0) state = 'undecided';
    else if (chosen.length > 1) state = 'ambiguous';
    else state = chosen[0].id === sheet.id ? 'eligible' : 'superseded';

    out.set(sheet.id, { sheetId: sheet.id, state, contestedWith });
  }

  return out;
}

import { eq, isNotNull } from 'drizzle-orm';
import type { AnyDb } from '@/lib/db-types';
import { persons, personAliases, seasons } from '@/db/schema/camp';
import { blocks, sheets, uploads } from '@/db/schema/source';
import type { BlockArchetype } from '@/lib/classify/types';
import type { InboxKind } from './items';

export interface ResolvedItem {
  /** The same id the item carried while it was open, so a link survives. */
  id: string;
  kind: InboxKind;
  /** Hebrew: what was decided. */
  title: string;
  /** Hebrew: what it became. */
  detail: string;
  /**
   * The table's archetype, on a `block-undecided` decision and null on every
   * other kind. Carried as data rather than spelled into `detail`, because
   * the archetype's own name is an English identifier and the one Hebrew
   * record for it — `ARCHETYPE_LABELS` — lives with the imports screen that
   * owns it. A second copy here is how those two start disagreeing.
   */
  archetype: BlockArchetype | null;
  decidedBy: string | null;
  /** Null when the table stores no stamp for this decision — see the ruling. */
  decidedAt: Date | null;
}

const DEFAULT_LIMIT = 50;

/**
 * The טופלו tab: decisions already made.
 *
 * It reports only what the database already stamps. `person_aliases` and
 * `blocks` carry `confirmed_by` and `confirmed_at`, so a linked name, an
 * ignored name and a confirmed block each say who and when. `sheets` carries
 * no stamp, so a sheet that now has a season says so and says the date was
 * not kept. Borrowing `uploads.created_at` would put a date on screen that is
 * not the date of the decision, which is the class of lie this whole screen
 * exists to prevent.
 */
export async function resolvedItems(
  db: AnyDb, limit: number = DEFAULT_LIMIT,
): Promise<ResolvedItem[]> {
  const items: ResolvedItem[] = [];

  const aliasRows = await db
    .select({
      id: personAliases.id, alias: personAliases.alias,
      personId: personAliases.personId, displayName: persons.displayName,
      by: personAliases.confirmedBy, at: personAliases.confirmedAt,
    })
    .from(personAliases)
    .leftJoin(persons, eq(persons.id, personAliases.personId))
    .where(isNotNull(personAliases.confirmedBy));

  for (const row of aliasRows) {
    items.push({
      id: `name:${row.id}`,
      kind: 'unlinked-name',
      title: `״${row.alias}״`,
      detail: row.personId === null
        ? 'סומן כלא-אדם'
        : `קושר ל־${row.displayName ?? ''}`,
      archetype: null,
      decidedBy: row.by,
      decidedAt: row.at,
    });
  }

  const blockRows = await db
    .select({
      id: blocks.id, archetype: blocks.archetype, sheetName: sheets.name,
      by: blocks.confirmedBy, at: blocks.confirmedAt,
    })
    .from(blocks)
    .innerJoin(sheets, eq(sheets.id, blocks.sheetId))
    .where(isNotNull(blocks.confirmedAt));

  for (const row of blockRows) {
    items.push({
      id: `block:${row.id}`,
      kind: 'block-undecided',
      title: `״${row.sheetName}״ — אישור סיווג`,
      detail: 'הסיווג אושר',
      archetype: row.archetype,
      decidedBy: row.by,
      decidedAt: row.at,
    });
  }

  const sheetRows = await db
    .select({
      id: sheets.id, name: sheets.name, seasonName: seasons.name,
      authoritative: sheets.authoritative, filename: uploads.filename,
    })
    .from(sheets)
    .innerJoin(uploads, eq(uploads.id, sheets.uploadId))
    .innerJoin(seasons, eq(seasons.id, sheets.seasonId))
    .where(isNotNull(sheets.seasonId));

  for (const row of sheetRows) {
    const chosen = row.authoritative === true ? ' · נבחר כעותק המוסמך' : '';
    items.push({
      id: `sheet-season:${row.id}`,
      kind: 'sheet-season',
      // Named, not accused. The open item's title says the sheet has no year;
      // repeating it here would put that sentence beside the one saying which
      // year it now has.
      title: `גיליון ״${row.name}״`,
      detail: `שויך ל־${row.seasonName}${chosen} · נקבע — התאריך לא נשמר`,
      archetype: null,
      decidedBy: null,
      decidedAt: null,
    });
  }

  items.sort((a, b) => {
    if (a.decidedAt === null && b.decidedAt === null) return 0;
    if (a.decidedAt === null) return 1;
    if (b.decidedAt === null) return -1;
    return b.decidedAt.getTime() - a.decidedAt.getTime();
  });

  return items.slice(0, limit);
}

/** The top bar's `נוקו היום`. An undated decision is never counted as today's. */
export function clearedToday(items: readonly ResolvedItem[], now: Date): number {
  return items.filter((item) => (
    item.decidedAt !== null
    && item.decidedAt.getUTCFullYear() === now.getUTCFullYear()
    && item.decidedAt.getUTCMonth() === now.getUTCMonth()
    && item.decidedAt.getUTCDate() === now.getUTCDate()
  )).length;
}

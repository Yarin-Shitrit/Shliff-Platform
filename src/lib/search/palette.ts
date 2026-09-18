import type { AnyDb } from '@/lib/db-types';
import { listPeople } from '@/lib/members/dossier';
import { listMovements } from '@/lib/money/ledger';
import { listBudgetLines } from '@/lib/money/budget';
import { listSheets } from '@/lib/import/sheets';
import { normalizeHebrew } from '@/lib/text/normalize';
import { formatShekels } from '@/lib/money';

export type PaletteKind = 'person' | 'movement' | 'budget' | 'file';

export interface PaletteHit {
  kind: PaletteKind;
  id: string;
  title: string;
  /** The line under the title: what makes this hit the one you meant. */
  meta: string;
  href: string;
}

/** Enough to keep the list readable without a scrollbar per kind. */
const PER_KIND = 5;
/** One letter matches half the camp; two is the shortest useful question. */
const MIN_QUERY = 2;

/**
 * One query behind `⌘K` (B5), assembled from the list functions the screens
 * already use rather than from new SQL — the palette must not be able to
 * find a row that the page it links to would not show.
 *
 * Matching goes through `normalizeHebrew`, so `ראנצ'ו` finds `ראנצ׳ו`: the
 * geresh and the ASCII apostrophe are the same key on the same keyboard.
 */
export async function searchPalette(
  db: AnyDb, query: string, seasonId: string | null,
): Promise<PaletteHit[]> {
  const needle = normalizeHebrew(query);
  if (needle.length < MIN_QUERY) return [];
  const matches = (text: string | null) =>
    text !== null && normalizeHebrew(text).includes(needle);

  const hits: PaletteHit[] = [];

  for (const person of await listPeople(db)) {
    if (hits.length >= PER_KIND) break;
    if (!matches(person.displayName)) continue;
    hits.push({
      kind: 'person',
      id: person.personId,
      title: person.displayName,
      meta: person.outstandingAgorot > 0
        ? `חוב פתוח ${formatShekels(person.outstandingAgorot)}`
        : `${person.seasonCount} שנים`,
      href: `/members/${person.personId}`,
    });
  }

  let movements = 0;
  for (const movement of await listMovements(db, seasonId ? { seasonId } : {})) {
    if (movements >= PER_KIND) break;
    if (!matches(movement.description) && !matches(movement.accountName)) continue;
    movements += 1;
    hits.push({
      kind: 'movement',
      id: movement.id,
      title: movement.description,
      meta: `${formatShekels(movement.amountAgorot)} · ${movement.accountName ?? 'בלי חשבון'}`,
      // D7 repoints this at /money/ledger?peek= once that route exists (R6).
      href: `/money#movement-${movement.id}`,
    });
  }

  if (seasonId) {
    let lines = 0;
    for (const line of await listBudgetLines(db, seasonId)) {
      if (lines >= PER_KIND) break;
      if (!matches(line.label)) continue;
      lines += 1;
      hits.push({
        kind: 'budget',
        id: line.id,
        title: line.label,
        meta: formatShekels(line.totalAgorot),
        href: `/money#budget-${line.id}`,
      });
    }
  }

  let files = 0;
  for (const sheet of await listSheets(db)) {
    if (files >= PER_KIND) break;
    if (!matches(sheet.name) && !matches(sheet.filename)) continue;
    files += 1;
    hits.push({
      kind: 'file',
      id: sheet.id,
      title: `${sheet.filename} › ${sheet.name}`,
      meta: sheet.seasonName ?? 'בלי שנה',
      href: `/imports/${sheet.uploadId}`,
    });
  }

  return hits;
}

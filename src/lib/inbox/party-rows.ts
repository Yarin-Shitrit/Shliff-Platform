import { inArray } from 'drizzle-orm';
import type { AnyDb } from '@/lib/db-types';
import { obligations } from '@/db/schema/money';
import { normalizeHebrew } from '@/lib/text/normalize';

/**
 * How many promoted rows still carry each raw party string.
 *
 * `obligations.party_name` is the only column in this schema that holds a
 * name the promoter could not attribute — the ledger, the budget and the
 * ticket rounds carry no party at all — so this is the whole answer rather
 * than a sample of it. Checked against `src/db/schema/money.ts`, where
 * `party_name` occurs exactly once.
 *
 * It matters because it is the cost of the decision: linking a name rewrites
 * nothing by itself, and a lead deciding whether to bother should see how
 * many rows are waiting on the answer. The alternative the brief carried was
 * a hard-coded zero, which is a claim rather than a blank.
 *
 * Keyed by the raw alias exactly as `listUnlinkedNames` returns it, matched
 * on the normalized form — the queue stores the spelling it saw, and two
 * spellings that differ only in a geresh are the same name.
 */
export async function partyRowCounts(
  db: AnyDb, aliases: readonly string[],
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (aliases.length === 0) return counts;

  const rows = await db
    .select({ partyName: obligations.partyName })
    .from(obligations)
    .where(inArray(obligations.partyName, [...aliases]));

  const byNormalized = new Map<string, number>();
  for (const row of rows) {
    if (row.partyName === null) continue;
    const key = normalizeHebrew(row.partyName);
    byNormalized.set(key, (byNormalized.get(key) ?? 0) + 1);
  }

  for (const alias of aliases) {
    counts.set(alias, byNormalized.get(normalizeHebrew(alias)) ?? 0);
  }
  return counts;
}

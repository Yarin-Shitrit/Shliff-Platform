import { formatDateFull } from '@/lib/dates';

/**
 * Whether a movement falls on or before the day an account's balance was
 * counted — so it is already inside that figure and must not be added again.
 *
 * ## Why this exists
 *
 * `accounts.opening_balance` was seeded from the ברן 25 `מיקום` block:
 * `1,584 + 28,520 + 14,079.55 = 44,183.55`, which is the sheet's closing
 * line *after* every movement it lists, up to 30/10/2025. Those three
 * figures are a count the camp made, not a starting point the movements
 * build on. A movement dated inside the counted period that later gets an
 * account would, under plain `opening + Σ movements`, be subtracted from a
 * balance that already had it subtracted — `חצי שני למייצג נטלי 20,660`
 * placed in `עו״ש אופק` would show 14,079.55 dropping to −6,580.45 for
 * money that left once.
 *
 * So the rule is: a counted balance carries a date, and movements up to and
 * including that day are history. They can be attributed, they render in the
 * ledger, the running balance walks back through them, and the account's
 * figure does not move. Movements after the count are the ones that change
 * it. An account with no count date counts everything, which is what a
 * balance entered as a true opening (zero, or a first deposit) means.
 *
 * ## Why by camp calendar day and not by timestamp
 *
 * The workbook gives dates, not instants, and the promoter stores each as
 * midnight UTC. A manual movement typed on the count day is stored at
 * midnight *Israel*, which is 21:00Z or 22:00Z the evening before, and a
 * timestamp comparison would then file it before a promoted row of the same
 * day. Reading both through `formatDateFull` — the one place that decides
 * what day a timestamp is — keeps "the same day" meaning what the screen
 * shows for it. `DD/MM/YYYY` is rearranged to `YYYY-MM-DD` so plain string
 * order is date order.
 */
export function insideCount(occurredOn: Date, countedOn: Date | null): boolean {
  if (countedOn === null) return false;
  return campDayKey(occurredOn) <= campDayKey(countedOn);
}

function campDayKey(at: Date): string {
  const [day, month, year] = formatDateFull(at).split('/');
  return `${year}-${month}-${day}`;
}

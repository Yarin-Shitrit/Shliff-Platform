import type { AnyDb } from '@/lib/db-types';
import type { DueKind } from '@/db/schema/camp';
import { listRoster } from '@/lib/members/roster';
import { listDues } from '@/lib/fees/dues';
import { listPayments, settlementFor, type PaymentRow } from '@/lib/fees/payments';

/**
 * One row per roster member for a season, whether or not a due has been
 * issued to them yet. This is the view the dues page renders — unlike
 * `listDues`, which is driven by `dues` rows and so silently omits anyone the
 * camp has not billed yet, the person a lead most needs to see.
 *
 * `dueId` is null exactly when no due has been issued: `amountAgorot`, `kind`,
 * `exceptionReason` and `decidedBy` are null alongside it, and the member is
 * `settled: false` — nothing has been decided about them, and calling that
 * "settled" would hide them from every "who still owes" reading.
 */
export interface MemberFeeRow {
  personId: string;
  displayName: string;
  role: string;
  /** null when no due has been issued to this member yet. */
  dueId: string | null;
  amountAgorot: number | null;
  kind: DueKind | null;
  exceptionReason: string | null;
  decidedBy: string | null;
  paidAgorot: number;
  outstandingAgorot: number;
  settled: boolean;
  payments: PaymentRow[];
}

/**
 * The roster-driven view of a season's dues, ordered by display name — the
 * same order `listRoster` already returns, so no re-sort happens here.
 */
export async function listSeasonFees(db: AnyDb, seasonId: string): Promise<MemberFeeRow[]> {
  const roster = await listRoster(db, seasonId);
  const dueRows = await listDues(db, seasonId);
  const dueByPerson = new Map(dueRows.map((row) => [row.personId, row]));

  const rows: MemberFeeRow[] = [];
  for (const member of roster) {
    const due = dueByPerson.get(member.personId);
    if (!due) {
      rows.push({
        personId: member.personId,
        displayName: member.displayName,
        role: member.role,
        dueId: null,
        amountAgorot: null,
        kind: null,
        exceptionReason: null,
        decidedBy: null,
        paidAgorot: 0,
        outstandingAgorot: 0,
        settled: false,
        payments: [],
      });
      continue;
    }

    const settlement = await settlementFor(db, due.dueId);
    const payments = await listPayments(db, due.dueId);
    rows.push({
      personId: member.personId,
      displayName: member.displayName,
      role: member.role,
      dueId: due.dueId,
      amountAgorot: due.amountAgorot,
      kind: due.kind,
      exceptionReason: due.exceptionReason,
      decidedBy: due.decidedBy,
      paidAgorot: settlement.paidAgorot,
      outstandingAgorot: settlement.outstandingAgorot,
      settled: settlement.settled,
      payments,
    });
  }
  return rows;
}

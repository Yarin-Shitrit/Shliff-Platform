import { and, eq, isNotNull } from 'drizzle-orm';
import type { AnyDb } from '@/lib/db-types';
import {
  memberships, seasons, personAliases, dues, payments, taskAssignments, tasks,
} from '@/db/schema/camp';
import { toAgorot } from '@/lib/money';

/**
 * The change log reads five existing tables and adds none:
 *
 * | Entry               | Row it reads                          | Stamp                        | Missing |
 * |----------------------|----------------------------------------|-------------------------------|---------|
 * | `joined_season`      | `memberships` ⋈ `seasons`              | `joinedAt`                    | no actor — `memberships` records when, never who |
 * | `alias_linked`        | `person_aliases` where `confirmedAt` is set (and it did not arrive in a merge) | `confirmedAt` / `confirmedBy` | — |
 * | `alias_merged`        | `person_aliases` where `mergedFromPersonId` is set | `confirmedAt` / `confirmedBy` | — |
 * | `exception_decided`   | `dues` where `decidedBy` is set        | `decidedBy`                   | no timestamp — `dues` records who decided, never when. `createdAt` is when the due was *created*, a different fact, and borrowing it would be the fabricated date the promoter refuses elsewhere |
 * | `payment_recorded`    | `payments` ⋈ `dues`                    | `createdAt` / `recordedBy`    | — |
 * | `assigned`            | `task_assignments` ⋈ `tasks`           | `createdAt` / `assignedBy`    | — |
 *
 * So `at` is nullable and `by` is nullable, each for exactly one kind — the
 * type says which. Dated entries sort newest first; undated ones are grouped
 * at the end, because putting them at an assumed position in a chronology
 * would be the same invented fact the platform refuses elsewhere.
 *
 * This module returns structure, not sentences: the Hebrew wording is
 * assembled by the screen that renders it.
 */
export type ChangeKind =
  | 'joined_season' | 'alias_linked' | 'alias_merged'
  | 'exception_decided' | 'payment_recorded' | 'assigned';

export interface ChangeEntry {
  kind: ChangeKind;
  /** Null only for `exception_decided`. */
  at: Date | null;
  /** Null only for `joined_season`. */
  by: string | null;
  /** The season name, the alias, the task title, the payment's channel, or
   *  the exception's reason. */
  subject: string;
  /** For `payment_recorded` and `exception_decided`; null otherwise. */
  amountAgorot: number | null;
}

export async function personChangeLog(db: AnyDb, personId: string): Promise<ChangeEntry[]> {
  const entries: ChangeEntry[] = [];

  const seasonRows = await db
    .select({ seasonName: seasons.name, joinedAt: memberships.joinedAt })
    .from(memberships)
    .innerJoin(seasons, eq(seasons.id, memberships.seasonId))
    .where(eq(memberships.personId, personId));
  for (const row of seasonRows) {
    entries.push({
      kind: 'joined_season', at: row.joinedAt, by: null, subject: row.seasonName, amountAgorot: null,
    });
  }

  const aliasRows = await db
    .select({
      alias: personAliases.alias,
      confirmedAt: personAliases.confirmedAt,
      confirmedBy: personAliases.confirmedBy,
      mergedFromPersonId: personAliases.mergedFromPersonId,
    })
    .from(personAliases)
    .where(and(eq(personAliases.personId, personId), isNotNull(personAliases.confirmedAt)));
  for (const row of aliasRows) {
    entries.push({
      kind: row.mergedFromPersonId ? 'alias_merged' : 'alias_linked',
      at: row.confirmedAt,
      by: row.confirmedBy,
      subject: row.alias,
      amountAgorot: null,
    });
  }

  const dueRows = await db
    .select({
      decidedBy: dues.decidedBy, exceptionReason: dues.exceptionReason, amount: dues.amount,
    })
    .from(dues)
    .where(and(eq(dues.personId, personId), isNotNull(dues.decidedBy)));
  for (const row of dueRows) {
    entries.push({
      kind: 'exception_decided',
      at: null,
      by: row.decidedBy,
      subject: row.exceptionReason ?? '',
      amountAgorot: toAgorot(row.amount),
    });
  }

  const paymentRows = await db
    .select({
      createdAt: payments.createdAt, recordedBy: payments.recordedBy,
      channel: payments.channel, amount: payments.amount,
    })
    .from(payments)
    .innerJoin(dues, eq(dues.id, payments.dueId))
    .where(eq(dues.personId, personId));
  for (const row of paymentRows) {
    entries.push({
      kind: 'payment_recorded',
      at: row.createdAt,
      by: row.recordedBy,
      subject: row.channel,
      amountAgorot: toAgorot(row.amount),
    });
  }

  const assignmentRows = await db
    .select({
      createdAt: taskAssignments.createdAt, assignedBy: taskAssignments.assignedBy,
      title: tasks.title,
    })
    .from(taskAssignments)
    .innerJoin(tasks, eq(tasks.id, taskAssignments.taskId))
    .where(eq(taskAssignments.personId, personId));
  for (const row of assignmentRows) {
    entries.push({
      kind: 'assigned', at: row.createdAt, by: row.assignedBy, subject: row.title, amountAgorot: null,
    });
  }

  const dated = entries
    .filter((entry): entry is ChangeEntry & { at: Date } => entry.at !== null)
    .sort((a, b) => b.at.getTime() - a.at.getTime());
  const undated = entries.filter((entry) => entry.at === null);
  return [...dated, ...undated];
}

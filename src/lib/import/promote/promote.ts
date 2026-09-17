import { and, eq, notInArray } from 'drizzle-orm';
import type { AnyDb } from '@/lib/db-types';
import { blocks, blockMappings, sheets } from '@/db/schema/source';
import {
  ledgerEntries, budgetLines, ticketRounds, obligations,
} from '@/db/schema/money';
import { resolveName, recordUnlinkedName } from '@/lib/members/identity';
import { sheetEligibility } from '@/lib/import/sheets';
import { toAgorot, fromAgorot } from '@/lib/money';
import type { BlockArchetype } from '@/lib/classify/types';
import { blockRows } from './rows';
import { ledgerRow } from './ledger';
import { budgetRow } from './budget';
import { ticketRow } from './tickets';
import { obligationRow } from './obligations';
import type {
  PromotionResult, PromotedRow, Refusal, PromoteContext,
} from './types';

const TARGETS = {
  ledger: ledgerEntries,
  budget_lines: budgetLines,
  ticket_rounds: ticketRounds,
  obligations,
} as const;

type PromotableArchetype = keyof typeof TARGETS;

function hasPromoter(a: BlockArchetype): a is PromotableArchetype {
  return a in TARGETS;
}

function wholeBlock(
  block: { top: number }, reason: Refusal['reason'], message: string,
): Refusal {
  return { sheetRow: block.top, reason, message, cells: [] };
}

export async function promoteBlock(
  db: AnyDb, blockId: string, opts: { dryRun: boolean; recordedBy: string },
): Promise<PromotionResult> {
  const [block] = await db.select().from(blocks).where(eq(blocks.id, blockId));
  if (!block) throw new Error(`unknown block ${blockId}`);

  const base: Omit<PromotionResult, 'written' | 'refused' | 'deleted'> = {
    blockId, archetype: block.archetype, dryRun: opts.dryRun,
  };
  const reject = (r: Refusal): PromotionResult =>
    ({ ...base, written: [], refused: [r], deleted: 0 });

  if (!block.confirmedAt) {
    return reject(wholeBlock(block, 'unconfirmed', 'הבלוק עדיין לא אושר'));
  }
  if (!hasPromoter(block.archetype)) {
    return reject(wholeBlock(block, 'no-promoter',
      'לסוג הבלוק הזה אין עדיין מנגנון קידום — הוא מחכה לגל הבא'));
  }

  const eligibility = (await sheetEligibility(db)).get(block.sheetId);
  if (eligibility && eligibility.state !== 'eligible') {
    const messages = {
      undecided: 'אותו גיליון קיים ביותר מקובץ אחד ולא נבחר עותק מוסמך',
      ambiguous: 'יותר מעותק אחד סומן כמוסמך',
      superseded: 'העותק הזה לא נבחר כמוסמך',
    } as const;
    return reject(wholeBlock(block, `sheet-${eligibility.state}`, messages[eligibility.state]));
  }

  const [sheet] = await db.select().from(sheets).where(eq(sheets.id, block.sheetId));
  const [mapping] = await db.select().from(blockMappings)
    .where(eq(blockMappings.blockId, blockId));
  if (!mapping) {
    return reject(wholeBlock(block, 'unmapped-column', 'לבלוק אין מיפוי עמודות'));
  }

  const ctx: PromoteContext = {
    seasonId: sheet?.seasonId ?? null, recordedBy: opts.recordedBy, blockId,
  };

  const written: PromotedRow[] = [];
  const refused: Refusal[] = [];
  const producedRows: number[] = [];

  for (const row of blockRows(block, mapping.columnMap)) {
    // Dispatch to the archetype's pure promoter, collect the outcome,
    // then write. One branch per archetype; each writes with
    // .onConflictDoUpdate targeting [sourceBlockId, sourceRow].
    if (block.archetype === 'ledger') {
      const outcome = ledgerRow(row, ctx);
      if (!outcome.ok) {
        refused.push(outcome.refusal);
        continue;
      }
      producedRows.push(row.sheetRow);
      let id: string | null = null;
      if (!opts.dryRun) {
        const input = outcome.input;
        const values = {
          occurredOn: input.occurredOn,
          direction: input.direction,
          amount: fromAgorot(toAgorot(input.amount)),
          description: input.description,
          accountId: input.accountId ?? null,
          seasonId: input.seasonId ?? null,
          eventId: input.eventId ?? null,
          budgetLineId: input.budgetLineId ?? null,
          transferGroupId: input.transferGroupId ?? null,
          recordedBy: input.recordedBy,
          sourceBlockId: input.sourceBlockId ?? null,
          sourceRow: input.sourceRow ?? null,
        };
        const [row_] = await db.insert(ledgerEntries).values(values)
          .onConflictDoUpdate({
            target: [ledgerEntries.sourceBlockId, ledgerEntries.sourceRow],
            set: values,
          })
          .returning();
        id = row_.id;
      }
      written.push({
        table: 'ledger_entries', sheetRow: row.sheetRow, id,
        summary: outcome.input.description, notes: outcome.notes,
      });
    } else if (block.archetype === 'budget_lines') {
      const outcome = budgetRow(row, ctx);
      if (!outcome.ok) {
        refused.push(outcome.refusal);
        continue;
      }
      producedRows.push(row.sheetRow);
      let id: string | null = null;
      if (!opts.dryRun) {
        const input = outcome.input;
        const values = {
          seasonId: input.seasonId,
          label: input.label,
          quantityText: input.quantityText ?? null,
          quantityNum: input.quantityNum === undefined
            ? null : fromAgorot(toAgorot(input.quantityNum)),
          unitCost: input.unitCost === undefined
            ? null : fromAgorot(toAgorot(input.unitCost)),
          total: fromAgorot(toAgorot(input.total)),
          rationale: input.rationale ?? null,
          category: input.category,
          sourceBlockId: input.sourceBlockId ?? null,
          sourceRow: input.sourceRow ?? null,
        };
        const [row_] = await db.insert(budgetLines).values(values)
          .onConflictDoUpdate({
            target: [budgetLines.sourceBlockId, budgetLines.sourceRow],
            set: values,
          })
          .returning();
        id = row_.id;
      }
      written.push({
        table: 'budget_lines', sheetRow: row.sheetRow, id,
        summary: outcome.input.label, notes: outcome.notes,
      });
    } else if (block.archetype === 'ticket_rounds') {
      const outcome = ticketRow(row, ctx);
      if (!outcome.ok) {
        refused.push(outcome.refusal);
        continue;
      }
      producedRows.push(row.sheetRow);
      let id: string | null = null;
      if (!opts.dryRun) {
        const input = outcome.input;
        const values = {
          seasonId: input.seasonId,
          eventId: input.eventId ?? null,
          label: input.label,
          quantity: input.quantity ?? null,
          price: input.price === undefined ? null : fromAgorot(toAgorot(input.price)),
          total: fromAgorot(toAgorot(input.total)),
          sold: input.sold ?? false,
          sourceBlockId: input.sourceBlockId ?? null,
          sourceRow: input.sourceRow ?? null,
        };
        const [row_] = await db.insert(ticketRounds).values(values)
          .onConflictDoUpdate({
            target: [ticketRounds.sourceBlockId, ticketRounds.sourceRow],
            set: values,
          })
          .returning();
        id = row_.id;
      }
      written.push({
        table: 'ticket_rounds', sheetRow: row.sheetRow, id,
        summary: outcome.input.label, notes: outcome.notes,
      });
    } else {
      const outcome = obligationRow(row, ctx);
      if (!outcome.ok) {
        refused.push(outcome.refusal);
        continue;
      }
      producedRows.push(row.sheetRow);

      let partyPersonId: string | undefined;
      let partyName: string | undefined;
      const notes = [...outcome.notes];
      if (outcome.partyRaw !== null) {
        const resolution = await resolveName(db, outcome.partyRaw);
        if (resolution.personId) {
          partyPersonId = resolution.personId;
        } else {
          partyName = outcome.partyRaw;
          notes.push(`השם ${outcome.partyRaw} לא זוהה — נשמר כטקסט וממתין לקישור`);
          if (!opts.dryRun) await recordUnlinkedName(db, outcome.partyRaw, 'import');
        }
      }

      let id: string | null = null;
      if (!opts.dryRun) {
        const input = outcome.input;
        const values = {
          direction: input.direction,
          partyPersonId: partyPersonId ?? input.partyPersonId ?? null,
          partyName: partyName ?? input.partyName ?? null,
          description: input.description,
          amount: fromAgorot(toAgorot(input.amount)),
          seasonId: input.seasonId ?? null,
          openedOn: input.openedOn,
          sourceBlockId: input.sourceBlockId ?? null,
          sourceRow: input.sourceRow ?? null,
        };
        const [row_] = await db.insert(obligations).values(values)
          .onConflictDoUpdate({
            target: [obligations.sourceBlockId, obligations.sourceRow],
            set: values,
          })
          .returning();
        id = row_.id;
      }
      written.push({
        table: 'obligations', sheetRow: row.sheetRow, id,
        summary: outcome.input.description, notes,
      });
    }
  }

  // W5: a block owns its rows. Anything this block wrote before and no
  // longer produces is unreachable, so it is removed rather than orphaned.
  let deleted = 0;
  if (!opts.dryRun) {
    const table = TARGETS[block.archetype];
    const stale = producedRows.length === 0
      ? await db.delete(table).where(eq(table.sourceBlockId, blockId)).returning()
      : await db.delete(table).where(and(
        eq(table.sourceBlockId, blockId),
        notInArray(table.sourceRow, producedRows),
      )).returning();
    deleted = stale.length;
  }

  return {
    ...base, written, refused, deleted,
  };
}

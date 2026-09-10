import { asc, eq } from 'drizzle-orm';
import type { AnyDb } from '@/lib/db-types';
import { dues, payments, PAYMENT_CHANNELS } from '@/db/schema/camp';
import type { PaymentChannel } from '@/db/schema/camp';
import { toAgorot, fromAgorot } from '@/lib/money';
import { isBlank } from '@/lib/text/normalize';

export interface PaymentInput {
  dueId: string;
  /** In shekels. Must be positive. */
  amount: number;
  channel: PaymentChannel;
  paidOn: Date;
  /** Required when the channel is `קיזוז`. */
  note?: string;
  recordedBy: string;
}

export interface OffsetInput {
  /** One entry per due. Amounts are explicit — this never splits a total. */
  entries: Array<{ dueId: string; amount: number }>;
  /** What the offset was set against. Shared by every payment it creates. */
  note: string;
  paidOn: Date;
  recordedBy: string;
}

export interface PaymentRow {
  id: string;
  amountAgorot: number;
  channel: PaymentChannel;
  paidOn: Date;
  note: string | null;
  recordedBy: string;
}

export interface Settlement {
  dueAgorot: number;
  paidAgorot: number;
  /** Never negative: an overpayment reports zero outstanding and sets `overpaid`. */
  outstandingAgorot: number;
  settled: boolean;
  overpaid: boolean;
}

function validate(input: PaymentInput): void {
  if (!PAYMENT_CHANNELS.includes(input.channel)) {
    throw new Error(`unknown payment channel: ${input.channel}`);
  }
  if (input.amount <= 0) throw new Error('a payment amount must be positive');
  /*
   * Blankness is judged with normalizeHebrew, not `.trim()`. `.trim()` leaves
   * LRM, RLM and zero-width marks standing, and in an RTL UI a browser injects
   * those invisibly on copy-paste — a note made only of them looks blank to a
   * human and would pass. That matters here more than anywhere: the note is
   * the only thing tying an offset back to the debt it settled, and losing
   * that link is exactly what the source workbook already did.
   */
  if (input.channel === 'קיזוז' && isBlank(input.note)) {
    throw new Error('an offset must carry a note saying what it was set against');
  }
}

export async function recordPayment(db: AnyDb, input: PaymentInput): Promise<string> {
  validate(input);
  const [row] = await db.insert(payments).values({
    dueId: input.dueId,
    amount: fromAgorot(toAgorot(input.amount)),
    channel: input.channel,
    paidOn: input.paidOn,
    note: input.note?.trim() || null,
    recordedBy: input.recordedBy,
  }).returning();
  return row.id;
}

/**
 * Settles several dues against one debt in a single operation, so the five
 * payments behind `יוסף קארינה יונתן ירין ועילאי — 6,000` all point at the
 * same note instead of looking like five unrelated cash payments.
 */
export async function recordOffset(db: AnyDb, input: OffsetInput): Promise<string[]> {
  // `?? ''` for the same reason validate() has it: `note` is typed as required,
  // but the real callers are server actions building this from a request body,
  // where TypeScript guarantees nothing. Without it an omitted note degrades to
  // a raw TypeError instead of the module's own message.
  if (isBlank(input.note)) {
    throw new Error('an offset must carry a note saying what it was set against');
  }
  if (input.entries.length === 0) throw new Error('an offset needs at least one due');

  const ids: string[] = [];
  for (const entry of input.entries) {
    ids.push(await recordPayment(db, {
      dueId: entry.dueId,
      amount: entry.amount,
      channel: 'קיזוז',
      paidOn: input.paidOn,
      note: input.note,
      recordedBy: input.recordedBy,
    }));
  }
  return ids;
}

export async function listPayments(db: AnyDb, dueId: string): Promise<PaymentRow[]> {
  const rows = await db.select().from(payments)
    .where(eq(payments.dueId, dueId))
    .orderBy(asc(payments.paidOn));

  return rows.map((row) => ({
    id: row.id,
    amountAgorot: toAgorot(row.amount),
    channel: row.channel,
    paidOn: row.paidOn,
    note: row.note,
    recordedBy: row.recordedBy,
  }));
}

export async function deletePayment(db: AnyDb, paymentId: string): Promise<void> {
  await db.delete(payments).where(eq(payments.id, paymentId));
}

export async function settlementFor(db: AnyDb, dueId: string): Promise<Settlement> {
  const [due] = await db.select().from(dues).where(eq(dues.id, dueId));
  if (!due) throw new Error(`unknown due ${dueId}`);

  const dueAgorot = toAgorot(due.amount);
  const paidAgorot = (await listPayments(db, dueId))
    .reduce((total, row) => total + row.amountAgorot, 0);

  return {
    dueAgorot,
    paidAgorot,
    outstandingAgorot: Math.max(0, dueAgorot - paidAgorot),
    settled: paidAgorot >= dueAgorot,
    overpaid: paidAgorot > dueAgorot,
  };
}

import { eq } from 'drizzle-orm';
import type { AnyDb } from '@/lib/db-types';
import { accounts, ledgerEntries } from '@/db/schema/money';
import { payments } from '@/db/schema/camp';
import { HebrewRefusal } from '@/lib/errors/hebrew';

export interface AttributeInput {
  origin: 'ledger' | 'dues';
  id: string;
  accountId: string;
}

/**
 * Gives a movement the account it landed in.
 *
 * ## Why the offset refusal is here, when `listMovements` already hides one
 *
 * A `קיזוז` never reaches this function through `/money/ledger`: the ledger
 * union excludes it, so no row on that screen can offer the repair. The
 * refusal is here anyway, because the rule belongs to the money and not to
 * the query that happens to filter it. An offset settles a due against a debt
 * the camp already owes the payer; no cash moves, so there is no קופה it
 * could have entered, and putting it in one would add money to a balance that
 * never received any. A second caller — an import repair, a fees screen, a
 * script — must hit the same wall, and it will only do so if the wall is in
 * `src/lib` rather than in one route's action.
 *
 * ## Why changing an existing attribution is refused rather than allowed
 *
 * Moving a movement from one account to another changes two balances, and it
 * is a different act from placing money that was never placed. D7 asks only
 * for the second. Refusing the first keeps this function's blast radius to
 * one account and leaves the harder act to be designed on purpose.
 *
 * Every refusal is a `HebrewRefusal` (§5 A20): the alphabet passthrough in
 * `toHebrewError` answers "is this Hebrew?" when the question is "did someone
 * mean this?", and these are meant.
 */
export async function attributeMovement(db: AnyDb, input: AttributeInput): Promise<void> {
  if (input.origin === 'ledger') {
    const [entry] = await db
      .select({ accountId: ledgerEntries.accountId })
      .from(ledgerEntries)
      .where(eq(ledgerEntries.id, input.id));
    if (!entry) throw new HebrewRefusal('אין תנועה כזו');
    if (entry.accountId !== null) {
      throw new HebrewRefusal('התנועה הזו כבר משויכת לחשבון');
    }
    await requireAccount(db, input.accountId);
    await db.update(ledgerEntries)
      .set({ accountId: input.accountId })
      .where(eq(ledgerEntries.id, input.id));
    return;
  }

  const [payment] = await db
    .select({ accountId: payments.accountId, channel: payments.channel })
    .from(payments)
    .where(eq(payments.id, input.id));
  if (!payment) throw new HebrewRefusal('אין תנועה כזו');
  // Before the already-attributed check: an offset can never legitimately
  // hold an account, so "it moves no cash" is the true reason to refuse one,
  // not "it is already placed".
  if (payment.channel === 'קיזוז') {
    // Verbatim from `recordPayment` in src/lib/fees/payments.ts. A lead who
    // has met this sentence on /fees meets the same sentence here (E5).
    throw new HebrewRefusal('קיזוז אינו מזיז מזומן, ולכן אינו נכנס לחשבון');
  }
  if (payment.accountId !== null) {
    throw new HebrewRefusal('התנועה הזו כבר משויכת לחשבון');
  }
  await requireAccount(db, input.accountId);
  await db.update(payments)
    .set({ accountId: input.accountId })
    .where(eq(payments.id, input.id));
}

async function requireAccount(db: AnyDb, accountId: string): Promise<void> {
  const [account] = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(eq(accounts.id, accountId));
  if (!account) throw new HebrewRefusal('אין חשבון כזה');
}

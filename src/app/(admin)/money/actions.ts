'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/db';
import { requireAdmin } from '@/lib/auth/guard';
import type { ActionResult } from '@/lib/action-result';
import { toHebrewError, HebrewRefusal } from '@/lib/errors/hebrew';
import type { HebrewConstraints } from '@/lib/errors/hebrew';
import { parseDateInput } from '@/lib/dates';
import { countAccount, createAccount, setAccountHolder } from '@/lib/money/accounts';
import type { CountResult } from '@/lib/money/accounts';
import type { AccountKind } from '@/db/schema/money';
import { MONEY_ERRORS } from './error-messages';

/** R9: the boundary where an English message stops. */
function failed(error: unknown, constraints: HebrewConstraints = []): ActionResult {
  return { ok: false, error: toHebrewError(error, MONEY_ERRORS, constraints) };
}

/**
 * Where a balance shows: the overview's cards and tiles, the ledger's
 * running balance, the home page's figure and a person's page when they
 * hold a קופה. All of it reads `accountBalances`, so all of it is
 * revalidated, as the fees actions do for the rate.
 */
function revalidateBalances(): void {
  revalidatePath('/', 'layout');
}

export interface CountAccountInput {
  accountId: string;
  /** In shekels. */
  balance: number;
  /** `YYYY-MM-DD`, as the date input submits it. */
  countedOn: string;
}

/**
 * Records what an account holds as of a day.
 *
 * In scope because the camp did not keep its book through last year: the
 * ledger cannot derive today's figure, and the only honest way in is for a
 * lead to count it and say when. From that day on, every movement recorded
 * changes the figure; the ones before it are kept as the record of what is
 * known and stay inside the count.
 *
 * Every refusal is `countAccount`'s — no such account, a closed one, a day
 * in the future — except the unparsable date, which is refused here because
 * the string is this boundary's to read. The counts come back so the drawer
 * can say what the figure now rests on.
 */
export async function countAccountAction(
  input: CountAccountInput,
): Promise<ActionResult<CountResult>> {
  const admin = await requireAdmin();
  if (!admin.ok) return { ok: false, error: 'אין הרשאה' };
  let result: CountResult;
  try {
    const countedOn = parseDateInput(input.countedOn);
    if (countedOn === null) throw new HebrewRefusal('צריך לבחור את היום שבו נספר הכסף.');
    result = await countAccount(db, {
      accountId: input.accountId,
      balance: input.balance,
      countedOn,
    });
  } catch (error) {
    return failed(error);
  }
  revalidateBalances();
  return { ok: true, value: result };
}

export interface NewAccountInput {
  name: string;
  kind: AccountKind;
  /** In shekels. What the account holds, or starts from. */
  balance: number;
  /** `YYYY-MM-DD` when `balance` is a count of that day; omitted when it is
   *  a true opening that every movement builds on. The drawer makes the
   *  lead choose, because the system cannot tell the two apart. */
  countedOn?: string;
}

const ACCOUNT_KINDS: readonly AccountKind[] = ['cash', 'bank', 'personal', 'event_float'];

/**
 * A new place money sits, with what it holds today.
 *
 * `kind` is checked against the schema's four values here, before
 * `createAccount` is called: the column is `text` with a TypeScript type
 * over it, so a bad value from the client would be stored in silence.
 */
export async function createAccountAction(input: NewAccountInput): Promise<ActionResult<string>> {
  const admin = await requireAdmin();
  if (!admin.ok) return { ok: false, error: 'אין הרשאה' };
  const constraints: HebrewConstraints = [
    ['accounts_name_unique', `כבר קיים חשבון בשם "${input.name.trim()}".`],
  ];
  let id: string;
  try {
    if (!ACCOUNT_KINDS.includes(input.kind)) throw new HebrewRefusal('סוג החשבון לא מוכר.');
    let countedOn: Date | undefined;
    if (input.countedOn !== undefined) {
      const parsed = parseDateInput(input.countedOn);
      if (parsed === null) throw new HebrewRefusal('צריך לבחור את היום שבו נספר הכסף.');
      countedOn = parsed;
    }
    const account = await createAccount(db, {
      name: input.name.trim(),
      kind: input.kind,
      openingBalance: input.balance,
      openingOn: countedOn,
    });
    id = account.id;
  } catch (error) {
    return failed(error, constraints);
  }
  revalidateBalances();
  return { ok: true, value: id };
}

export interface SetHolderInput {
  accountId: string;
  /** Empty means nobody holds it. */
  holderPersonId: string;
}

/**
 * Says who holds an account from now on. The refusals — no such account, a
 * person who is not on the list or was merged away — are `setAccountHolder`'s
 * own. The holder shows on the card, on the person's page and in the delete
 * preview, so the whole layout is revalidated as every balance change is.
 */
export async function setAccountHolderAction(input: SetHolderInput): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!admin.ok) return { ok: false, error: 'אין הרשאה' };
  try {
    await setAccountHolder(db, input.accountId, input.holderPersonId === '' ? null : input.holderPersonId);
  } catch (error) {
    return failed(error);
  }
  revalidateBalances();
  return { ok: true };
}

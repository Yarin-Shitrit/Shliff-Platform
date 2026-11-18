import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { db } from '@/db';
import { requireAdmin } from '@/lib/auth/guard';
import { toHebrewError } from '@/lib/errors/hebrew';
import { getStorage } from '@/lib/storage';
import { recordExpense } from '@/lib/money/expenses';
import { EXPENSE_REFUSALS, RECORD_REFUSALS } from '@/lib/money/expense-refusals';
import { isExpenseCategory } from '@/lib/money/expense-categories';
import {
  MAX_RECEIPT_BYTES, MAX_RECEIPT_REQUEST_BYTES, newReceiptKey, sniffReceipt,
} from '@/lib/money/receipt-file';
import { MONEY_ERRORS } from '../../error-messages';

/**
 * `POST /money/expenses/record`: one expense, with its receipt's photo when
 * there is one. Multipart, because the photo travels with the fields.
 *
 * A route and not a server action for the reason the map's underlay is one:
 * server actions take 1 MB bodies by default, and raising that means editing
 * the shared `next.config.ts`.
 *
 * It always answers JSON — `{ ok: true }` or `{ ok: false, error }` with the
 * error already in Hebrew — and nothing here may throw: an unhandled throw
 * leaves as an HTML error page and the form has nothing to show.
 *
 * The photo is stored first and the movement written second. If the photo
 * cannot be stored the expense is **not** recorded: saving it without the
 * receipt the person just attached would be the system deciding the photo did
 * not matter. If the movement is then refused, a photo nobody points at stays
 * in storage, unreachable — the receipt route serves a key only through the
 * movement that names it.
 */

function refuse(error: string, status: number): NextResponse {
  return NextResponse.json({ ok: false, error }, { status });
}

function text(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === 'string' ? value.trim() : '';
}

export async function POST(request: Request): Promise<NextResponse> {
  const admin = await requireAdmin('expenses', 'edit');
  if (!admin.ok) return refuse(RECORD_REFUSALS.unauthorized, 401);

  // A body that says it is too big is refused before a byte of it is read.
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_RECEIPT_REQUEST_BYTES) {
    return refuse(RECORD_REFUSALS.tooLarge, 413);
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return refuse(RECORD_REFUSALS.unreadable, 400);
  }

  const categoryText = text(form, 'category');
  if (categoryText !== '' && !isExpenseCategory(categoryText)) {
    return refuse(EXPENSE_REFUSALS.category, 400);
  }
  const category = isExpenseCategory(categoryText) ? categoryText : undefined;

  // The photo, when one was attached. An empty file part is what a browser
  // sends for a file input nobody touched, and it means no photo.
  const file = form.get('receipt');
  let receiptKey: string | undefined;
  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_RECEIPT_BYTES) return refuse(RECORD_REFUSALS.tooLarge, 413);
    const bytes = Buffer.from(await file.arrayBuffer());
    const ext = sniffReceipt(bytes);
    if (ext === null) return refuse(RECORD_REFUSALS.notAPicture, 415);
    receiptKey = newReceiptKey(ext);
    try {
      await getStorage().put(receiptKey, bytes);
    } catch (error) {
      console.error('receipt not stored', error);
      return refuse(RECORD_REFUSALS.storage, 503);
    }
  }

  try {
    await recordExpense(db, {
      // `2026-11-18` reads as that day's midnight UTC, which is the same
      // calendar day in the camp — the ledger's own form does the same.
      occurredOn: new Date(text(form, 'occurredOn')),
      // `1,250.50` is how a person types it; the commas carry nothing.
      amount: Number(text(form, 'amount').replace(/,/g, '')),
      description: text(form, 'description'),
      accountId: text(form, 'accountId'),
      seasonId: text(form, 'seasonId'),
      category,
      receiptKey,
      // From the session, never from the form.
      recordedBy: admin.email,
    });
  } catch (error) {
    return refuse(toHebrewError(error, MONEY_ERRORS), 400);
  }

  revalidatePath('/money/expenses');
  revalidatePath('/money/ledger');
  revalidatePath('/money');
  return NextResponse.json({ ok: true }, { status: 201 });
}

'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/db';
import { requireAdmin } from '@/lib/auth/guard';
import type { ActionResult } from '@/lib/action-result';
import { issueFlatDues, setException, clearException } from '@/lib/fees/dues';
import { recordPayment } from '@/lib/fees/payments';
import type { PaymentChannel } from '@/db/schema/camp';

function failed(error: unknown): ActionResult {
  return { ok: false, error: error instanceof Error ? error.message : 'שגיאה' };
}

export async function issueDuesAction(seasonId: string): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!admin.ok) return { ok: false, error: 'אין הרשאה' };
  try {
    await issueFlatDues(db, seasonId);
  } catch (error) {
    return failed(error);
  }
  revalidatePath('/fees');
  return { ok: true };
}

export async function setExceptionAction(input: {
  personId: string;
  seasonId: string;
  amount: number;
  reason: string;
}): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!admin.ok) return { ok: false, error: 'אין הרשאה' };
  try {
    // The reason is mandatory here too. The client check is convenience;
    // this one is the rule.
    await setException(db, { ...input, decidedBy: admin.email });
  } catch (error) {
    return failed(error);
  }
  revalidatePath('/fees');
  return { ok: true };
}

export async function clearExceptionAction(
  personId: string,
  seasonId: string,
): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!admin.ok) return { ok: false, error: 'אין הרשאה' };
  try {
    await clearException(db, personId, seasonId);
  } catch (error) {
    return failed(error);
  }
  revalidatePath('/fees');
  return { ok: true };
}

export async function recordPaymentAction(input: {
  dueId: string;
  amount: number;
  channel: PaymentChannel;
  paidOn: string;
  note?: string;
}): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!admin.ok) return { ok: false, error: 'אין הרשאה' };
  try {
    await recordPayment(db, {
      dueId: input.dueId,
      amount: input.amount,
      channel: input.channel,
      paidOn: new Date(input.paidOn),
      note: input.note,
      recordedBy: admin.email,
    });
  } catch (error) {
    return failed(error);
  }
  revalidatePath('/fees');
  return { ok: true };
}

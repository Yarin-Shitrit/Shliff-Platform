'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/db';
import { requireAdmin } from '@/lib/auth/guard';
import type { ActionResult } from '@/lib/action-result';
import { setCrewMember } from '@/lib/logistics/workdays';
import { WORKDAYS_PATH } from '@/lib/logistics/workdays-views';
import { crewFailureMessage } from './failure-messages';

/**
 * This file exports only async functions (see `use-server-exports.test.ts`).
 *
 * One person onto one task, or off it. The grant is the plan's: the crew is
 * part of the work plan, and this screen sits under it. The undo is this
 * action with the opposite `on` (E2).
 */
export async function setCrewMemberAction(
  itemId: string, personId: string, on: boolean,
): Promise<ActionResult> {
  const admin = await requireAdmin('plan', 'edit');
  if (!admin.ok) return { ok: false, error: 'אין הרשאה' };
  try {
    await setCrewMember(db, itemId, personId, on, admin.email);
    revalidatePath(WORKDAYS_PATH);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: crewFailureMessage(error) };
  }
}

'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/db';
import { requireAdmin } from '@/lib/auth/guard';
import type { ActionResult } from '@/lib/action-result';
import { scheduleItem, type Schedule } from '@/lib/logistics/plan';
import { setCrewMember } from '@/lib/logistics/workdays';
import { PLAN_PATH } from '@/lib/logistics/plan-views';
import { WORKDAYS_PATH } from '@/lib/logistics/workdays-views';
import { itemFailureMessage } from '../failure-messages';
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

/**
 * A task's days, written from this screen: pulled onto the day on screen
 * (a one-day item on it, as the board's right-click does) or taken off it
 * (no days at all). The same write as the board's, so both screens
 * revalidate. The undo is this action with the days that were (E2).
 */
export async function placeTaskAction(itemId: string, schedule: Schedule): Promise<ActionResult> {
  const admin = await requireAdmin('plan', 'edit');
  if (!admin.ok) return { ok: false, error: 'אין הרשאה' };
  try {
    await scheduleItem(db, itemId, schedule, admin.email);
    revalidatePath(PLAN_PATH);
    revalidatePath(WORKDAYS_PATH);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: itemFailureMessage(error) };
  }
}

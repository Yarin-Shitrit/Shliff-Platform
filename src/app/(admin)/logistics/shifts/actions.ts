'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/db';
import { requireAdmin } from '@/lib/auth/guard';
import type { ActionResult } from '@/lib/action-result';
import {
  createShiftType, updateShiftType, setShiftTypeRetired, scheduleShifts,
  updateShiftSlot, cancelShiftSlot, assignToShift, unassignFromShift, seasonWindow,
  type ShiftTypeInput, type ScheduleInput, type SlotUpdate,
} from '@/lib/logistics/shifts';
import { SHIFTS_PATH } from '@/lib/logistics/shifts-views';
import { assignFailureMessage, slotFailureMessage, typeFailureMessage } from './failure-messages';

/**
 * This file exports only async functions (see `use-server-exports.test.ts`).
 *
 * Every write here also revalidates `/tasks`: a scheduled shift is a task,
 * and the board, the sidebar's understaffed count and the home tile all read
 * the same rows.
 */

function touched(): void {
  revalidatePath(SHIFTS_PATH);
  revalidatePath('/tasks');
  revalidatePath('/');
}

export async function createShiftTypeAction(input: ShiftTypeInput): Promise<ActionResult<string>> {
  const admin = await requireAdmin();
  if (!admin.ok) return { ok: false, error: 'אין הרשאה' };
  try {
    const id = await createShiftType(db, input, admin.email);
    touched();
    return { ok: true, value: id };
  } catch (error) {
    return { ok: false, error: typeFailureMessage(error) };
  }
}

export async function updateShiftTypeAction(id: string, input: ShiftTypeInput): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!admin.ok) return { ok: false, error: 'אין הרשאה' };
  try {
    await updateShiftType(db, id, input, admin.email);
    touched();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: typeFailureMessage(error) };
  }
}

export async function setShiftTypeRetiredAction(id: string, retired: boolean): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!admin.ok) return { ok: false, error: 'אין הרשאה' };
  try {
    await setShiftTypeRetired(db, id, retired, admin.email);
    touched();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: typeFailureMessage(error) };
  }
}

/** Returns the task ids made, first day first, so the screen can open one. */
export async function scheduleShiftsAction(input: ScheduleInput): Promise<ActionResult<string[]>> {
  const admin = await requireAdmin();
  if (!admin.ok) return { ok: false, error: 'אין הרשאה' };
  try {
    const window = await seasonWindow(db, input.seasonId);
    const made = await scheduleShifts(db, input, window);
    touched();
    return { ok: true, value: made };
  } catch (error) {
    return { ok: false, error: slotFailureMessage(error) };
  }
}

export async function updateShiftSlotAction(
  seasonId: string, taskId: string, input: SlotUpdate,
): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!admin.ok) return { ok: false, error: 'אין הרשאה' };
  try {
    const window = await seasonWindow(db, seasonId);
    await updateShiftSlot(db, taskId, input, window);
    touched();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: slotFailureMessage(error) };
  }
}

export async function cancelShiftSlotAction(taskId: string): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!admin.ok) return { ok: false, error: 'אין הרשאה' };
  try {
    await cancelShiftSlot(db, taskId);
    touched();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: slotFailureMessage(error) };
  }
}

/**
 * Several people at once. The names that landed stay; the failures come
 * back as one sentence, de-duplicated, as the board's own action does it.
 */
export async function assignToShiftAction(taskId: string, personIds: string[]): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!admin.ok) return { ok: false, error: 'אין הרשאה' };
  let failures: unknown[];
  try {
    ({ failures } = await assignToShift(db, taskId, personIds, admin.email));
  } catch (error) {
    return { ok: false, error: assignFailureMessage(error) };
  }
  touched();
  if (failures.length === 0) return { ok: true };
  return { ok: false, error: [...new Set(failures.map(assignFailureMessage))].join(' · ') };
}

export async function unassignFromShiftAction(assignmentId: string): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!admin.ok) return { ok: false, error: 'אין הרשאה' };
  try {
    await unassignFromShift(db, assignmentId);
    touched();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: assignFailureMessage(error) };
  }
}

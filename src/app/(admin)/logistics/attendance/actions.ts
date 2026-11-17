'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/db';
import { requireAdmin } from '@/lib/auth/guard';
import type { ActionResult } from '@/lib/action-result';
import {
  createEvent, updateEvent, setEventCancelled, setMark, addPersonalMark, removePersonalMark,
  type EventInput, type PersonalMarkInput,
} from '@/lib/logistics/attendance';
import { ATTENDANCE_PATH } from '@/lib/logistics/attendance-views';
import { eventFailureMessage, markFailureMessage, personalFailureMessage } from './failure-messages';

/**
 * This file exports only async functions. A `'use server'` module that
 * exports anything else — a string constant beside its actions — makes Next
 * reject the whole module and return 500 on every route including
 * `/signin`, while tsc, eslint, next build and the unit tests all pass.
 */

/**
 * A new occasion by hand, which is the only way one gets onto this board:
 * there is no attendance workbook to import, so every check here is one a
 * lead made. Returns the new id so the drawer can reopen over the day it
 * just made — the next thing a lead does with a new day is tick who came.
 */
export async function createEventAction(
  seasonId: string, input: EventInput,
): Promise<ActionResult<string>> {
  const admin = await requireAdmin('attendance', 'edit');
  if (!admin.ok) return { ok: false, error: 'אין הרשאה' };

  try {
    const id = await createEvent(db, seasonId, input, admin.email);
    revalidatePath(ATTENDANCE_PATH);
    return { ok: true, value: id };
  } catch (error) {
    return { ok: false, error: eventFailureMessage(error) };
  }
}

/** The drawer's save. Every field travels every time (see `EventInput`). */
export async function updateEventAction(id: string, input: EventInput): Promise<ActionResult> {
  const admin = await requireAdmin('attendance', 'edit');
  if (!admin.ok) return { ok: false, error: 'אין הרשאה' };

  try {
    await updateEvent(db, id, input, admin.email);
    revalidatePath(ATTENDANCE_PATH);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: eventFailureMessage(error) };
  }
}

/** Cancels an occasion or brings it back. Its marks stay either way. */
export async function setEventCancelledAction(
  id: string, cancelled: boolean,
): Promise<ActionResult> {
  const admin = await requireAdmin('attendance', 'edit');
  if (!admin.ok) return { ok: false, error: 'אין הרשאה' };

  try {
    await setEventCancelled(db, id, cancelled, admin.email);
    revalidatePath(ATTENDANCE_PATH);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: eventFailureMessage(error) };
  }
}

/**
 * One check on the board. `present: false` is the undo of `present: true`
 * and the other way round, which is what lets the toast offer ביטול with
 * the domain's own inverse (E2).
 */
export async function setMarkAction(
  eventId: string, personId: string, present: boolean,
): Promise<ActionResult> {
  const admin = await requireAdmin('attendance', 'edit');
  if (!admin.ok) return { ok: false, error: 'אין הרשאה' };

  try {
    await setMark(db, eventId, personId, present, admin.email);
    revalidatePath(ATTENDANCE_PATH);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: markFailureMessage(error) };
  }
}

/**
 * A personal mark: one thing one person did on their own, counted beside
 * the days they came to. Returns the new id so the toast can offer the
 * inverse, `removePersonalMarkAction(id)` (E2).
 */
export async function addPersonalMarkAction(
  seasonId: string, input: PersonalMarkInput,
): Promise<ActionResult<string>> {
  const admin = await requireAdmin('attendance', 'edit');
  if (!admin.ok) return { ok: false, error: 'אין הרשאה' };

  try {
    const id = await addPersonalMark(db, seasonId, input, admin.email);
    revalidatePath(ATTENDANCE_PATH);
    return { ok: true, value: id };
  } catch (error) {
    return { ok: false, error: personalFailureMessage(error) };
  }
}

/** Takes a personal mark back. Its undo is `addPersonalMarkAction` with what the row said. */
export async function removePersonalMarkAction(id: string): Promise<ActionResult> {
  const admin = await requireAdmin('attendance', 'edit');
  if (!admin.ok) return { ok: false, error: 'אין הרשאה' };

  try {
    await removePersonalMark(db, id);
    revalidatePath(ATTENDANCE_PATH);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: personalFailureMessage(error) };
  }
}

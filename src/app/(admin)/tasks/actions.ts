'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/db';
import { requireAdmin } from '@/lib/auth/guard';
import type { ActionResult } from '@/lib/action-result';
import {
  createTask, setTaskStatus, setTaskBudgetLine, type NewTask,
} from '@/lib/work/tasks';
import {
  assignPerson, setAssignmentStatus, removeAssignment,
} from '@/lib/work/coverage';
import type { AssignmentStatus, TaskStatus } from '@/db/schema/camp';
import {
  assignFailureMessage, createTaskFailureMessage, actionFailureMessage,
} from './failure-messages';

/**
 * Several people at once, because that is how a lead staffs a shift.
 *
 * A failure part-way through does not roll the batch back: the assignments
 * that landed are correct, and undoing them to report one duplicate would
 * cost a lead the work they just did. The failures come back as one
 * sentence, de-duplicated — five people already assigned is one message,
 * not five.
 */
export async function assignPeopleAction(
  taskId: string, personIds: string[],
): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!admin.ok) return { ok: false, error: 'אין הרשאה' };
  const failures: string[] = [];
  for (const personId of personIds) {
    try {
      await assignPerson(db, taskId, personId, admin.email);
    } catch (error) {
      failures.push(assignFailureMessage(error));
    }
  }
  revalidatePath('/tasks');
  if (failures.length === 0) return { ok: true };
  return { ok: false, error: [...new Set(failures)].join(' · ') };
}

export async function setAssignmentStatusAction(
  assignmentId: string, status: AssignmentStatus,
): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!admin.ok) return { ok: false, error: 'אין הרשאה' };
  try {
    await setAssignmentStatus(db, assignmentId, status);
  } catch (error) {
    return { ok: false, error: actionFailureMessage(error, 'עדכון השיבוץ נכשל. נסו שוב.') };
  }
  revalidatePath('/tasks');
  return { ok: true };
}

export async function removeAssignmentAction(
  assignmentId: string,
): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!admin.ok) return { ok: false, error: 'אין הרשאה' };
  try {
    await removeAssignment(db, assignmentId);
  } catch (error) {
    return { ok: false, error: actionFailureMessage(error, 'הסרת השיבוץ נכשלה. נסו שוב.') };
  }
  revalidatePath('/tasks');
  return { ok: true };
}

/**
 * `budgetAmount` is deliberately absent from the input type. The column is
 * deprecated in place — `src/db/schema/camp.ts` says "kept for existing
 * rows, written by nothing" — and the old form wrote it anyway. Leaving it
 * out of the type is what makes that impossible from this screen rather
 * than merely discouraged.
 */
export async function createTaskAction(
  input: Omit<NewTask, 'startsAt' | 'endsAt' | 'dueOn' | 'budgetAmount'> & {
    startsAt?: string; endsAt?: string; dueOn?: string;
  },
): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!admin.ok) return { ok: false, error: 'אין הרשאה' };
  try {
    await createTask(db, {
      ...input,
      startsAt: input.startsAt ? new Date(input.startsAt) : undefined,
      endsAt: input.endsAt ? new Date(input.endsAt) : undefined,
      dueOn: input.dueOn ? new Date(input.dueOn) : undefined,
    });
  } catch (error) {
    return { ok: false, error: createTaskFailureMessage(error) };
  }
  revalidatePath('/tasks');
  return { ok: true };
}

export async function setTaskStatusAction(
  taskId: string, status: TaskStatus,
): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!admin.ok) return { ok: false, error: 'אין הרשאה' };
  try {
    await setTaskStatus(db, taskId, status);
  } catch (error) {
    return { ok: false, error: actionFailureMessage(error, 'שינוי מצב המשימה נכשל. נסו שוב.') };
  }
  revalidatePath('/tasks');
  return { ok: true };
}

/** Links a deliverable that already exists to its budget line — the case
 *  `setTaskBudgetLine`'s own docstring describes. Creation passes
 *  `budgetLineId` straight to `createTask`. */
export async function setTaskBudgetLineAction(
  taskId: string, budgetLineId: string,
): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!admin.ok) return { ok: false, error: 'אין הרשאה' };
  try {
    await setTaskBudgetLine(db, taskId, budgetLineId);
  } catch (error) {
    return { ok: false, error: actionFailureMessage(error, 'שיוך סעיף התקציב נכשל. נסו שוב.') };
  }
  revalidatePath('/tasks');
  return { ok: true };
}

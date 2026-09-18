'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/db';
import { requireAdmin } from '@/lib/auth/guard';
import type { ActionResult } from '@/lib/action-result';
import { createTask, setTaskStatus, type NewTask } from '@/lib/work/tasks';
import {
  assignPerson, setAssignmentStatus, removeAssignment,
} from '@/lib/work/coverage';
import type { AssignmentStatus, TaskStatus } from '@/db/schema/camp';

function failed(error: unknown): ActionResult {
  return { ok: false, error: error instanceof Error ? error.message : 'שגיאה' };
}

export async function assignPersonAction(
  taskId: string, personId: string,
): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!admin.ok) return { ok: false, error: 'אין הרשאה' };
  try {
    await assignPerson(db, taskId, personId, admin.email);
  } catch { return { ok: false, error: 'האדם כבר משובץ למשימה הזו' }; }
  revalidatePath('/tasks');
  return { ok: true };
}

export async function setAssignmentStatusAction(
  assignmentId: string, status: AssignmentStatus,
): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!admin.ok) return { ok: false, error: 'אין הרשאה' };
  try {
    await setAssignmentStatus(db, assignmentId, status);
  } catch (error) { return failed(error); }
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
  } catch (error) { return failed(error); }
  revalidatePath('/tasks');
  return { ok: true };
}

export async function createTaskAction(
  input: Omit<NewTask, 'startsAt' | 'endsAt' | 'dueOn'> & {
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
  } catch (error) { return failed(error); }
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
  } catch (error) { return failed(error); }
  revalidatePath('/tasks');
  return { ok: true };
}

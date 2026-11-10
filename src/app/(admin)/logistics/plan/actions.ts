'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/db';
import { requireAdmin } from '@/lib/auth/guard';
import type { ActionResult } from '@/lib/action-result';
import type { WorkItemStatus } from '@/db/schema/logistics';
import {
  createTopic, updateTopic, setTopicArchived,
  createItem, updateItem, scheduleItem, setItemStatus,
  addDependency, removeDependency,
  type TopicInput, type ItemInput, type Schedule,
} from '@/lib/logistics/plan';
import { PLAN_PATH } from '@/lib/logistics/plan-views';
import { dependencyFailureMessage, itemFailureMessage, topicFailureMessage } from './failure-messages';

/**
 * This file exports only async functions (see `use-server-exports.test.ts`).
 * Every write revalidates the plan alone: nothing else reads these rows.
 */

export async function createTopicAction(seasonId: string, input: TopicInput): Promise<ActionResult<string>> {
  const admin = await requireAdmin();
  if (!admin.ok) return { ok: false, error: 'אין הרשאה' };
  try {
    const id = await createTopic(db, seasonId, input, admin.email);
    revalidatePath(PLAN_PATH);
    return { ok: true, value: id };
  } catch (error) {
    return { ok: false, error: topicFailureMessage(error) };
  }
}

export async function updateTopicAction(id: string, input: TopicInput): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!admin.ok) return { ok: false, error: 'אין הרשאה' };
  try {
    await updateTopic(db, id, input, admin.email);
    revalidatePath(PLAN_PATH);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: topicFailureMessage(error) };
  }
}

export async function setTopicArchivedAction(id: string, archived: boolean): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!admin.ok) return { ok: false, error: 'אין הרשאה' };
  try {
    await setTopicArchived(db, id, archived, admin.email);
    revalidatePath(PLAN_PATH);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: topicFailureMessage(error) };
  }
}

export async function createItemAction(seasonId: string, input: ItemInput): Promise<ActionResult<string>> {
  const admin = await requireAdmin();
  if (!admin.ok) return { ok: false, error: 'אין הרשאה' };
  try {
    const id = await createItem(db, seasonId, input, admin.email);
    revalidatePath(PLAN_PATH);
    return { ok: true, value: id };
  } catch (error) {
    return { ok: false, error: itemFailureMessage(error) };
  }
}

export async function updateItemAction(id: string, input: ItemInput): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!admin.ok) return { ok: false, error: 'אין הרשאה' };
  try {
    await updateItem(db, id, input, admin.email);
    revalidatePath(PLAN_PATH);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: itemFailureMessage(error) };
  }
}

/** Only the days. The undo is this action with the days that were there. */
export async function scheduleItemAction(id: string, schedule: Schedule): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!admin.ok) return { ok: false, error: 'אין הרשאה' };
  try {
    await scheduleItem(db, id, schedule, admin.email);
    revalidatePath(PLAN_PATH);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: itemFailureMessage(error) };
  }
}

/** The undo is this action with the previous status (E2). */
export async function setItemStatusAction(id: string, status: WorkItemStatus): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!admin.ok) return { ok: false, error: 'אין הרשאה' };
  try {
    await setItemStatus(db, id, status, admin.email);
    revalidatePath(PLAN_PATH);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: itemFailureMessage(error) };
  }
}

export async function addDependencyAction(beforeId: string, afterId: string): Promise<ActionResult<string>> {
  const admin = await requireAdmin();
  if (!admin.ok) return { ok: false, error: 'אין הרשאה' };
  try {
    const id = await addDependency(db, beforeId, afterId);
    revalidatePath(PLAN_PATH);
    return { ok: true, value: id };
  } catch (error) {
    return { ok: false, error: dependencyFailureMessage(error) };
  }
}

export async function removeDependencyAction(id: string): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!admin.ok) return { ok: false, error: 'אין הרשאה' };
  try {
    await removeDependency(db, id);
    revalidatePath(PLAN_PATH);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: dependencyFailureMessage(error) };
  }
}

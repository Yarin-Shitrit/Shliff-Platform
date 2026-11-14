'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/db';
import { requireAdmin } from '@/lib/auth/guard';
import type { ActionResult } from '@/lib/action-result';
import type { AcquisitionStatus, WorkItemStatus } from '@/db/schema/logistics';
import {
  createTopic, updateTopic, setTopicArchived,
  createItem, updateItem, scheduleItem, setItemStatus,
  addDependency, removeDependency,
  type TopicInput, type ItemInput, type Schedule,
} from '@/lib/logistics/plan';
import { adoptPurchaseItems, setAcquisitionStatus } from '@/lib/logistics/acquisitions';
import { PLAN_PATH } from '@/lib/logistics/plan-views';
import { ACQUISITIONS_PATH } from '@/lib/logistics/acquisitions-views';
import {
  adoptFailureMessage, dependencyFailureMessage, itemFailureMessage, topicFailureMessage,
} from './failure-messages';
import { acquisitionFailureMessage } from '../acquisitions/failure-messages';

/**
 * This file exports only async functions (see `use-server-exports.test.ts`).
 * A write to the plan alone revalidates the plan alone; the two verbs that
 * touch a purchase revalidate רכש as well, because that screen shows the
 * same row.
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

/**
 * The undo is this action with the previous status (E2). The value is the
 * status that was written: a purchase's line reopened after its purchase
 * arrived lands on done, and the toast names where it landed.
 */
export async function setItemStatusAction(
  id: string, status: WorkItemStatus,
): Promise<ActionResult<WorkItemStatus>> {
  const admin = await requireAdmin();
  if (!admin.ok) return { ok: false, error: 'אין הרשאה' };
  try {
    const landed = await setItemStatus(db, id, status, admin.email);
    revalidatePath(PLAN_PATH);
    return { ok: true, value: landed };
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

/**
 * The board's buying items become rows in the acquisitions list, linked.
 * Both screens change: the list gains rows, the board's items gain their
 * link and their rebuilt titles.
 */
export async function adoptPurchaseItemsAction(
  seasonId: string, itemIds: string[],
): Promise<ActionResult<number>> {
  const admin = await requireAdmin();
  if (!admin.ok) return { ok: false, error: 'אין הרשאה' };
  try {
    const moved = await adoptPurchaseItems(db, seasonId, itemIds, admin.email);
    revalidatePath(PLAN_PATH);
    revalidatePath(ACQUISITIONS_PATH);
    return { ok: true, value: moved };
  } catch (error) {
    return { ok: false, error: adoptFailureMessage(error) };
  }
}

/**
 * A purchase's status, written from its line on the board. The same write
 * as רכש's status menu: the library moves the line to done or open with it.
 * The undo is this action with the status that was (E2).
 */
export async function setPurchaseStatusAction(
  acquisitionId: string, status: AcquisitionStatus,
): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!admin.ok) return { ok: false, error: 'אין הרשאה' };
  try {
    await setAcquisitionStatus(db, acquisitionId, status, admin.email);
    revalidatePath(PLAN_PATH);
    revalidatePath(ACQUISITIONS_PATH);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: acquisitionFailureMessage(error) };
  }
}

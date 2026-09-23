'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/db';
import { requireAdmin } from '@/lib/auth/guard';
import type { ActionResult } from '@/lib/action-result';
import type { SiteItemKind } from '@/db/schema/site';
import {
  addItem, copyPlan, createPlan, removeItem, setPlot, updateItem,
  type ItemPatch, type PlotInput,
} from '@/lib/site/plan';
import { SITE_PATH } from '@/lib/site/views';
import { siteFailureMessage } from './failure-messages';

/**
 * This file exports only async functions. A `'use server'` module that
 * exports anything else — a string constant beside its actions — makes Next
 * reject the whole module and return 500 on every route including
 * `/signin`, while tsc, eslint, next build and the unit tests all pass.
 */

const NO_ACCESS = 'אין הרשאה';

export async function createPlanAction(
  seasonId: string, input: PlotInput,
): Promise<ActionResult<string>> {
  const admin = await requireAdmin();
  if (!admin.ok) return { ok: false, error: NO_ACCESS };
  try {
    const id = await createPlan(db, seasonId, input, admin.email);
    revalidatePath(SITE_PATH);
    return { ok: true, value: id };
  } catch (error) {
    return { ok: false, error: siteFailureMessage(error) };
  }
}

export async function setPlotAction(planId: string, input: PlotInput): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!admin.ok) return { ok: false, error: NO_ACCESS };
  try {
    await setPlot(db, planId, input, admin.email);
    revalidatePath(SITE_PATH);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: siteFailureMessage(error) };
  }
}

export async function copyPlanAction(
  fromSeasonId: string, toSeasonId: string,
): Promise<ActionResult<string>> {
  const admin = await requireAdmin();
  if (!admin.ok) return { ok: false, error: NO_ACCESS };
  try {
    const id = await copyPlan(db, fromSeasonId, toSeasonId, admin.email);
    revalidatePath(SITE_PATH);
    return { ok: true, value: id };
  } catch (error) {
    return { ok: false, error: siteFailureMessage(error) };
  }
}

/** Returns the new item's id so the board can select what it just dropped. */
export async function addItemAction(
  planId: string, kind: SiteItemKind,
): Promise<ActionResult<string>> {
  const admin = await requireAdmin();
  if (!admin.ok) return { ok: false, error: NO_ACCESS };
  try {
    const id = await addItem(db, planId, kind, admin.email);
    revalidatePath(SITE_PATH);
    return { ok: true, value: id };
  } catch (error) {
    return { ok: false, error: siteFailureMessage(error) };
  }
}

/**
 * One write for a drag, a handle, a turn, an arrow key and the drawer. The
 * patch is partial — a drag sends two numbers, a handle four — and the
 * library holds the one set of refusals.
 */
export async function updateItemAction(id: string, patch: ItemPatch): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!admin.ok) return { ok: false, error: NO_ACCESS };
  try {
    await updateItem(db, id, patch, admin.email);
    revalidatePath(SITE_PATH);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: siteFailureMessage(error) };
  }
}

export async function removeItemAction(id: string): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!admin.ok) return { ok: false, error: NO_ACCESS };
  try {
    await removeItem(db, id);
    revalidatePath(SITE_PATH);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: siteFailureMessage(error) };
  }
}

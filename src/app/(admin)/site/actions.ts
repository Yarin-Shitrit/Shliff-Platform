'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/db';
import { requireAdmin } from '@/lib/auth/guard';
import type { ActionResult } from '@/lib/action-result';
import {
  applySiteOps, copyPlan, createPlan, loadDoc, setPlot, type PlotInput,
} from '@/lib/site/plan';
import type { EditorDoc } from '@/lib/site/editor/model';
import type { SaveResult, SiteOp } from '@/lib/site/editor/ops';
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

/** Answers the plan's new version (#25 fix round, Minor 10): the drawer notes it, so the editor knows its own plot save. */
export async function setPlotAction(planId: string, input: PlotInput): Promise<ActionResult<number>> {
  const admin = await requireAdmin();
  if (!admin.ok) return { ok: false, error: NO_ACCESS };
  try {
    const version = await setPlot(db, planId, input, admin.email);
    revalidatePath(SITE_PATH);
    return { ok: true, value: version };
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

/**
 * One batch of the editor's edits against the version it last saw (spec
 * §6.4). A conflict is an answer, not an error: the editor shows it as a
 * choice. No `router.refresh()` follows on the client — the editor's store is
 * the truth once the page has loaded, which is what stops items jumping.
 */
export async function saveSiteChangesAction(
  planId: string, baseVersion: number, ops: SiteOp[],
): Promise<SaveResult> {
  const admin = await requireAdmin();
  if (!admin.ok) return { ok: false, reason: 'refused', error: NO_ACCESS };
  try {
    const result = await applySiteOps(db, planId, baseVersion, ops, admin.email);
    if (result.status === 'conflict') return { ok: false, reason: 'conflict', version: result.version };
    return result.skipped.length === 0
      ? { ok: true, version: result.version }
      : { ok: true, version: result.version, skipped: result.skipped };
  } catch (error) {
    return { ok: false, reason: 'refused', error: siteFailureMessage(error) };
  }
}

/** The whole map again — after a conflict, when the lead chooses the other lead's version. */
export async function loadSiteDocAction(
  planId: string,
): Promise<ActionResult<{ doc: EditorDoc; version: number }>> {
  const admin = await requireAdmin();
  if (!admin.ok) return { ok: false, error: NO_ACCESS };
  try {
    const loaded = await loadDoc(db, planId);
    if (loaded === null) return { ok: false, error: siteFailureMessage(new Error(`unknown site plan ${planId}`)) };
    return { ok: true, value: loaded };
  } catch (error) {
    return { ok: false, error: siteFailureMessage(error) };
  }
}

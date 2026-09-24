'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/db';
import { requireAdmin } from '@/lib/auth/guard';
import type { ActionResult } from '@/lib/action-result';
import {
  createAcquisition, updateAcquisition, setAcquisitionStatus, recordArrival,
  type AcquisitionInput, type ArrivalInput,
} from '@/lib/logistics/acquisitions';
import type { AcquisitionStatus } from '@/db/schema/logistics';
import { ACQUISITIONS_PATH } from '@/lib/logistics/acquisitions-views';
import { WAREHOUSE_PATH } from '@/lib/logistics/warehouse-views';
import { acquisitionFailureMessage, arrivalFailureMessage } from './failure-messages';

/**
 * This file exports only async functions. A `'use server'` module that exports
 * anything else — a string constant beside its actions — makes Next reject the
 * whole module and return 500 on every route including `/signin`, while tsc,
 * eslint, next build and the unit tests all pass. It happened once in this
 * repo and took a browser to find, so every label and message here is
 * imported rather than declared.
 */

export async function createAcquisitionAction(
  input: AcquisitionInput,
): Promise<ActionResult<string>> {
  const admin = await requireAdmin();
  if (!admin.ok) return { ok: false, error: 'אין הרשאה' };

  try {
    const id = await createAcquisition(db, input, admin.email);
    revalidatePath(ACQUISITIONS_PATH);
    return { ok: true, value: id };
  } catch (error) {
    return { ok: false, error: acquisitionFailureMessage(error) };
  }
}

export async function updateAcquisitionAction(
  id: string, input: AcquisitionInput,
): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!admin.ok) return { ok: false, error: 'אין הרשאה' };

  try {
    await updateAcquisition(db, id, input, admin.email);
    revalidatePath(ACQUISITIONS_PATH);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: acquisitionFailureMessage(error) };
  }
}

/**
 * Moving a row along the four states, and nothing else.
 *
 * Setting `arrived` here deliberately does **not** write to the warehouse:
 * the system knows the thing came and knows nothing about where it was put.
 * The screen surfaces that gap as an open decision instead of inventing a
 * location, which is the arrival drawer's whole reason to exist.
 */
export async function setAcquisitionStatusAction(
  id: string, status: AcquisitionStatus,
): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!admin.ok) return { ok: false, error: 'אין הרשאה' };

  try {
    await setAcquisitionStatus(db, id, status, admin.email);
    revalidatePath(ACQUISITIONS_PATH);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: acquisitionFailureMessage(error) };
  }
}

/**
 * The decision itself: an order becomes stock.
 *
 * Both paths are revalidated because one write changes both screens — the
 * warehouse gains a row or a quantity, and the acquisition stops being an
 * open decision. Revalidating only this one would leave a lead who walks
 * straight to the warehouse looking at a list that does not hold what they
 * just registered.
 */
export async function recordArrivalAction(
  input: ArrivalInput,
): Promise<ActionResult<string>> {
  const admin = await requireAdmin();
  if (!admin.ok) return { ok: false, error: 'אין הרשאה' };

  try {
    const itemId = await recordArrival(db, input, admin.email);
    revalidatePath(ACQUISITIONS_PATH);
    revalidatePath(WAREHOUSE_PATH);
    return { ok: true, value: itemId };
  } catch (error) {
    return { ok: false, error: arrivalFailureMessage(error) };
  }
}

'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/db';
import { requireAdmin } from '@/lib/auth/guard';
import type { ActionResult } from '@/lib/action-result';
import { createPersonFromAlias, linkAlias, mergePersons } from '@/lib/members/link';
import { addMember } from '@/lib/members/roster';

export async function linkNameAction(
  aliasId: string, personId: string,
): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!admin.ok) return { ok: false, error: 'אין הרשאה' };

  await linkAlias(db, aliasId, personId, admin.email);
  revalidatePath('/members');
  return { ok: true };
}

export async function promoteNameAction(aliasId: string): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!admin.ok) return { ok: false, error: 'אין הרשאה' };

  try {
    await createPersonFromAlias(db, aliasId, admin.email);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'שגיאה' };
  }
  revalidatePath('/members');
  return { ok: true };
}

export async function mergePeopleAction(
  sourceId: string, targetId: string,
): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!admin.ok) return { ok: false, error: 'אין הרשאה' };

  const result = await mergePersons(db, sourceId, targetId, admin.email);
  if (!result.ok) {
    return { ok: false, error: `לא ניתן למזג — קיימים: ${result.conflicts.join(', ')}` };
  }
  revalidatePath('/members');
  return { ok: true };
}

export async function addMemberAction(
  personId: string, seasonId: string, role: string,
): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!admin.ok) return { ok: false, error: 'אין הרשאה' };

  await addMember(db, personId, seasonId, role);
  revalidatePath('/members');
  return { ok: true };
}

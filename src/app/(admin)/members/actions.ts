'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/db';
import { requireAdmin } from '@/lib/auth/guard';
import type { ActionResult } from '@/lib/action-result';
import { createPerson, createPersonFromAlias, linkAlias, mergePersons } from '@/lib/members/link';
import { resolveName } from '@/lib/members/identity';
import { addMember } from '@/lib/members/roster';
import { isBlank } from '@/lib/text/normalize';

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

/**
 * Creates a brand-new person, from nothing — the only path today besides
 * promoting a queued import name.
 *
 * A free-text "add member" box is the easiest place in the whole app to spawn
 * a duplicate identity, so this refuses whenever `resolveName` finds exactly
 * one exact match, and names who it matched rather than silently creating a
 * second record for the same human. A partial match is not refused: two
 * people can genuinely share a Hebrew first name (`דניאל פינטו` and
 * `דניאל ענבר` are both real members here), and the whole point of
 * `resolveName`'s exact-only rule is to never guess between them.
 */
export async function createPersonAction(
  displayName: string, seasonId?: string,
): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!admin.ok) return { ok: false, error: 'אין הרשאה' };

  if (isBlank(displayName)) return { ok: false, error: 'שם לא יכול להיות ריק' };

  const resolution = await resolveName(db, displayName);
  if (resolution.personId) {
    const match = resolution.candidates.find((c) => c.personId === resolution.personId);
    return {
      ok: false,
      error: `כבר קיים אדם בשם ${match?.displayName ?? ''} — לא ניתן ליצור כפילות.`,
    };
  }

  const personId = await createPerson(db, displayName, admin.email);
  if (seasonId) await addMember(db, personId, seasonId);
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

'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { db } from '@/db';
import { requireAdmin } from '@/lib/auth/guard';
import type { ActionResult } from '@/lib/action-result';
import {
  aliasUnlinkTarget, createPerson, createPersonFromAlias, linkAlias, mergePersons,
  unlinkAlias,
} from '@/lib/members/link';
import { resolveName } from '@/lib/members/identity';
import { addMember } from '@/lib/members/roster';
import { issueFlatDueFor } from '@/lib/fees/dues';
import { toHebrewError, type HebrewErrors } from '@/lib/errors/hebrew';
import { isBlank } from '@/lib/text/normalize';

export async function linkNameAction(
  aliasId: string, personId: string,
): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!admin.ok) return { ok: false, error: 'אין הרשאה' };

  await linkAlias(db, aliasId, personId, admin.email);
  revalidatePath('/members');
  // The register lists the same queue (W24: surfaced by a link, not by a
  // second implementation), so a name linked from either screen has to leave
  // both.
  revalidatePath('/inbox');
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
  revalidatePath('/inbox');
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

/**
 * C8's refusal, recorded here because the bar is where it will be questioned.
 *
 * Only two bulk actions write, and both are idempotent: `addMember` upserts on
 * `(personId, seasonId)`, and `issueFlatDueFor` returns false and changes
 * nothing when a due already exists. Running either twice is running it once.
 *
 * Bulk payment, bulk exception and bulk removal from a season were all refused:
 * a payment needs an amount, a channel, a date and a קופה, and a bulk form
 * would have to invent three of them; an exception needs a reason per person
 * and `עמירם דהן 0` is exactly the failure that column exists to prevent; and
 * removing someone from a season leaves their due and their payments pointing
 * at a season they are no longer on, with nothing on the list showing it.
 * So the bar's destructive slot is empty, and that is a finding rather than
 * an omission.
 */
const BULK_ERRORS: HebrewErrors = [
  ['that person is not on this season roster', 'אינו/ה ברשימת השנה.'],
  ['unknown season', 'השנה המבוקשת לא נמצאה.'],
];

const NOTHING_SELECTED = 'לא נבחרו אנשים.';

export async function addToSeasonBulkAction(
  personIds: string[], seasonId: string, role: string,
): Promise<ActionResult & { added?: number }> {
  const admin = await requireAdmin();
  if (!admin.ok) return { ok: false, error: 'אין הרשאה' };
  if (personIds.length === 0) return { ok: false, error: NOTHING_SELECTED };

  for (const personId of personIds) await addMember(db, personId, seasonId, role);

  revalidatePath('/members');
  return { ok: true, added: personIds.length };
}

/**
 * Issues the season's flat rate to a selection.
 *
 * Each person is attempted on their own. `issueFlatDueFor` throws for someone
 * who is not on the roster, and letting that abandon the other ten would make
 * the bulk bar's result depend on the order the rows happened to be in.
 * Everyone who could be billed is billed, and the ones who could not are named.
 *
 * Only that one refusal is survivable. Anything else — an unknown season, a
 * driver fault — means the batch as a whole cannot be trusted, so it stops and
 * reports in Hebrew rather than claiming a partial success it cannot describe.
 */
export async function issueDuesBulkAction(
  personIds: string[], seasonId: string, names: Record<string, string> = {},
): Promise<ActionResult & { issued?: number; already?: number; offRoster?: string[] }> {
  const admin = await requireAdmin();
  if (!admin.ok) return { ok: false, error: 'אין הרשאה' };
  if (personIds.length === 0) return { ok: false, error: NOTHING_SELECTED };

  let issued = 0;
  let already = 0;
  const offRoster: string[] = [];

  for (const personId of personIds) {
    try {
      if (await issueFlatDueFor(db, personId, seasonId)) issued += 1;
      else already += 1;
    } catch (error) {
      const hebrew = toHebrewError(error, BULK_ERRORS);
      if (hebrew !== BULK_ERRORS[0][1]) return { ok: false, error: hebrew };
      offRoster.push(names[personId] ?? personId);
    }
  }

  revalidatePath('/members');
  return { ok: true, issued, already, offRoster };
}


/**
 * Detaches one spelling, putting it back in the queue of names waiting to be
 * attributed.
 *
 * Refuses a person's last alias. `createPerson` writes the display name as the
 * first alias and `resolveName` matches against aliases and nothing else, so a
 * person with none is invisible to every future import — and would turn up in
 * the unlinked queue as a name looking for a person, sitting next to their own
 * record. The check is here and not only in the dialog, because a refusal that
 * lives in a component is a refusal a second caller will not have.
 *
 * Unlinking does not clear `merged_from_person_id`, so a spelling that arrived
 * in a merge keeps saying so after it is detached. The merge happened; undoing
 * one of its consequences does not unmake the record of it.
 */
export async function unlinkAliasAction(aliasId: string): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!admin.ok) return { ok: false, error: 'אין הרשאה' };

  const target = await aliasUnlinkTarget(db, aliasId);
  if (target === null) return { ok: false, error: 'הכינוי לא נמצא.' };
  if (target.personId !== null && target.remaining === 0) {
    return {
      ok: false,
      error: 'לא ניתן לבטל את הכינוי האחרון של אדם — בלעדיו אי אפשר יהיה לזהות אותו בקבצים.',
    };
  }

  await unlinkAlias(db, aliasId);
  if (target.personId !== null) revalidatePath(`/members/${target.personId}`);
  revalidatePath('/members');
  return { ok: true };
}

/** The param a refused unlink comes back in, so the page and the action agree. */
export const UNLINK_ERROR_PARAM = 'unlinkError';

/**
 * A38 (BINDING): **a server-rendered dialog may not swallow a refusal.**
 *
 * `ConfirmDialog` submits through a plain `<form action>`, which has nowhere
 * to put an `ActionResult` — so `unlinkAliasAction` bound straight onto it
 * returns its refusal into the void and the lead sees *nothing at all*. Not an
 * English message on a Hebrew screen: no message. That is the platform's first
 * rule broken in the quietest possible way, and nothing goes red.
 *
 * A38 allows two answers and prefers this one: redirect back with the refusal
 * in the URL, the mechanism `/signin` already uses. The alternative — proving
 * every reachable path returns `ok` and naming the guard in a comment — is a
 * claim about the screen's guards that expires the moment a new entry point is
 * added, and `?unlink=` is a URL anyone can type.
 *
 * It redirects on success too, which drops the now-stale `?unlink=` from the
 * address bar rather than leaving a dialog request pointing at an alias that
 * no longer exists.
 *
 * Returns `void`, so `.bind(null, aliasId, backHref)` satisfies
 * `ConfirmDialog.action`'s `(formData: FormData) => void | Promise<void>` —
 * the type A38 records as unwidenable while a lane was building against it.
 */
export async function unlinkAliasAndReturn(
  aliasId: string, backHref: string,
): Promise<void> {
  const result = await unlinkAliasAction(aliasId);
  if (result.ok) redirect(backHref);
  const separator = backHref.includes('?') ? '&' : '?';
  redirect(`${backHref}${separator}${UNLINK_ERROR_PARAM}=${encodeURIComponent(result.error)}`);
}

'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/db';
import { requireAdmin } from '@/lib/auth/guard';
import type { ActionResult } from '@/lib/action-result';
import { toHebrewError } from '@/lib/errors/hebrew';
import {
  createParty, updateParty, recordPartyMovement, deletePartyMovement,
} from '@/lib/money/parties';
import type { PartyPart } from '@/db/schema/money';
import { MONEY_ERRORS } from '../error-messages';

/** R9: the boundary where an English message stops. */
function failed(error: unknown): ActionResult<never> {
  return { ok: false, error: toHebrewError(error, MONEY_ERRORS) };
}

/** A party's money is on its own page, in the party list, in the ledger and
 *  in every balance on `/money` — all four read the same rows. */
function refresh(eventId: string): void {
  revalidatePath('/money/events');
  revalidatePath(`/money/events/${eventId}`);
  revalidatePath('/money/ledger');
  revalidatePath('/money');
}

export interface PartyInput {
  seasonId: string;
  name: string;
  /** `YYYY-MM-DD`, from a date input. */
  heldOn: string;
  partnerName?: string;
}

/** Returns the new party's id, so the form can open its page. */
export async function createPartyAction(input: PartyInput): Promise<ActionResult<string>> {
  const admin = await requireAdmin();
  if (!admin.ok) return { ok: false, error: 'אין הרשאה' };
  let id: string;
  try {
    id = await createParty(db, {
      seasonId: input.seasonId,
      name: input.name,
      heldOn: new Date(input.heldOn),
      partnerName: input.partnerName,
    });
  } catch (error) {
    return failed(error);
  }
  refresh(id);
  return { ok: true, value: id };
}

export async function updatePartyAction(
  eventId: string, input: Omit<PartyInput, 'seasonId'>,
): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!admin.ok) return { ok: false, error: 'אין הרשאה' };
  try {
    await updateParty(db, eventId, {
      name: input.name,
      heldOn: new Date(input.heldOn),
      partnerName: input.partnerName,
    });
  } catch (error) {
    return failed(error);
  }
  refresh(eventId);
  return { ok: true };
}

export interface PartyMovementInput {
  eventId: string;
  part: PartyPart;
  direction?: 'in' | 'out';
  /** In shekels. */
  amount: number;
  occurredOn: string;
  description?: string;
  accountId?: string;
}

/**
 * Every refusal is `recordPartyMovement`'s: the direction a part allows, a
 * cost's description, a partner the party has. Nothing is re-checked here.
 */
export async function recordPartyMovementAction(
  input: PartyMovementInput,
): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!admin.ok) return { ok: false, error: 'אין הרשאה' };
  try {
    await recordPartyMovement(db, {
      eventId: input.eventId,
      part: input.part,
      direction: input.direction,
      amount: input.amount,
      occurredOn: new Date(input.occurredOn),
      description: input.description,
      // Passed through, never defaulted — see `recordMovementAction`.
      accountId: input.accountId,
      // From the session, never from the client.
      recordedBy: admin.email,
    });
  } catch (error) {
    return failed(error);
  }
  refresh(input.eventId);
  return { ok: true };
}

export async function deletePartyMovementAction(
  eventId: string, entryId: string,
): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!admin.ok) return { ok: false, error: 'אין הרשאה' };
  try {
    await deletePartyMovement(db, eventId, entryId);
  } catch (error) {
    return failed(error);
  }
  refresh(eventId);
  return { ok: true };
}

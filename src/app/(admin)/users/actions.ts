'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/db';
import { requireAdmin } from '@/lib/auth/guard';
import type { ActionResult } from '@/lib/action-result';
import { toHebrewError } from '@/lib/errors/hebrew';
import type { AccessMap } from '@/lib/auth/pages';
import {
  USER_CONSTRAINTS, createUser, deleteUser, setUserAccess, setUserPassword,
} from '@/lib/auth/users';

const PATH = '/users';

/** R9: the boundary where an English message stops. */
function failed(error: unknown): ActionResult<never> {
  return { ok: false, error: toHebrewError(error, [], USER_CONSTRAINTS) };
}

/**
 * A grant changes what the rail shows on every screen, not only this list,
 * so the whole layout is revalidated — the same reason a new season does.
 */
function refresh(): void {
  revalidatePath('/', 'layout');
  revalidatePath(PATH);
}

export interface NewUserInput {
  email: string;
  password: string;
  admin: boolean;
  pages: AccessMap;
}

/** Returns the new account's id, so the list can open its row. */
export async function createUserAction(input: NewUserInput): Promise<ActionResult<string>> {
  const admin = await requireAdmin();
  if (!admin.ok) return { ok: false, error: 'אין הרשאה' };
  let id: string;
  try {
    id = await createUser(db, input);
  } catch (error) {
    return failed(error);
  }
  refresh();
  return { ok: true, value: id };
}

export interface AccessInput {
  admin: boolean;
  pages: AccessMap;
}

export async function setUserAccessAction(
  userId: string, input: AccessInput,
): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!admin.ok) return { ok: false, error: 'אין הרשאה' };
  try {
    await setUserAccess(db, {
      actorEmail: admin.email, userId, admin: input.admin, pages: input.pages,
    });
  } catch (error) {
    return failed(error);
  }
  refresh();
  return { ok: true };
}

export async function setUserPasswordAction(
  userId: string, password: string,
): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!admin.ok) return { ok: false, error: 'אין הרשאה' };
  try {
    await setUserPassword(db, userId, password);
  } catch (error) {
    return failed(error);
  }
  return { ok: true };
}

export async function deleteUserAction(userId: string): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!admin.ok) return { ok: false, error: 'אין הרשאה' };
  try {
    await deleteUser(db, { actorEmail: admin.email, userId });
  } catch (error) {
    return failed(error);
  }
  refresh();
  return { ok: true };
}

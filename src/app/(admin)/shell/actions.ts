'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/db';
import { requireAdmin } from '@/lib/auth/guard';
import { signOut } from '@/lib/auth/config';
import { resolveSeason } from '@/lib/seasons/current';
import { shellCounts, type ShellCounts } from '@/lib/shell/counts';
import { searchPalette, type PaletteHit } from '@/lib/search/palette';
import { createSeason } from '@/lib/members/roster';
import { isBlank } from '@/lib/text/normalize';
import { toHebrewError, type HebrewErrors } from '@/lib/errors/hebrew';
import type { ActionResult } from '@/lib/action-result';

/**
 * The two season-scoped counts depend on `?season=`, which a layout cannot
 * read, so the rail asks for them once per season (Ruling S2).
 *
 * `requested` is the raw param, so the fallback to the newest season happens
 * here through the same `resolveSeason` every page uses — otherwise the rail
 * would read 0 members on `/members` with no query string.
 *
 * Returns null rather than throwing when the caller is not an admin. The
 * guard is still the enforcement; this is a badge.
 */
export async function loadShellCounts(
  requested: string | null,
): Promise<ShellCounts | null> {
  const admin = await requireAdmin();
  if (!admin.ok) return null;

  const { current } = await resolveSeason(db, requested ?? undefined);
  return shellCounts(db, current?.id ?? null);
}

/**
 * The palette asks per keystroke, so this stays a read with no side effects.
 * A non-admin gets an empty list, never an error: the guard on every page is
 * the enforcement, and this is a search box.
 */
export async function searchCommandPalette(
  query: string, requested: string | null,
): Promise<PaletteHit[]> {
  const admin = await requireAdmin();
  if (!admin.ok) return [];

  const { current } = await resolveSeason(db, requested ?? undefined);
  return searchPalette(db, query, current?.id ?? null);
}

/**
 * Deliberately not behind `requireAdmin`: leaving the account is the one
 * action a person who may see nothing must still be able to take. The file
 * satisfies the guard net through the two reads above.
 */
export async function signOutAction(): Promise<void> {
  await signOut({ redirectTo: '/signin' });
}

/**
 * The season switcher's `שנה חדשה` (B4), deferred by Ruling S4 until this
 * screen existed. Every field arrives as the raw string a form control holds
 * — including the two optional ones, which are `undefined` or blank when a
 * lead leaves them empty — so this one function is the only place that
 * decides what "blank" means and turns text into the numbers `createSeason`
 * needs. Nothing here invents a number: a blank required field refuses
 * rather than falling back to a default (see the module doc in
 * `src/lib/members/roster.ts` on why `flatRate` in particular must never be
 * guessed).
 */
export interface NewSeasonInput {
  name: string;
  year: string;
  flatRate: string;
  plannedSize?: string;
  startsOn?: string;
}

/**
 * `createSeason`'s insert throws Drizzle's `DrizzleQueryError`; its own
 * `.message` is the fixed, parameterised SQL text —
 * `Failed query: insert into "seasons" (...) ... returning ...` — not the
 * driver's message, which sits on `.cause` and `toHebrewError` never reads.
 * Confirmed empirically (a duplicate `name` throws with
 * `.cause.constraint === 'seasons_name_unique'` and `.cause.message ===
 * 'duplicate key value violates unique constraint "seasons_name_unique"'`):
 * the wrapper's message is the same fixed prefix regardless of which value
 * violated a constraint. `name` is the only constraint that insert can still
 * violate once the checks below have run (year/flatRate/plannedSize are
 * already known to be well-formed numbers, and none of the NOT NULL columns
 * can still be empty), so one prefix is enough — and it can finally name the
 * season that clashed, which a raw Postgres message never could.
 */
function seasonErrors(name: string): HebrewErrors {
  return [
    ['Failed query: insert into "seasons"', `כבר קיימת שנה בשם "${name}".`],
  ];
}

export async function createSeasonAction(input: NewSeasonInput): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!admin.ok) return { ok: false, error: 'אין הרשאה' };

  if (isBlank(input.name)) return { ok: false, error: 'יש להזין שם לשנה.' };
  if (isBlank(input.year)) return { ok: false, error: 'יש להזין שנה קלנדרית.' };
  if (isBlank(input.flatRate)) return { ok: false, error: 'יש להזין דמי קאמפ.' };

  const year = Number(input.year);
  if (!Number.isInteger(year)) return { ok: false, error: 'השנה הקלנדרית חייבת להיות מספר שלם.' };

  const flatRate = Number(input.flatRate);
  if (!Number.isFinite(flatRate)) return { ok: false, error: 'דמי הקאמפ חייבים להיות מספר.' };

  let plannedSize: number | undefined;
  if (!isBlank(input.plannedSize)) {
    plannedSize = Number(input.plannedSize);
    if (!Number.isInteger(plannedSize)) {
      return { ok: false, error: 'גודל המחנה המתוכנן חייב להיות מספר שלם.' };
    }
  }

  let startsOn: Date | undefined;
  if (!isBlank(input.startsOn)) {
    startsOn = new Date(input.startsOn!);
    if (Number.isNaN(startsOn.getTime())) {
      return { ok: false, error: 'תאריך פתיחת השער אינו תקין.' };
    }
  }

  try {
    await createSeason(db, { name: input.name, year, flatRate, plannedSize, startsOn });
  } catch (error) {
    return { ok: false, error: toHebrewError(error, seasonErrors(input.name)) };
  }

  // The switcher renders on every admin page, and a lead who just created a
  // season expects to be able to pick it immediately — not only on the page
  // they happened to be standing on.
  revalidatePath('/', 'layout');
  return { ok: true };
}

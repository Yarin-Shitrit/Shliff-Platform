'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/db';
import { requireAdmin } from '@/lib/auth/guard';
import { signOut } from '@/lib/auth/config';
import { resolveSeason } from '@/lib/seasons/current';
import { shellCounts, type ShellCounts } from '@/lib/shell/counts';
import { searchPalette, type PaletteHit } from '@/lib/search/palette';
import { createSeason, setSeasonStartsOn } from '@/lib/members/roster';
import { isBlank } from '@/lib/text/normalize';
import { parseDateInput } from '@/lib/dates';
import { toHebrewError, type HebrewConstraints } from '@/lib/errors/hebrew';
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
 * `createSeason`'s insert throws Drizzle's `DrizzleQueryError`, whose own
 * `.message` is the fixed, parameterised SQL text — `Failed query: insert
 * into "seasons" (...) ... returning ...`. The driver's message, and
 * `constraint`, sit on `.cause`.
 *
 * This used to match that SQL prefix, on the argument that `name` was the
 * only constraint the insert could still violate once the checks below had
 * run. That was true when it was written, and it was an invariant held by a
 * comment: the prefix is identical for *every* failed insert into the table,
 * so it reported a duplicate name for any of them. A year that passes
 * `Number.isInteger` and then overflows int4 is the case that shows it —
 * `כבר קיימת שנה בשם "X".` for a failure with nothing to do with the name,
 * confident, specific and wrong (integration §5 A27).
 *
 * Keying on `constraint` asks the driver which refusal this was instead of
 * inferring it. It still names the season that clashed, which a raw Postgres
 * message never could; anything else falls back, because a specific cause
 * claimed from a generic symptom is a guess.
 */
function seasonConstraints(name: string): HebrewConstraints {
  return [
    ['seasons_name_unique', `כבר קיימת שנה בשם "${name}".`],
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

  // Through the same strict reader as `setSeasonStartsOnAction`: `new Date`
  // alone turned `2026-02-30` into 2 March and read `4/6/2026` month-first.
  let startsOn: Date | undefined;
  if (!isBlank(input.startsOn)) {
    const day = parseDateInput(input.startsOn!);
    if (day === null) return { ok: false, error: 'תאריך פתיחת השער אינו תקין.' };
    startsOn = day;
  }

  try {
    await createSeason(db, { name: input.name, year, flatRate, plannedSize, startsOn });
  } catch (error) {
    return { ok: false, error: toHebrewError(error, [], seasonConstraints(input.name)) };
  }

  // The switcher renders on every admin page, and a lead who just created a
  // season expects to be able to pick it immediately — not only on the page
  // they happened to be standing on.
  revalidatePath('/', 'layout');
  return { ok: true };
}

/**
 * `SeasonDateDrawer` (`?act=season-date`): sets, changes or clears an
 * existing season's gate date. `startsOn` is the raw string the date input
 * holds, and blank means "clear it" — the drawer sends blank only from its
 * own `הסרת התאריך` button, and refuses an empty `שמירה` before it gets here.
 *
 * A typed date goes through `parseDateInput`, the same reader
 * `createSeasonAction` uses, and is stored as UTC midnight — 02:00 or 03:00
 * the same day in Israel, so every screen reading it in the camp's timezone
 * shows the day that was typed. Anything that reader refuses (`2026-02-30`,
 * `2026-6-4`, `4/6/2026`) is refused here rather than stored as a day nobody
 * typed.
 */
export async function setSeasonStartsOnAction(
  seasonId: string, startsOn: string,
): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!admin.ok) return { ok: false, error: 'אין הרשאה' };

  if (typeof startsOn !== 'string') return { ok: false, error: 'תאריך פתיחת השער אינו תקין.' };

  let date: Date | null = null;
  if (!isBlank(startsOn)) {
    date = parseDateInput(startsOn);
    if (date === null) return { ok: false, error: 'תאריך פתיחת השער אינו תקין.' };
  }

  let updated: Awaited<ReturnType<typeof setSeasonStartsOn>>;
  try {
    updated = await setSeasonStartsOn(db, seasonId, date);
  } catch (error) {
    return { ok: false, error: toHebrewError(error, []) };
  }
  if (updated === undefined) return { ok: false, error: 'השנה לא נמצאה.' };

  // Same reason as create: the switcher on every admin page shows this date.
  revalidatePath('/', 'layout');
  return { ok: true };
}

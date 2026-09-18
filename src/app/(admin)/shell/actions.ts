'use server';

import { db } from '@/db';
import { requireAdmin } from '@/lib/auth/guard';
import { resolveSeason } from '@/lib/seasons/current';
import { shellCounts, type ShellCounts } from '@/lib/shell/counts';

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

import { cookies } from 'next/headers';

export const SNOOZE_COOKIE = 'inbox_snooze';
/** Cap, so the cookie cannot outgrow the 4KB a browser will carry. */
export const SNOOZE_LIMIT = 50;
export const SNOOZE_DAYS = 7;
const DAY_MS = 86_400_000;

/**
 * Deferrals live in a server-readable cookie rather than a table.
 *
 * This phase changes no schema, and a cookie is already how this codebase
 * carries per-viewer state the server must see on the first paint (the theme,
 * A13). The cost is real and is stated on screen: a snooze is this browser's,
 * not the camp's, so the item reads נדחה על ידך עד … rather than נדחה.
 *
 * Item id → the moment it comes back. Entries whose moment has passed are
 * already dropped, so a deferral cannot hide a decision forever even if the
 * cookie is never written again.
 */
export function parseSnoozes(raw: string | undefined, now: Date): Map<string, Date> {
  const out = new Map<string, Date>();
  if (!raw) return out;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return out;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return out;

  for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof value !== 'string') continue;
    const until = new Date(value);
    if (Number.isNaN(until.getTime())) continue;
    if (until.getTime() <= now.getTime()) continue;
    out.set(id, until);
  }
  return out;
}

/** The cookie value for a map, the furthest-out entries dropped past the cap. */
export function serializeSnoozes(snoozes: ReadonlyMap<string, Date>): string {
  const kept = [...snoozes.entries()]
    .sort((a, b) => a[1].getTime() - b[1].getTime())
    .slice(0, SNOOZE_LIMIT);
  return JSON.stringify(Object.fromEntries(
    kept.map(([id, until]) => [id, until.toISOString()]),
  ));
}

/** Server-only: reads the request's cookie. Safe in a Server Component. */
export async function readSnoozes(now: Date): Promise<Map<string, Date>> {
  const store = await cookies();
  return parseSnoozes(store.get(SNOOZE_COOKIE)?.value, now);
}

/**
 * `cookies().set` is only permitted in a Server Function or a Route Handler —
 * HTTP cannot set a cookie once streaming has started — so everything below
 * this line is reachable only from `actions.ts`, never from a render.
 * Confirmed against `next/dist/docs/.../functions/cookies.md`.
 */
async function write(snoozes: ReadonlyMap<string, Date>): Promise<void> {
  const store = await cookies();
  store.set(SNOOZE_COOKIE, serializeSnoozes(snoozes), {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 90,
  });
}

/** Server-only: adds one deferral and writes the cookie back. */
export async function snoozeItem(
  itemId: string, now: Date, days: number = SNOOZE_DAYS,
): Promise<Date> {
  const snoozes = await readSnoozes(now);
  const until = new Date(now.getTime() + days * DAY_MS);
  snoozes.set(itemId, until);
  await write(snoozes);
  return until;
}

/** Server-only: removes one deferral — the undo behind the toast. */
export async function unsnoozeItem(itemId: string): Promise<void> {
  // Read against the epoch so no other live deferral is pruned as expired on
  // the way through: this call is about one item, and dropping someone else's
  // pending deferral as a side effect would be a silent loss.
  const snoozes = await readSnoozes(new Date(0));
  snoozes.delete(itemId);
  await write(snoozes);
}

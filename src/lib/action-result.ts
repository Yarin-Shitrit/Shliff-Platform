/** What every server action in the admin sections returns. */
export type ActionResult = { ok: true } | { ok: false; error: string };

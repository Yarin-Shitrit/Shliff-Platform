import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { HebrewRefusal, HEBREW_FALLBACK } from '@/lib/errors/hebrew';

const {
  requireAdmin, splitAlias, ignoreName, unignoreName,
  setSheetSeason, setSheetAuthority, snoozeItem, unsnoozeItem, revalidatePath,
} = vi.hoisted(() => ({
  requireAdmin: vi.fn(), splitAlias: vi.fn(),
  ignoreName: vi.fn(), unignoreName: vi.fn(),
  setSheetSeason: vi.fn(), setSheetAuthority: vi.fn(),
  snoozeItem: vi.fn(), unsnoozeItem: vi.fn(), revalidatePath: vi.fn(),
}));

vi.mock('@/db', () => ({ db: {} }));
vi.mock('next/cache', () => ({ revalidatePath }));
vi.mock('@/lib/auth/guard', () => ({ requireAdmin }));
vi.mock('@/lib/members/link', () => ({ splitAlias }));
vi.mock('@/lib/members/identity', () => ({ ignoreName, unignoreName }));
vi.mock('@/lib/import/sheets', () => ({ setSheetSeason, setSheetAuthority }));
vi.mock('./snooze', () => ({ snoozeItem, unsnoozeItem }));

beforeEach(() => {
  // `resetAllMocks`, not `clearAllMocks`: clear wipes call history but leaves
  // implementations standing, so a `mockRejectedValue` set by one test is
  // still rejecting in the next one — which showed up here as two tests
  // failing on a refusal neither of them had asked for.
  vi.resetAllMocks();
  requireAdmin.mockResolvedValue({ ok: true, email: 'lead@shliff.test' });
});

describe('the guard', () => {
  it('never reaches the domain for a non-admin', async () => {
    requireAdmin.mockResolvedValue({ ok: false });
    const actions = await import('./actions');

    expect(await actions.ignoreNameAction('a1')).toEqual({ ok: false, error: 'אין הרשאה' });
    expect(await actions.unignoreNameAction('a1')).toEqual({ ok: false, error: 'אין הרשאה' });
    expect(await actions.splitNameAction('a1', ['א', 'ב'])).toEqual({ ok: false, error: 'אין הרשאה' });
    expect(await actions.snoozeItemAction('name:a1')).toEqual({ ok: false, error: 'אין הרשאה' });
    expect(await actions.unsnoozeItemAction('name:a1')).toEqual({ ok: false, error: 'אין הרשאה' });
    await expect(actions.setSeasonAction('s1', 'x')).rejects.toThrow('unauthorized');
    await expect(actions.setAuthorityAction('s1', true)).rejects.toThrow('unauthorized');

    expect(ignoreName).not.toHaveBeenCalled();
    expect(unignoreName).not.toHaveBeenCalled();
    expect(splitAlias).not.toHaveBeenCalled();
    expect(snoozeItem).not.toHaveBeenCalled();
    expect(unsnoozeItem).not.toHaveBeenCalled();
    expect(setSheetSeason).not.toHaveBeenCalled();
    expect(setSheetAuthority).not.toHaveBeenCalled();
  });
});

/**
 * `src/app/admin-guard.test.ts` asserts that each `actions.ts` file *contains*
 * the string `requireAdmin(` — once, anywhere. That is a per-file net, so it
 * passes just as happily when one exported action among seven has lost its
 * guard and the other six still carry one. Verified by mutation: removing the
 * short-circuit from `ignoreNameAction` leaves the shared net green.
 *
 * So the per-action net lives here, where the actions do, and it enumerates
 * the module's exports rather than naming them — an action added later is
 * covered without anyone remembering to add it.
 */
describe('every exported action refuses a non-admin, one by one', () => {
  /** Arguments that are plausible for each action, so a call that gets past
   *  the guard reaches a domain mock rather than dying on a type error. */
  const ARGS: Record<string, unknown[]> = {
    ignoreNameAction: ['a1'],
    unignoreNameAction: ['a1'],
    splitNameAction: ['a1', ['א', 'ב']],
    snoozeItemAction: ['name:a1'],
    unsnoozeItemAction: ['name:a1'],
    setSeasonAction: ['s1', 'season-1'],
    setAuthorityAction: ['s1', true],
  };

  it('covers every export, so the list cannot silently fall behind', async () => {
    const actions = await import('./actions');
    const exported = Object.keys(actions).filter(
      (name) => typeof (actions as Record<string, unknown>)[name] === 'function',
    );
    expect(exported.length).toBeGreaterThan(0);
    expect([...exported].sort()).toEqual([...Object.keys(ARGS)].sort());
  });

  it.each(Object.keys(ARGS))('%s does not touch the domain for a non-admin', async (name) => {
    requireAdmin.mockResolvedValue({ ok: false });
    const actions = await import('./actions');
    const action = (actions as Record<string, (...a: unknown[]) => Promise<unknown>>)[name];

    // Either shape is a refusal: the five new actions return an ActionResult,
    // the two moved ones throw, and both are correct — what must never happen
    // is the domain being reached.
    await action(...ARGS[name]).then(
      (result) => { expect(result).toEqual({ ok: false, error: 'אין הרשאה' }); },
      (error: unknown) => { expect((error as Error).message).toBe('unauthorized'); },
    );

    for (const domain of [
      ignoreName, unignoreName, splitAlias, snoozeItem, unsnoozeItem,
      setSheetSeason, setSheetAuthority,
    ]) {
      expect(domain).not.toHaveBeenCalled();
    }
  });
});

describe('ignoreNameAction', () => {
  it('stamps the admin and refreshes the screen', async () => {
    const { ignoreNameAction } = await import('./actions');
    expect(await ignoreNameAction('a1')).toEqual({ ok: true });
    expect(ignoreName).toHaveBeenCalledWith({}, 'a1', 'lead@shliff.test');
    expect(revalidatePath).toHaveBeenCalledWith('/inbox');
  });

  it('passes a marked Hebrew domain refusal through word for word', async () => {
    ignoreName.mockRejectedValue(new HebrewRefusal(
      'כינוי שמשויך לאדם — יש לנתק אותו לפני שמסמנים אותו כלא-אדם',
    ));
    const { ignoreNameAction } = await import('./actions');
    expect(await ignoreNameAction('a1')).toEqual({
      ok: false,
      error: 'כינוי שמשויך לאדם — יש לנתק אותו לפני שמסמנים אותו כלא-אדם',
    });
  });

  // A20's hazard, which the brief's own local alphabet sniff would have had:
  // the refusal names the thing it refuses, that name contains Latin letters
  // (a uuid is hex), and a predicate asking "is this Hebrew?" answers no.
  // Marking the refusal is what makes the reason survive.
  it('keeps a Hebrew refusal that also names something in Latin', async () => {
    ignoreName.mockRejectedValue(new HebrewRefusal(
      'כינוי שמשויך לאדם: 3f2a9c1e-0b44-4d7a-9e21-77c5a1b0e8d3',
    ));
    const { ignoreNameAction } = await import('./actions');
    expect(await ignoreNameAction('a1')).toEqual({
      ok: false,
      error: 'כינוי שמשויך לאדם: 3f2a9c1e-0b44-4d7a-9e21-77c5a1b0e8d3',
    });
  });

  it('replaces an English error with the shared Hebrew fallback', async () => {
    ignoreName.mockRejectedValue(new Error('unknown alias a1'));
    const { ignoreNameAction } = await import('./actions');
    expect(await ignoreNameAction('a1')).toEqual({ ok: false, error: HEBREW_FALLBACK });
  });

  // A27: Drizzle wraps the driver's error, and the wrapper's own message is
  // the parameterised SQL. A handler reading only `.message` loses the
  // refusal on the inner link.
  it('finds a refusal wrapped inside another error', async () => {
    ignoreName.mockRejectedValue(new Error('Failed query: update "person_aliases" ...', {
      cause: new HebrewRefusal('כינוי שמשויך לאדם'),
    }));
    const { ignoreNameAction } = await import('./actions');
    expect(await ignoreNameAction('a1')).toEqual({ ok: false, error: 'כינוי שמשויך לאדם' });
  });
});

describe('setAuthorityAction', () => {
  it('lets the season refusal reach the screen in its own words', async () => {
    setSheetAuthority.mockRejectedValue(new Error(
      'אי אפשר לסמן גיליון כסמכותי בלי עונה — בלי עונה אי אפשר להבחין בין גרסה כפולה של אותה שנה לגיליון של שנה אחרת',
    ));
    const { setAuthorityAction } = await import('./actions');
    await expect(setAuthorityAction('s1', true)).rejects.toThrow('אי אפשר לסמן גיליון כסמכותי בלי עונה');
  });

  it('refreshes the register rather than the page it came from', async () => {
    const { setAuthorityAction } = await import('./actions');
    await setAuthorityAction('s1', true);
    expect(setSheetAuthority).toHaveBeenCalledWith({}, 's1', true);
    expect(revalidatePath).toHaveBeenCalledWith('/inbox');
    expect(revalidatePath).not.toHaveBeenCalledWith('/data');
  });
});

describe('snoozeItemAction', () => {
  it('defers the item and refreshes', async () => {
    snoozeItem.mockResolvedValue(new Date('2026-09-24T09:00:00Z'));
    const { snoozeItemAction } = await import('./actions');
    expect(await snoozeItemAction('name:a1')).toEqual({ ok: true });
    expect(snoozeItem).toHaveBeenCalledWith('name:a1', expect.any(Date));
    expect(revalidatePath).toHaveBeenCalledWith('/inbox');
  });
});

describe('splitNameAction', () => {
  // The brief pre-checked the count here as well as in splitAlias. One rule,
  // one place: the domain already refuses, in these words, and a second copy
  // is what drifts. What matters is that the lead reads the same sentence.
  it('carries the domain refusal for fewer than two names', async () => {
    splitAlias.mockRejectedValue(new HebrewRefusal('פיצול דורש שני שמות לפחות'));
    const { splitNameAction } = await import('./actions');
    expect(await splitNameAction('a1', ['רוני'])).toEqual({
      ok: false, error: 'פיצול דורש שני שמות לפחות',
    });
  });

  it('splits and refreshes both screens the name appears on', async () => {
    const { splitNameAction } = await import('./actions');
    expect(await splitNameAction('a1', ['רוני', 'גיל'])).toEqual({ ok: true });
    expect(splitAlias).toHaveBeenCalledWith({}, 'a1', ['רוני', 'גיל'], 'lead@shliff.test');
    expect(revalidatePath).toHaveBeenCalledWith('/inbox');
    expect(revalidatePath).toHaveBeenCalledWith('/members');
  });
});

/**
 * A23, binding and confirmed by the camp lead: no page may offer bulk
 * promotion. The strongest available form of that is for the register's
 * action file not to export one — a control cannot call what is not there.
 *
 * This is a source scan rather than an import check because an export that
 * exists but is unused would still be one edit away from a button, and the
 * point of A23a is to make the violation unexpressible rather than merely
 * undone.
 */
describe('A23 — bulk promotion is not reachable from this screen', () => {
  const source = readFileSync(
    join(process.cwd(), 'src/app/(admin)/inbox/actions.ts'), 'utf8',
  );
  // Comments are stripped before the scan. The file explains at length why
  // there is no promote-everything action, and that explanation names the
  // function — a net that read the prose would force the reasoning to be
  // deleted in order to pass, which is the opposite of what it is for.
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  it('read the file it is asserting about, and stripped only comments', () => {
    expect(code).toContain('export async function ignoreNameAction');
    expect(source).toContain('A23');
    expect(code).not.toContain('A23');
  });

  it('exports no promote-everything action and names no bulk promoter', () => {
    expect(code).not.toMatch(/promoteAllAction/);
    expect(code).not.toMatch(/promoteAllGated/);
    expect(code).not.toMatch(/\bpromoteAll\b/);
  });

  // Matched on `promoteAll`, not on `promote`: promoting a queued NAME to a
  // person is an unrelated, safe action that this screen legitimately calls,
  // and a net that caught it would be turned off rather than obeyed.
  it('offers nothing the register could call to write rows in bulk', async () => {
    const actions = await import('./actions');
    expect(Object.keys(actions).filter((name) => /promoteall/i.test(name))).toEqual([]);
  });
});

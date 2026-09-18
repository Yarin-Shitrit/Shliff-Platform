import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * `vi.mock` factories are hoisted above every other statement, so a plain
 * top-level `const` referenced inside one throws "Cannot access before
 * initialization" — `vi.hoisted` is what this codebase already uses
 * (see `export/route.test.ts`).
 */
const {
  requireAdmin, addMember, issueFlatDueFor, revalidatePath,
  unlinkAlias, aliasUnlinkTarget, redirect,
} = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  addMember: vi.fn(),
  issueFlatDueFor: vi.fn(),
  revalidatePath: vi.fn(),
  unlinkAlias: vi.fn(),
  aliasUnlinkTarget: vi.fn(),
  redirect: vi.fn((to: string) => { throw new Error(`NEXT_REDIRECT:${to}`); }),
}));
vi.mock('@/db', () => ({ db: {} }));
vi.mock('@/lib/auth/guard', () => ({ requireAdmin }));
vi.mock('next/cache', () => ({ revalidatePath }));
/* `redirect` throws in Next, and the wrapper below relies on that to stop. The
   fake throws too, so a test that asserted only "redirect was called" could
   not pass against a wrapper that carried on afterwards. */
vi.mock('next/navigation', () => ({ redirect }));
vi.mock('@/lib/members/roster', () => ({ addMember }));
vi.mock('@/lib/fees/dues', () => ({ issueFlatDueFor }));
vi.mock('@/lib/members/link', () => ({
  unlinkAlias, aliasUnlinkTarget,
  createPerson: vi.fn(), createPersonFromAlias: vi.fn(),
  linkAlias: vi.fn(), mergePersons: vi.fn(),
}));

import {
  addToSeasonBulkAction, issueDuesBulkAction, unlinkAliasAction,
  unlinkAliasAndReturn, UNLINK_ERROR_PARAM,
} from './actions';

const LAST_ALIAS_REFUSAL =
  'לא ניתן לבטל את הכינוי האחרון של אדם — בלעדיו אי אפשר יהיה לזהות אותו בקבצים.';

beforeEach(() => {
  vi.clearAllMocks();
  requireAdmin.mockResolvedValue({ ok: true, email: 'lead@shliff.camp' });
});

describe('addToSeasonBulkAction', () => {
  it('refuses without admin and touches nothing', async () => {
    requireAdmin.mockResolvedValue({ ok: false });
    expect(await addToSeasonBulkAction(['a', 'b'], 's26', 'member'))
      .toEqual({ ok: false, error: 'אין הרשאה' });
    expect(addMember).not.toHaveBeenCalled();
  });

  it('adds every person named and reports how many', async () => {
    const result = await addToSeasonBulkAction(['a', 'b', 'c'], 's26', 'member');
    expect(result).toEqual({ ok: true, added: 3 });
    expect(addMember).toHaveBeenCalledTimes(3);
    expect(addMember).toHaveBeenCalledWith({}, 'a', 's26', 'member');
    expect(revalidatePath).toHaveBeenCalledWith('/members');
  });

  /* Before any query runs: an empty batch is a UI slip, not a database round
     trip, and the refusal should read the same either way. */
  it('refuses an empty selection before it reads anything', async () => {
    expect(await addToSeasonBulkAction([], 's26', 'member'))
      .toEqual({ ok: false, error: 'לא נבחרו אנשים.' });
    expect(addMember).not.toHaveBeenCalled();
  });
});

describe('issueDuesBulkAction', () => {
  it('refuses without admin and touches nothing', async () => {
    requireAdmin.mockResolvedValue({ ok: false });
    expect(await issueDuesBulkAction(['a'], 's26'))
      .toEqual({ ok: false, error: 'אין הרשאה' });
    expect(issueFlatDueFor).not.toHaveBeenCalled();
  });

  it('refuses an empty selection before it reads anything', async () => {
    expect(await issueDuesBulkAction([], 's26'))
      .toEqual({ ok: false, error: 'לא נבחרו אנשים.' });
    expect(issueFlatDueFor).not.toHaveBeenCalled();
  });

  it('splits its report into issued and already-had, because both are success', async () => {
    issueFlatDueFor.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const result = await issueDuesBulkAction(['a', 'b'], 's26');
    expect(result).toEqual({ ok: true, issued: 1, already: 1, offRoster: [] });
  });

  /*
   * The whole point of the per-person `try`. Without it the batch's outcome
   * would depend on which order the rows happened to be in — one off-roster
   * person early in the list would abandon everyone after them.
   */
  it('bills everyone it can and names the ones it could not, rather than abandoning the batch', async () => {
    issueFlatDueFor
      .mockRejectedValueOnce(new Error('that person is not on this season roster'))
      .mockResolvedValueOnce(true)
      .mockRejectedValueOnce(new Error('that person is not on this season roster'));
    const result = await issueDuesBulkAction(['a', 'b', 'c'], 's26', {
      a: 'רוני אדלר', b: 'נועה לוי', c: 'עמירם דהן',
    });
    expect(result).toEqual({
      ok: true, issued: 1, already: 0, offRoster: ['רוני אדלר', 'עמירם דהן'],
    });
    expect(issueFlatDueFor).toHaveBeenCalledTimes(3);
  });

  /* R9: a failure the map does not know must never reach a Hebrew screen as
     the English the library threw. */
  it('refuses the whole batch in Hebrew when something other than the roster is wrong', async () => {
    issueFlatDueFor.mockRejectedValue(new Error('unknown season s99'));
    const result = await issueDuesBulkAction(['a'], 's99');
    expect(result).toEqual({ ok: false, error: 'השנה המבוקשת לא נמצאה.' });
  });
});


describe('unlinkAliasAction', () => {
  it('refuses without admin and touches nothing', async () => {
    requireAdmin.mockResolvedValue({ ok: false });
    expect(await unlinkAliasAction('al1')).toEqual({ ok: false, error: 'אין הרשאה' });
    expect(unlinkAlias).not.toHaveBeenCalled();
  });

  /*
   * The one refusal, and it is enforced here rather than only in the dialog.
   * `createPerson` writes the display name as the first alias and
   * `resolveName` matches against aliases and nothing else, so a person with
   * none is invisible to every future import — and would turn up in the
   * unlinked queue as a name looking for a person, sitting next to their own
   * record.
   */
  it('refuses a person their last spelling, and unlinks nothing', async () => {
    aliasUnlinkTarget.mockResolvedValue({ personId: 'p1', remaining: 0 });
    expect(await unlinkAliasAction('al1'))
      .toEqual({ ok: false, error: LAST_ALIAS_REFUSAL });
    expect(unlinkAlias).not.toHaveBeenCalled();
  });

  it('unlinks when the person keeps at least one other spelling', async () => {
    aliasUnlinkTarget.mockResolvedValue({ personId: 'p1', remaining: 2 });
    expect(await unlinkAliasAction('al1')).toEqual({ ok: true });
    expect(unlinkAlias).toHaveBeenCalledWith({}, 'al1');
  });

  it('revalidates the record it changed as well as the list', async () => {
    aliasUnlinkTarget.mockResolvedValue({ personId: 'p1', remaining: 2 });
    await unlinkAliasAction('al1');
    expect(revalidatePath).toHaveBeenCalledWith('/members/p1');
    expect(revalidatePath).toHaveBeenCalledWith('/members');
  });

  it('refuses an alias that names nothing rather than throwing', async () => {
    aliasUnlinkTarget.mockResolvedValue(null);
    expect(await unlinkAliasAction('ghost'))
      .toEqual({ ok: false, error: 'הכינוי לא נמצא.' });
    expect(unlinkAlias).not.toHaveBeenCalled();
  });
});

/**
 * A38 (BINDING): a server-rendered dialog may not swallow a refusal.
 *
 * `ConfirmDialog` submits through a plain `<form action>`, which has nowhere
 * to put an `ActionResult`. Before this wrapper existed, a hand-typed
 * `?unlink=` naming somebody else's alias — or a person's last spelling —
 * failed with **no message at all**. Not English on a Hebrew screen: nothing.
 * Which is the platform's first rule broken in the quietest way there is,
 * because nothing goes red.
 */
describe('unlinkAliasAndReturn — A38', () => {
  const BACK = '/members/p1?season=s26&tab=aliases';

  function redirectedTo(): string {
    const call = redirect.mock.calls.at(-1);
    return (call?.[0] ?? '') as string;
  }

  it('hands a refusal back in the URL rather than dropping it', async () => {
    aliasUnlinkTarget.mockResolvedValue({ personId: 'p1', remaining: 0 });
    await expect(unlinkAliasAndReturn('al1', BACK)).rejects.toThrow(/NEXT_REDIRECT/);

    const target = redirectedTo();
    expect(target.startsWith(`${BACK}&${UNLINK_ERROR_PARAM}=`)).toBe(true);
    // The Hebrew the server actually wrote, not a second copy kept elsewhere.
    expect(decodeURIComponent(target.split(`${UNLINK_ERROR_PARAM}=`)[1]))
      .toBe(LAST_ALIAS_REFUSAL);
    expect(unlinkAlias).not.toHaveBeenCalled();
  });

  it('carries the refusal for an alias that names nothing — the hand-typed case', async () => {
    aliasUnlinkTarget.mockResolvedValue(null);
    await expect(unlinkAliasAndReturn('ghost', BACK)).rejects.toThrow(/NEXT_REDIRECT/);
    expect(decodeURIComponent(redirectedTo().split(`${UNLINK_ERROR_PARAM}=`)[1]))
      .toBe('הכינוי לא נמצא.');
  });

  it('opens the query string when the href has none', async () => {
    aliasUnlinkTarget.mockResolvedValue(null);
    await expect(unlinkAliasAndReturn('ghost', '/members/p1')).rejects.toThrow(/NEXT_REDIRECT/);
    expect(redirectedTo().startsWith(`/members/p1?${UNLINK_ERROR_PARAM}=`)).toBe(true);
  });

  /**
   * On success it goes back clean, so the address bar stops asking for a
   * dialog about an alias that no longer exists.
   */
  it('returns to a clean href when the unlink went through', async () => {
    aliasUnlinkTarget.mockResolvedValue({ personId: 'p1', remaining: 2 });
    await expect(unlinkAliasAndReturn('al1', BACK)).rejects.toThrow(/NEXT_REDIRECT/);
    expect(redirectedTo()).toBe(BACK);
    expect(unlinkAlias).toHaveBeenCalledWith({}, 'al1');
  });
});

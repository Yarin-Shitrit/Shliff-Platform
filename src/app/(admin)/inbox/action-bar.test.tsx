/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, within } from '@testing-library/react';
import { ToastProvider } from '@/components/ui/toaster';
import type { InboxAction } from '@/lib/inbox/items';

const {
  push, refresh, linkNameAction, ignoreNameAction, unignoreNameAction,
  snoozeItemAction, unsnoozeItemAction, promoteNameAction, splitNameAction,
  unlinkAliasAction, setSeasonAction, setAuthorityAction,
} = vi.hoisted(() => ({
  push: vi.fn(), refresh: vi.fn(),
  linkNameAction: vi.fn(), ignoreNameAction: vi.fn(), unignoreNameAction: vi.fn(),
  snoozeItemAction: vi.fn(), unsnoozeItemAction: vi.fn(),
  promoteNameAction: vi.fn(), splitNameAction: vi.fn(), unlinkAliasAction: vi.fn(),
  setSeasonAction: vi.fn(), setAuthorityAction: vi.fn(),
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh, replace: push }) }));
vi.mock('./actions', () => ({
  ignoreNameAction, unignoreNameAction, snoozeItemAction, unsnoozeItemAction,
  splitNameAction, setSeasonAction, setAuthorityAction,
}));
vi.mock('../members/actions', () => ({
  linkNameAction, promoteNameAction, unlinkAliasAction,
}));

import { ActionBar } from './action-bar';

function action(over: Partial<InboxAction> = {}): InboxAction {
  return {
    kind: 'link-name', label: 'קישור לנועה לוי', control: 'button',
    digit: 1, href: null, arg: 'p1', writes: true, undoable: true, ...over,
  };
}

function show(
  actions: InboxAction[], nextHref: string | null = '/inbox?item=b',
  seasons: Array<{ id: string; name: string }> = [],
) {
  return render(
    <ToastProvider>
      <ActionBar
        itemId="name:a1" itemKind="unlinked-name" actions={actions} nextHref={nextHref}
        seasons={seasons}
      />
    </ToastProvider>,
  );
}

/** The kit puts results in the polite region and failures in the assertive one. */
const results = () => screen.getByRole('status');
const failures = () => screen.getByRole('alert');

// Every mocked action, with no exceptions: `resetAllMocks` leaves a bare
// `vi.fn()` returning `undefined`, and an undo whose action resolves to
// `undefined` throws inside the kit's toaster *after* the test has finished.
// That surfaces as an unhandled rejection and exit code 1 while the run still
// reports 12 passed and 0 failed — the reading CLAUDE.md warns is the worst
// available, and it is why `--reporter=default` stays alongside the JSON one.
beforeEach(() => {
  vi.resetAllMocks();
  for (const fn of [
    linkNameAction, ignoreNameAction, unignoreNameAction, snoozeItemAction,
    unsnoozeItemAction, promoteNameAction, splitNameAction, unlinkAliasAction,
    setSeasonAction, setAuthorityAction,
  ]) {
    fn.mockResolvedValue({ ok: true });
  }
});

describe('ActionBar', () => {
  it('shows the digit beside the action it presses', () => {
    show([action()]);
    const button = screen.getByRole('button', { name: /קישור לנועה לוי/ });
    expect(button.getAttribute('id')).toBe('inbox-action-1');
    expect(button.textContent).toContain('1');
  });

  it('links the name, toasts what it did, and opens the next item', async () => {
    show([action()]);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /קישור לנועה לוי/ }));
    });

    expect(linkNameAction).toHaveBeenCalledWith('a1', 'p1');
    expect(results().textContent).toContain('קושר לנועה לוי');
    expect(push).toHaveBeenCalledWith('/inbox?item=b');
  });

  // The brief's undo for a link called unignoreNameAction, which un-ignores a
  // name nobody ignored — its own test asserted that function was NOT called,
  // so the toast offered ביטול and the domain did nothing. Unlinking is what
  // reverses a link, and it is a real action that already refuses a person's
  // last alias.
  it('offers undo on a reversible action and reverses it through the domain', async () => {
    show([action()], null);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /קישור לנועה לוי/ }));
    });
    await act(async () => {
      fireEvent.click(within(results()).getByRole('button', { name: 'ביטול' }));
    });
    expect(unlinkAliasAction).toHaveBeenCalledWith('a1');
    expect(unignoreNameAction).not.toHaveBeenCalled();
  });

  it('un-ignores a name the lead had set aside', async () => {
    show([action({ kind: 'ignore-name', label: 'לא אדם — התעלמות', arg: null })], null);
    fireEvent.click(screen.getByRole('button', { name: /לא אדם/ }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'סימון כלא-אדם' }));
    });
    await act(async () => {
      fireEvent.click(within(results()).getByRole('button', { name: 'ביטול' }));
    });
    expect(unignoreNameAction).toHaveBeenCalledWith('a1');
  });

  it('offers no undo on an action the domain cannot reverse', async () => {
    show([action({ kind: 'new-person', label: 'יצירת אדם חדש', arg: null, undoable: false })], null);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /יצירת אדם חדש/ }));
    });
    expect(within(results()).queryByRole('button', { name: 'ביטול' })).toBeNull();
  });

  // A25's twelfth unfailable test was exactly this query: the kit's
  // ConfirmDialog is an `alertdialog`, so `getByRole('dialog')` matches
  // something else entirely and every assertion passes against a build with no
  // confirmation at all.
  it('names the consequence before an irreversible action runs (R8)', async () => {
    show([action({ kind: 'ignore-name', label: 'לא אדם — התעלמות', arg: null })], null);
    fireEvent.click(screen.getByRole('button', { name: /לא אדם/ }));

    const dialog = screen.getByRole('alertdialog');
    expect(dialog.textContent).toContain(
      'השם יוסר מהרשימה ולא ייספר יותר. אפשר להחזיר אותו בכל רגע.',
    );
    expect(ignoreNameAction).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'סימון כלא-אדם' }));
    });
    expect(ignoreNameAction).toHaveBeenCalledWith('a1');
  });

  it('does nothing at all when the confirmation is declined', async () => {
    show([action({ kind: 'ignore-name', label: 'לא אדם — התעלמות', arg: null })], null);
    fireEvent.click(screen.getByRole('button', { name: /לא אדם/ }));
    const dialog = screen.getByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'ביטול' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(ignoreNameAction).not.toHaveBeenCalled();
  });

  it('shows the Hebrew refusal and does not advance when the action fails', async () => {
    linkNameAction.mockResolvedValue({ ok: false, error: 'אין הרשאה' });
    show([action()]);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /קישור לנועה לוי/ }));
    });
    expect(failures().textContent).toContain('אין הרשאה');
    expect(push).not.toHaveBeenCalled();
  });

  it('exposes its digit map for the keyboard, keyed by event.code', () => {
    show([action(), action({ digit: 2, label: 'קישור לנועה ליבוביץ', arg: 'p2' })], null);
    expect(document.getElementById('inbox-action-1')).toBeTruthy();
    expect(document.getElementById('inbox-action-2')).toBeTruthy();
  });

  // A split needs two names, and no button carries them. The brief called
  // splitNameAction with `(action.arg ?? '').split('|')` — on an item whose
  // arg is null, that is one empty name, which the domain refuses. The lead
  // types them.
  it('asks for the two names before splitting, and sends what was typed', async () => {
    show([action({ kind: 'split-name', label: 'פיצול לשני שמות', arg: null })], null);
    fireEvent.click(screen.getByRole('button', { name: /פיצול לשני שמות/ }));

    const dialog = screen.getByRole('alertdialog');
    fireEvent.change(within(dialog).getByLabelText('שם ראשון'), { target: { value: 'רוני' } });
    fireEvent.change(within(dialog).getByLabelText('שם שני'), { target: { value: 'גיל' } });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'פיצול' }));
    });
    expect(splitNameAction).toHaveBeenCalledWith('a1', ['רוני', 'גיל']);
  });

  it('snoozes the item by its id, not by the alias', async () => {
    show([action({ kind: 'snooze', label: 'דחייה לשבוע', arg: 'name:a1' })], null);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /דחייה לשבוע/ }));
    });
    expect(snoozeItemAction).toHaveBeenCalledWith('name:a1');
  });

  it('renders a link action as a link and never as a button', () => {
    show([action({
      kind: 'open-source', label: 'פתיחת השורה בקובץ', control: 'link',
      href: '/imports/u1#row-18', arg: null, writes: false, undoable: false, digit: null,
    })], null);
    const link = screen.getByRole('link', { name: /פתיחת השורה בקובץ/ });
    expect(link.getAttribute('href')).toBe('/imports/u1#row-18');
  });

  // On production the two colliding budget sheets were "decided" twice and
  // stayed undecided: the bar answered `set-authority` with a made-up
  // `{ ok: true }`, toasted נשמר and moved on. The press has to reach the
  // domain, and its undo has to clear the choice rather than pick the other copy.
  it('chooses the authoritative copy through the domain, and undo clears the choice', async () => {
    show([action({
      kind: 'set-authority', label: 'בחירת budget-v2.xlsx כמוסמך', arg: 'sheet-2',
    })], null);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /בחירת budget-v2.xlsx כמוסמך/ }));
    });
    expect(setAuthorityAction).toHaveBeenCalledWith('sheet-2', true);
    expect(results().textContent).toContain('נבחר budget-v2.xlsx כעותק הקובע');

    await act(async () => {
      fireEvent.click(within(results()).getByRole('button', { name: 'ביטול' }));
    });
    expect(setAuthorityAction).toHaveBeenLastCalledWith('sheet-2', null);
  });

  it('a season is chosen in a select and saved, never a bare button that saves nothing', async () => {
    const seasons = [{ id: 'season-25', name: 'ברן 25' }, { id: 'season-26', name: 'ברן 26' }];
    show([action({
      kind: 'set-season', label: 'בחירת עונה', control: 'select', arg: 'sheet-1', digit: null,
    })], null, seasons);

    // Saving with nothing chosen is refused on the spot, in Hebrew.
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'שמירה' }));
    });
    expect(setSeasonAction).not.toHaveBeenCalled();
    expect(failures().textContent).toContain('צריך לבחור שנה');

    fireEvent.change(screen.getByLabelText('בחירת עונה'), { target: { value: 'season-26' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'שמירה' }));
    });
    expect(setSeasonAction).toHaveBeenCalledWith('sheet-1', 'season-26');
    expect(results().textContent).toContain('השנה של הגיליון נשמרה');
  });

  it('refuses a writing control nothing is wired to, instead of saying נשמר', async () => {
    show([action({ kind: 'confirm-block', label: 'אישור', arg: 'b1', writes: true, undoable: false })]);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /אישור/ }));
    });
    expect(failures().textContent).toContain('שום דבר לא נשמר');
    expect(push).not.toHaveBeenCalled();
  });

  it('a skip moves on without claiming anything was saved', async () => {
    show([action({ kind: 'skip', label: 'דילוג', arg: null, writes: false, undoable: false })]);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /דילוג/ }));
    });
    expect(push).toHaveBeenCalledWith('/inbox?item=b');
    expect(screen.queryByRole('status')?.textContent ?? '').not.toContain('נשמר');
  });
});

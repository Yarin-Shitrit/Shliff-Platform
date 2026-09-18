/** @vitest-environment jsdom */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ConfirmDialog } from './confirm-dialog';

// Only the nested-over-a-Drawer test below needs a real Drawer, which calls
// `useRouter`; mocked at module scope since ConfirmDialog's own tests never
// touch navigation and are unaffected by it being mocked.
const { replace } = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push: vi.fn(), refresh: vi.fn() }),
}));
import { Drawer } from './drawer';

describe('ConfirmDialog', () => {
  it('is an alert dialog named by its title and described by its consequence', () => {
    render(
      <ConfirmDialog
        title="מחיקת תשלום"
        consequence="התשלום של איתי כהן על סך 1,200 ₪ יימחק, והיתרה שלו תחזור ל־1,200 ₪."
        confirmLabel="מחיקת התשלום"
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    const dialog = screen.getByRole('alertdialog', { name: 'מחיקת תשלום' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    const describedBy = dialog.getAttribute('aria-describedby') ?? '';
    expect(document.getElementById(describedBy)?.textContent)
      .toContain('היתרה שלו תחזור');
  });

  it('puts the verb on the confirm button and never the word אישור', () => {
    render(
      <ConfirmDialog title="ביטול משימה" consequence="המשימה תבוטל וכל השיבוצים יוסרו."
        confirmLabel="ביטול המשימה" cancelLabel="חזרה" onCancel={vi.fn()} onConfirm={vi.fn()} />,
    );
    expect(screen.getByRole('button', { name: 'ביטול המשימה' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'אישור' })).toBeNull();
  });

  it('refuses a confirm button that names nothing (R8)', () => {
    expect(() =>
      render(
        <ConfirmDialog title="מחיקה" consequence="לא ניתן לשחזר." confirmLabel="אישור"
          onCancel={vi.fn()} onConfirm={vi.fn()} />,
      ),
    ).toThrow(/פועל/);
  });

  it('opens with focus on cancel, so Enter does not destroy anything', () => {
    render(
      <ConfirmDialog title="מחיקת תשלום" consequence="לא ניתן לשחזר." confirmLabel="מחיקת התשלום"
        onCancel={vi.fn()} onConfirm={vi.fn()} />,
    );
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'ביטול' }));
  });

  it('cancels on esc without disturbing an enclosing drawer', () => {
    const onCancel = vi.fn();
    const drawerWouldClose = vi.fn();
    render(
      <div onKeyDown={drawerWouldClose}>
        <ConfirmDialog title="מחיקת תשלום" consequence="לא ניתן לשחזר." confirmLabel="מחיקת התשלום"
          onCancel={onCancel} onConfirm={vi.fn()} />
      </div>,
    );
    fireEvent.keyDown(screen.getByRole('alertdialog', { name: 'מחיקת תשלום' }), { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(drawerWouldClose).not.toHaveBeenCalled();
  });

  it('holds the verb disabled until the acknowledgement is checked', () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <ConfirmDialog
        title="מיזוג שני אנשים"
        consequence="2 כינויים, 3 תשלומים ומשימה אחת יעברו לרוני אדלר. המיזוג אינו הפיך."
        confirmLabel="מיזוג האנשים"
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
        acknowledge={{ id: 'ack', label: 'אני מבין שהמיזוג אינו הפיך', checked: false, onChange }}
      />,
    );
    expect((screen.getByRole('button', { name: 'מיזוג האנשים' }) as HTMLButtonElement).disabled)
      .toBe(true);
    fireEvent.click(screen.getByRole('checkbox', { name: 'אני מבין שהמיזוג אינו הפיך' }));
    expect(onChange).toHaveBeenCalledWith(true);

    rerender(
      <ConfirmDialog
        title="מיזוג שני אנשים"
        consequence="2 כינויים, 3 תשלומים ומשימה אחת יעברו לרוני אדלר. המיזוג אינו הפיך."
        confirmLabel="מיזוג האנשים"
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
        acknowledge={{ id: 'ack', label: 'אני מבין שהמיזוג אינו הפיך', checked: true, onChange }}
      />,
    );
    expect((screen.getByRole('button', { name: 'מיזוג האנשים' }) as HTMLButtonElement).disabled)
      .toBe(false);
  });

  it('shows the preview of what will move', () => {
    render(
      <ConfirmDialog title="מיזוג שני אנשים" consequence="המיזוג אינו הפיך."
        confirmLabel="מיזוג האנשים" onCancel={vi.fn()} onConfirm={vi.fn()}>
        <p>3 תשלומים · 2 כינויים · משימה אחת</p>
      </ConfirmDialog>,
    );
    expect(screen.getByText('3 תשלומים · 2 כינויים · משימה אחת')).toBeTruthy();
  });

  it('hides the rest of the page from the accessibility tree while open, and restores it on close', () => {
    function Harness({ open }: { open: boolean }) {
      return (
        <>
          <button type="button">מחיקה</button>
          {open ? (
            <ConfirmDialog title="מחיקת תשלום" consequence="לא ניתן לשחזר." confirmLabel="מחיקת התשלום"
              onCancel={vi.fn()} onConfirm={vi.fn()} />
          ) : null}
        </>
      );
    }
    const { rerender } = render(<Harness open={false} />);
    const opener = screen.getByRole('button', { name: 'מחיקה' });
    expect(opener.hasAttribute('inert')).toBe(false);

    rerender(<Harness open />);
    expect(opener.hasAttribute('inert')).toBe(true);

    rerender(<Harness open={false} />);
    expect(opener.hasAttribute('inert')).toBe(false);
  });

  it('never marks its own panel or scrim inert — the scrim still needs its click-to-cancel', () => {
    render(
      <ConfirmDialog title="מחיקת תשלום" consequence="לא ניתן לשחזר." confirmLabel="מחיקת התשלום"
        onCancel={vi.fn()} onConfirm={vi.fn()} />,
    );
    expect(screen.getByRole('alertdialog', { name: 'מחיקת תשלום' }).hasAttribute('inert')).toBe(false);
    const scrim = document.querySelector('[aria-hidden="true"]');
    expect(scrim).not.toBeNull();
    expect(scrim?.hasAttribute('inert')).toBe(false);
  });

  it('leaves a live region (a toast) reachable while it is open', () => {
    render(
      <>
        <div role="status">נרשם תשלום</div>
        <ConfirmDialog title="מחיקת תשלום" consequence="לא ניתן לשחזר." confirmLabel="מחיקת התשלום"
          onCancel={vi.fn()} onConfirm={vi.fn()} />
      </>,
    );
    expect(screen.getByRole('status').hasAttribute('inert')).toBe(false);
  });

  it('hides a Drawer it is raised over, and restores it on cancel — a ConfirmDialog over a Drawer', () => {
    function Harness({ confirmOpen }: { confirmOpen: boolean }) {
      return (
        <Drawer title="איתי כהן" closeHref="/fees">
          <button type="button">מחיקת התשלום</button>
          {confirmOpen ? (
            <ConfirmDialog title="מחיקת תשלום" consequence="לא ניתן לשחזר." confirmLabel="מחיקת התשלום"
              onCancel={vi.fn()} onConfirm={vi.fn()} />
          ) : null}
        </Drawer>
      );
    }
    const { rerender } = render(<Harness confirmOpen={false} />);
    const deleteButton = screen.getByRole('button', { name: 'מחיקת התשלום' });
    expect(deleteButton.hasAttribute('inert')).toBe(false);

    rerender(<Harness confirmOpen />);
    // The Drawer's own chrome is now background relative to the ConfirmDialog
    // stacked over it, so it is hidden the same as the page behind both —
    // but the Drawer's own root is a path ancestor of the ConfirmDialog and
    // must never be marked itself, or the ConfirmDialog would go with it.
    expect(deleteButton.hasAttribute('inert')).toBe(true);
    expect(screen.getByRole('dialog', { name: 'איתי כהן' }).hasAttribute('inert')).toBe(false);
    expect(screen.getByRole('alertdialog', { name: 'מחיקת תשלום' }).hasAttribute('inert')).toBe(false);

    rerender(<Harness confirmOpen={false} />);
    expect(deleteButton.hasAttribute('inert')).toBe(false);
  });
});

/**
 * Generated ids (`useId`) and the ids a caller derives from them are the only
 * part of this markup that is allowed to move, so they are masked. Everything
 * else — element names, nesting, classes, attributes, text — is the contract
 * a screen written before `cancelHref` existed is relying on.
 */
function stableHtml(html: string): string {
  return html.replace(/\b(id|for|aria-labelledby|aria-describedby|aria-errormessage)="[^"]*"/g, '$1="_"');
}

describe('ConfirmDialog — the additive guarantee', () => {
  /**
   * The net under the concurrent screen lanes: this snapshot was recorded
   * against the implementation as it stood *before* `cancelHref` was added,
   * from the prop set every existing caller passes. If a later change to this
   * component alters what those callers render, this fails and nothing else
   * has to notice.
   */
  it('renders the pre-cancelHref prop set byte for byte', () => {
    const { container } = render(
      <ConfirmDialog
        title="מיזוג שני אנשים"
        consequence="2 כינויים ו־3 תשלומים יעברו לרוני אדלר. המיזוג אינו הפיך."
        confirmLabel="מיזוג האנשים"
        cancelLabel="חזרה"
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
        acknowledge={{ id: 'ack', label: 'המיזוג אינו הפיך', checked: false, onChange: vi.fn() }}
      >
        <p>3 תשלומים · 2 כינויים</p>
      </ConfirmDialog>,
    );
    expect(stableHtml(container.innerHTML)).toMatchInlineSnapshot(`"<div class="_scrim_487c05" aria-hidden="true"></div><div class="_dialog_487c05" role="alertdialog" aria-modal="true" aria-labelledby="_" aria-describedby="_"><h2 class="_title_487c05" id="_">מיזוג שני אנשים</h2><p class="_consequence_487c05 _danger_487c05" id="_">2 כינויים ו־3 תשלומים יעברו לרוני אדלר. המיזוג אינו הפיך.</p><div class="_preview_487c05"><p>3 תשלומים · 2 כינויים</p></div><label class="_checkbox_f50c5c" for="_"><input class="_checkboxInput_f50c5c" id="_" type="checkbox"><span class="_checkboxLabel_f50c5c">המיזוג אינו הפיך</span></label><div class="_actions_487c05"><div><button class="_btn_852a75 _ghost_852a75" type="button">חזרה</button></div><button class="_btn_852a75 _primary_852a75" type="button" disabled="">מיזוג האנשים</button></div></div>"`);
  });
});

describe('ConfirmDialog — a cancel that is a link (plan 06, ruling 5)', () => {
  const closeHref = '/members/p1?tab=aliases';

  it('offers cancel as a link, so a Server Component can raise the dialog with no closure at all', () => {
    render(
      <ConfirmDialog
        title="ביטול קישור הכינוי"
        consequence="הכינוי יחזור לרשימת השמות שממתינים לשיוך."
        confirmLabel="ביטול הקישור"
        cancelHref={closeHref}
        action={async () => {}}
      />,
    );
    expect(screen.getByRole('link', { name: 'ביטול' }).getAttribute('href')).toBe(closeHref);
    expect(screen.queryByRole('button', { name: 'ביטול' })).toBeNull();
  });

  it('opens with focus on that link, so Enter still cancels rather than destroys', () => {
    render(
      <ConfirmDialog
        title="ביטול קישור הכינוי"
        consequence="הכינוי יחזור לרשימת השמות שממתינים לשיוך."
        confirmLabel="ביטול הקישור"
        cancelHref={closeHref}
        action={async () => {}}
      />,
    );
    expect(document.activeElement).toBe(screen.getByRole('link', { name: 'ביטול' }));
  });

  it('sends esc to the cancel href', () => {
    replace.mockClear();
    render(
      <ConfirmDialog
        title="ביטול קישור הכינוי"
        consequence="הכינוי יחזור לרשימת השמות שממתינים לשיוך."
        confirmLabel="ביטול הקישור"
        cancelHref={closeHref}
        action={async () => {}}
      />,
    );
    fireEvent.keyDown(screen.getByRole('alertdialog', { name: 'ביטול קישור הכינוי' }), { key: 'Escape' });
    expect(replace).toHaveBeenCalledWith(closeHref);
  });

  it('sends a scrim click to the cancel href', () => {
    replace.mockClear();
    render(
      <ConfirmDialog
        title="ביטול קישור הכינוי"
        consequence="הכינוי יחזור לרשימת השמות שממתינים לשיוך."
        confirmLabel="ביטול הקישור"
        cancelHref={closeHref}
        action={async () => {}}
      />,
    );
    const scrim = document.querySelector('[aria-hidden="true"]');
    expect(scrim).not.toBeNull();
    fireEvent.click(scrim!);
    expect(replace).toHaveBeenCalledWith(closeHref);
  });

  it('still submits the bound Server Action from the confirm button', () => {
    render(
      <ConfirmDialog
        title="ביטול קישור הכינוי"
        consequence="הכינוי יחזור לרשימת השמות שממתינים לשיוך."
        confirmLabel="ביטול הקישור"
        cancelHref={closeHref}
        action={async () => {}}
      />,
    );
    const confirm = screen.getByRole('button', { name: 'ביטול הקישור' }) as HTMLButtonElement;
    expect(confirm.type).toBe('submit');
    expect(confirm.closest('form')).not.toBeNull();
  });
});

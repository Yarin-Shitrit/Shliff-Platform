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

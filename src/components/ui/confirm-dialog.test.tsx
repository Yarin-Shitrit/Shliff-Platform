/** @vitest-environment jsdom */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ConfirmDialog } from './confirm-dialog';

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
});

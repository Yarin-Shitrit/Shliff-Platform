/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const nav = vi.hoisted(() => ({ pushed: [] as string[] }));
const found = vi.hoisted(() => ({ hits: [] as unknown[] }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: (href: string) => nav.pushed.push(href) }),
  useSearchParams: () => new URLSearchParams(''),
}));

vi.mock('@/app/(admin)/shell/actions', () => ({
  searchCommandPalette: async () => found.hits,
}));

import { CommandPalette } from '@/app/(admin)/shell/command-palette';

describe('CommandPalette', () => {
  beforeEach(() => {
    nav.pushed = [];
    found.hits = [];
  });

  it('is shut until it is asked for', () => {
    render(<CommandPalette />);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('button', { name: /חיפוש/ })).toBeTruthy();
  });

  /**
   * R10 in one assertion: the physical K key on a Hebrew layout reports
   * `key: 'ל'`. Binding to `event.key` would leave ⌘K dead for every user
   * of this app.
   */
  it('opens on ⌘K even when the keyboard is Hebrew', () => {
    render(<CommandPalette />);
    fireEvent.keyDown(document, { code: 'KeyK', key: 'ל', metaKey: true });
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('opens on ctrl+K too', () => {
    render(<CommandPalette />);
    fireEvent.keyDown(document, { code: 'KeyK', key: 'ל', ctrlKey: true });
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('opens on /', () => {
    render(<CommandPalette />);
    fireEvent.keyDown(document, { code: 'Slash', key: '.' });
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  /**
   * Actually dispatches `/`, unlike the version this replaced (which never
   * sent a `/` keydown at all and was really testing Escape). This is the
   * only coverage `isOpenShortcut`'s INPUT/TEXTAREA/SELECT/contentEditable
   * guard has: without it, `/` typed into an ordinary text field elsewhere
   * on the page would both pop the palette open and have its default action
   * (typing the character) swallowed by `event.preventDefault()`.
   */
  it('does not open on / while typing in a text field, but does open elsewhere', () => {
    render(
      <>
        <input aria-label="שדה טקסט אחר" />
        <CommandPalette />
      </>,
    );
    const field = screen.getByRole('textbox', { name: 'שדה טקסט אחר' });
    field.focus();
    const notPrevented = fireEvent.keyDown(field, { code: 'Slash', key: '/' });
    expect(notPrevented).toBe(true);
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.keyDown(document.body, { code: 'Slash', key: '/' });
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('offers the three actions before anything is typed', () => {
    render(<CommandPalette />);
    fireEvent.keyDown(document, { code: 'KeyK', key: 'ל', metaKey: true });
    expect(screen.getByRole('option', { name: /רישום תשלום/ })).toBeTruthy();
    expect(screen.getByRole('option', { name: /הוספת אדם/ })).toBeTruthy();
    expect(screen.getByRole('option', { name: /העלאת קובץ/ })).toBeTruthy();
  });

  it('groups what it finds by kind', async () => {
    found.hits = [
      { kind: 'person', id: 'p1', title: 'רוני אדלר', meta: '3 שנים', href: '/members/p1' },
      { kind: 'file', id: 's1', title: 'קופת קאמפ 2026 › תנועות קופה', meta: 'ברן 26', href: '/imports/u1' },
    ];
    render(<CommandPalette />);
    fireEvent.keyDown(document, { code: 'KeyK', key: 'ל', metaKey: true });
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'רונ' } });

    await waitFor(() => expect(screen.getByText('אנשים')).toBeTruthy());
    expect(screen.getByText('קבצים')).toBeTruthy();
    expect(screen.getByRole('option', { name: /רוני אדלר/ })).toBeTruthy();
  });

  it('moves with ↑↓ and opens with ↵', async () => {
    found.hits = [
      { kind: 'person', id: 'p1', title: 'רוני אדלר', meta: '3 שנים', href: '/members/p1' },
    ];
    render(<CommandPalette />);
    fireEvent.keyDown(document, { code: 'KeyK', key: 'ל', metaKey: true });
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'רונ' } });
    await waitFor(() => expect(screen.getByRole('option', { name: /רוני אדלר/ })).toBeTruthy());

    fireEvent.keyDown(screen.getByRole('combobox'), { code: 'Enter', key: 'Enter' });
    expect(nav.pushed).toEqual(['/members/p1']);
  });

  /**
   * The palette's trigger lives in the rail, but ⌘K and / open it from
   * anywhere — including below 1024px with the rail closed, where the rail
   * sits off-screen under a `transform` and would take every
   * `position: fixed` element inside it along: the palette would open
   * off-screen and take focus with it.
   */
  it('opens outside the rail that hosts it, scrim and all', () => {
    const { container } = render(<div data-rail><CommandPalette /></div>);
    fireEvent.keyDown(document, { code: 'KeyK', key: 'ל', metaKey: true });

    const dialog = screen.getByRole('dialog');
    expect(container.contains(dialog)).toBe(false);
    expect(container.contains(screen.getByRole('button', { name: 'סגירה' }))).toBe(false);
    // The trigger stays where it was.
    expect(container.contains(screen.getByRole('button', { name: /חיפוש/ }))).toBe(true);
  });

  it('hints its keys in the footer', () => {
    render(<CommandPalette />);
    fireEvent.keyDown(document, { code: 'KeyK', key: 'ל', metaKey: true });
    expect(screen.getByText('↑↓ ניווט')).toBeTruthy();
    expect(screen.getByText('↵ פתיחה')).toBeTruthy();
    expect(screen.getByText('esc סגירה')).toBeTruthy();
  });
});

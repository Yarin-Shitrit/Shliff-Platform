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

  it('does not open on / while someone is typing in the box', () => {
    render(<CommandPalette />);
    fireEvent.click(screen.getByRole('button', { name: /חיפוש/ }));
    const box = screen.getByRole('combobox');
    fireEvent.keyDown(box, { code: 'Escape', key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
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

  it('hints its keys in the footer', () => {
    render(<CommandPalette />);
    fireEvent.keyDown(document, { code: 'KeyK', key: 'ל', metaKey: true });
    expect(screen.getByText('↑↓ ניווט')).toBeTruthy();
    expect(screen.getByText('↵ פתיחה')).toBeTruthy();
    expect(screen.getByText('esc סגירה')).toBeTruthy();
  });
});

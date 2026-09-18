/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const route = vi.hoisted(() => ({ pathname: '/' }));
vi.mock('next/navigation', () => ({ usePathname: () => route.pathname }));

import { SidebarFrame } from '@/app/(admin)/shell/sidebar-frame';

describe('SidebarFrame', () => {
  beforeEach(() => { route.pathname = '/'; });

  it('opens the panel from a keyboard-reachable, Hebrew-labelled button', () => {
    render(<SidebarFrame><nav>rail</nav></SidebarFrame>);
    const menuButton = screen.getByRole('button', { name: 'תפריט' });
    fireEvent.click(menuButton);
    expect(screen.getByRole('button', { name: 'סגירה' })).toBeTruthy();
  });

  it('closes when the scrim is clicked, and the menu button comes back', () => {
    render(<SidebarFrame><nav>rail</nav></SidebarFrame>);
    fireEvent.click(screen.getByRole('button', { name: 'תפריט' }));
    fireEvent.click(screen.getByRole('button', { name: 'סגירה' }));
    expect(screen.queryByRole('button', { name: 'סגירה' })).toBeNull();
    expect(screen.getByRole('button', { name: 'תפריט' })).toBeTruthy();
  });

  it('closes on escape', () => {
    render(<SidebarFrame><nav>rail</nav></SidebarFrame>);
    fireEvent.click(screen.getByRole('button', { name: 'תפריט' }));
    fireEvent.keyDown(window, { code: 'Escape' });
    expect(screen.queryByRole('button', { name: 'סגירה' })).toBeNull();
  });

  it('closes automatically when the route changes', () => {
    const { rerender } = render(<SidebarFrame><nav>rail</nav></SidebarFrame>);
    fireEvent.click(screen.getByRole('button', { name: 'תפריט' }));
    expect(screen.getByRole('button', { name: 'סגירה' })).toBeTruthy();
    route.pathname = '/members';
    rerender(<SidebarFrame><nav>rail</nav></SidebarFrame>);
    expect(screen.queryByRole('button', { name: 'סגירה' })).toBeNull();
  });

  it('always renders the rail children, open or closed', () => {
    render(<SidebarFrame><nav aria-label="הקאמפ">rail</nav></SidebarFrame>);
    expect(screen.getByRole('navigation', { name: 'הקאמפ' })).toBeTruthy();
  });

  it('keeps the menu button mounted while the panel is open', () => {
    render(<SidebarFrame><nav>rail</nav></SidebarFrame>);
    const menuButton = screen.getByRole('button', { name: 'תפריט' });
    fireEvent.click(menuButton);
    // Still in the DOM — "closed" is a CSS state, not an unmount, or the
    // focused element would be yanked out from under the reader (A9).
    expect(screen.getByRole('button', { name: 'תפריט' })).toBe(menuButton);
  });

  it('moves focus into the panel when it opens', () => {
    render(<SidebarFrame><nav>rail</nav></SidebarFrame>);
    fireEvent.click(screen.getByRole('button', { name: 'תפריט' }));
    const panel = screen.getByText('rail').parentElement;
    expect(document.activeElement).toBe(panel);
  });

  it('returns focus to the menu button when the scrim closes the panel', () => {
    render(<SidebarFrame><nav>rail</nav></SidebarFrame>);
    const menuButton = screen.getByRole('button', { name: 'תפריט' });
    fireEvent.click(menuButton);
    fireEvent.click(screen.getByRole('button', { name: 'סגירה' }));
    expect(document.activeElement).toBe(menuButton);
  });

  it('returns focus to the menu button when escape closes the panel', () => {
    render(<SidebarFrame><nav>rail</nav></SidebarFrame>);
    const menuButton = screen.getByRole('button', { name: 'תפריט' });
    fireEvent.click(menuButton);
    fireEvent.keyDown(window, { code: 'Escape' });
    expect(document.activeElement).toBe(menuButton);
  });

  it('makes the page behind the panel inert while it is open', () => {
    render(
      <div>
        <SidebarFrame><nav>rail</nav></SidebarFrame>
        <div data-testid="column">page</div>
      </div>,
    );
    const column = screen.getByTestId('column');
    fireEvent.click(screen.getByRole('button', { name: 'תפריט' }));
    expect(column.hasAttribute('inert')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'סגירה' }));
    expect(column.hasAttribute('inert')).toBe(false);
  });
});

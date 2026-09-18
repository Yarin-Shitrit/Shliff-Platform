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
});

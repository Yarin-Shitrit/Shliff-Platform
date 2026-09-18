/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const route = vi.hoisted(() => ({ pathname: '/' }));
vi.mock('next/navigation', () => ({ usePathname: () => route.pathname }));

import { TabBar } from '@/app/(admin)/shell/tab-bar';

describe('TabBar', () => {
  beforeEach(() => { route.pathname = '/'; });

  it('carries B7 five items in B7 order', () => {
    render(<TabBar />);
    const names = screen.getAllByRole('link').map((item) => item.textContent);
    expect(names).toEqual(['בית', 'אנשים', 'כספים']);
    expect(screen.getByText('לטיפול')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'עוד' })).toBeTruthy();
  });

  it('marks the tab the current page belongs to, by prefix', () => {
    route.pathname = '/members/6f1c0e0e-0000-4000-8000-000000000000';
    render(<TabBar />);
    expect(screen.getByRole('link', { name: 'אנשים' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('link', { name: 'בית' }).getAttribute('aria-current')).toBeNull();
  });

  it('marks כספים current for the money route, keeping the item’s own id (B3)', () => {
    // כספים is a group label, not the money item's own label ("סקירה
    // כספית") — this only stays true while the tab keeps the item's real id
    // for both the href and the active match.
    route.pathname = '/money';
    render(<TabBar />);
    const moneyTab = screen.getByRole('link', { name: 'כספים' });
    expect(moneyTab.getAttribute('aria-current')).toBe('page');
    expect(moneyTab.getAttribute('href')).toBe('/money');
  });

  it('opens the rest of the sections behind עוד', () => {
    render(<TabBar />);
    expect(screen.queryByRole('link', { name: /דמי קאמפ/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'עוד' }));
    expect(screen.getByRole('link', { name: /דמי קאמפ/ })).toBeTruthy();
    expect(screen.getByRole('link', { name: /משימות/ })).toBeTruthy();
  });

  it('labels itself so a screen reader knows what it is', () => {
    render(<TabBar />);
    expect(screen.getByRole('navigation', { name: 'ניווט מהיר' })).toBeTruthy();
  });
});

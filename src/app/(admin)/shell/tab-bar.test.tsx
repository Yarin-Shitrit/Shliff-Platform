/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const route = vi.hoisted(() => ({ pathname: '/', season: null as string | null }));
const counts = vi.hoisted(() => ({
  value: { openDecisions: 0, rosterSize: 0, understaffedTasks: 0 },
}));

vi.mock('next/navigation', () => ({
  usePathname: () => route.pathname,
  useSearchParams: () => new URLSearchParams(route.season ? `season=${route.season}` : ''),
}));

vi.mock('@/app/(admin)/shell/actions', () => ({
  loadShellCounts: async () => counts.value,
}));

import { TabBar } from '@/app/(admin)/shell/tab-bar';

describe('TabBar', () => {
  beforeEach(() => {
    route.pathname = '/';
    route.season = null;
    counts.value = { openDecisions: 0, rosterSize: 0, understaffedTasks: 0 };
  });

  it('carries B7 five items in B7 order', () => {
    render(<TabBar />);
    const hrefs = screen.getAllByRole('link').map((item) => item.getAttribute('href'));
    expect(hrefs).toEqual(['/', '/members', '/money', '/inbox']);
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

  // ── B2 on the phone bar. The rail already carries these counts; the bar
  // must not be the one surface that disagrees, and a badge drawn without a
  // word is a number a screen reader never reads out.
  it('carries the open-decisions count inside the tab’s own name', async () => {
    counts.value = { openDecisions: 12, rosterSize: 4, understaffedTasks: 2 };
    render(<TabBar />);
    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'לטיפול, 12 פריטים' })).toBeTruthy();
    });
  });

  /**
   * Written the long way for the reason `nav-list.test.tsx` records: rendering
   * straight into the zero fixture and asserting "no badge" is satisfied on
   * the first tick, before the mocked action has even settled, so it measures
   * the pre-load state and cannot fail however `countOf` is wired. This loads
   * a real count first, waits for it to render, then drives a second load that
   * reads zero and asserts the badge and the phrase both go away.
   */
  it('drops the badge only once a real load reads the count as zero (B2)', async () => {
    counts.value = { openDecisions: 12, rosterSize: 0, understaffedTasks: 0 };
    const { rerender } = render(<TabBar />);
    await waitFor(() => expect(screen.getByText('12')).toBeTruthy());

    counts.value = { openDecisions: 0, rosterSize: 0, understaffedTasks: 0 };
    route.pathname = '/fees';
    rerender(<TabBar />);

    await waitFor(() => expect(screen.queryByText('12')).toBeNull());
    expect(screen.getByRole('link', { name: 'לטיפול' })).toBeTruthy();
    expect(screen.queryByText('0')).toBeNull();
  });

  // ── The עוד sheet is modal chrome, so it obeys the same four promises the
  // kit's own overlays make. Behaviour, not pixels: jsdom applies no CSS.
  it('opens עוד as a named dialog', () => {
    render(<TabBar />);
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'עוד' }));
    expect(screen.getByRole('dialog', { name: 'עוד' })).toBeTruthy();
  });

  it('moves focus inside the sheet, so the keyboard is already there', () => {
    render(<TabBar />);
    fireEvent.click(screen.getByRole('button', { name: 'עוד' }));
    const panel = screen.getByRole('dialog', { name: 'עוד' });
    expect(panel.contains(document.activeElement)).toBe(true);
  });

  it('closes on esc and gives focus back to what opened it', () => {
    render(<TabBar />);
    const trigger = screen.getByRole('button', { name: 'עוד' });
    // jsdom's synthetic click does not move focus the way a browser's does,
    // and the trap restores whatever was focused when it mounted. Focusing
    // first is what `drawer.test.tsx` does, for the same reason.
    trigger.focus();
    fireEvent.click(trigger);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('gives the sheet a close control with a name, not a bare tap-outside', () => {
    render(<TabBar />);
    fireEvent.click(screen.getByRole('button', { name: 'עוד' }));
    const close = screen.getByRole('button', { name: 'סגירה' });
    fireEvent.click(close);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

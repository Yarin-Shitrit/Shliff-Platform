/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

import type { Grants } from '@/lib/auth/access';

const session = vi.hoisted(() => ({ current: null as Grants | null }));

vi.mock('@/lib/auth/guard', () => ({
  currentUser: async () => session.current,
}));
vi.mock('@/app/(admin)/shell/actions', () => ({ signOutAction: async () => {} }));

import AdminNotFound from '@/app/(admin)/not-found';

describe('the (admin) not-found boundary', () => {
  beforeEach(() => { session.current = null; });

  it('tells a signed-in account with no page why the page is closed, not that it is missing (B9)', async () => {
    session.current = { id: 'u1', email: 'noa@shliff.camp', admin: false, pages: {} };
    render(await AdminNotFound());
    expect(screen.getByText('אין לך הרשאה לצפות בדף הזה')).toBeTruthy();
    expect(screen.queryByText('הדף לא נמצא')).toBeNull();
  });

  it('offers them a way out of the account that cannot see anything', async () => {
    render(await AdminNotFound());
    expect(screen.getByRole('button', { name: 'יציאה מהחשבון' })).toBeTruthy();
  });

  /**
   * The boundary cannot tell a closed page from a missing one, so it says
   * both — and turns the refusal into the pages that are open, which is the
   * one next move that helps either way.
   */
  it('lists the pages that are open to an account that landed on a closed one', async () => {
    session.current = {
      id: 'u1', email: 'noa@shliff.camp', admin: false, pages: { people: 'view', dues: 'edit' },
    };
    render(await AdminNotFound());
    expect(screen.getByText('אין לך הרשאה לצפות בדף הזה')).toBeTruthy();
    const open = screen.getByRole('list', { name: 'עמודים פתוחים' });
    expect(Array.from(open.querySelectorAll('a')).map((a) => [a.textContent, a.getAttribute('href')]))
      .toEqual([['אנשים', '/members'], ['דמי קאמפ', '/fees']]);
    expect(screen.queryByText('הדף לא נמצא')).toBeNull();
  });

  it('says plainly that the page is missing when an admin asks for a page that is not there', async () => {
    session.current = { id: 'u0', email: 'shira@shliff.camp', admin: true, pages: {} };
    render(await AdminNotFound());
    expect(screen.getByText('הדף לא נמצא')).toBeTruthy();
  });
});

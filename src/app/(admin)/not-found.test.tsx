/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const session = vi.hoisted(() => ({ ok: false as boolean, email: '' }));

vi.mock('@/lib/auth/guard', () => ({
  requireAdmin: async () => (session.ok ? { ok: true, email: session.email } : { ok: false }),
}));
vi.mock('@/app/(admin)/shell/actions', () => ({ signOutAction: async () => {} }));

import AdminNotFound from '@/app/(admin)/not-found';

describe('the (admin) not-found boundary', () => {
  beforeEach(() => { session.ok = false; session.email = ''; });

  it('tells a signed-in non-admin why the page is closed, not that it is missing (B9)', async () => {
    render(await AdminNotFound());
    expect(screen.getByText('אין לך הרשאה לצפות בדף הזה')).toBeTruthy();
    expect(screen.queryByText('הדף לא נמצא')).toBeNull();
  });

  it('offers them a way out of the account that cannot see anything', async () => {
    render(await AdminNotFound());
    expect(screen.getByRole('button', { name: 'יציאה מהחשבון' })).toBeTruthy();
  });

  it('says plainly that the page is missing when an admin asks for a page that is not there', async () => {
    session.ok = true;
    session.email = 'shira@shliff.camp';
    render(await AdminNotFound());
    expect(screen.getByText('הדף לא נמצא')).toBeTruthy();
  });
});

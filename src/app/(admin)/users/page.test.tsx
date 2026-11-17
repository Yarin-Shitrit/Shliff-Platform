/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import type { UserRow } from '@/lib/auth/users';
import { ToastProvider } from '@/components/ui/toaster';

const { requireAdmin, listUsers } = vi.hoisted(() => ({
  requireAdmin: vi.fn(), listUsers: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  notFound: () => { throw new Error('NEXT_NOT_FOUND'); },
  usePathname: () => '/users',
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('@/db', () => ({ db: {} }));
vi.mock('@/lib/auth/guard', () => ({ requireAdmin }));
vi.mock('@/lib/auth/users', () => ({ listUsers }));
vi.mock('./actions', () => ({
  createUserAction: vi.fn(), setUserAccessAction: vi.fn(),
  setUserPasswordAction: vi.fn(), deleteUserAction: vi.fn(),
}));

import UsersPage from './page';

const ME: UserRow = {
  id: 'u-me', email: 'shira@shliff.camp', admin: true, createdAt: new Date('2026-01-10T10:00:00Z'), pages: {},
};
const NOA: UserRow = {
  id: 'u-noa', email: 'noa@shliff.camp', admin: false, createdAt: new Date('2026-03-01T10:00:00Z'),
  pages: { people: 'view', dues: 'edit' },
};
const EMPTY: UserRow = {
  id: 'u-new', email: 'new@shliff.camp', admin: false, createdAt: new Date('2026-03-02T10:00:00Z'), pages: {},
};

async function page(params: { act?: string; peek?: string } = {}) {
  const tree = await UsersPage({ searchParams: Promise.resolve(params) });
  return render(<ToastProvider>{tree}</ToastProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
  requireAdmin.mockResolvedValue({ ok: true, email: 'shira@shliff.camp', level: 'edit', admin: true });
  listUsers.mockResolvedValue([ME, NOA, EMPTY]);
});

describe('UsersPage', () => {
  it('is the admin role\'s alone: a granted account is refused before the list is read', async () => {
    requireAdmin.mockResolvedValue({ ok: false });
    await expect(UsersPage({ searchParams: Promise.resolve({}) })).rejects.toThrow('NEXT_NOT_FOUND');
    expect(listUsers).not.toHaveBeenCalled();
    expect(requireAdmin).toHaveBeenCalledWith();
  });

  it('lists every account with its role and what it may open', async () => {
    await page();
    const table = screen.getByRole('table', { name: 'משתמשים' });
    expect(within(table).getByText('shira@shliff.camp')).toBeTruthy();
    expect(within(table).getByText('החשבון המחובר')).toBeTruthy();
    expect(within(table).getByText('ניהול מלא')).toBeTruthy();
    expect(within(table).getAllByText('לפי הרשאות')).toHaveLength(2);
    expect(within(table).getByText('כל העמודים')).toBeTruthy();
    expect(within(table).getByText('1 לצפייה · 1 לעריכה')).toBeTruthy();
    expect(within(table).getByText('אף עמוד')).toBeTruthy();
  });

  it('opens each account into its own drawer, and offers a new one', async () => {
    await page();
    expect(screen.getByRole('link', { name: 'noa@shliff.camp' }).getAttribute('href')).toBe('/users?peek=u-noa');
    expect(screen.getByRole('link', { name: 'חשבון חדש' }).getAttribute('href')).toBe('/users?act=user');
  });

  it('shows the grid for a granted account, with its rows set as stored', async () => {
    await page({ peek: 'u-noa' });
    const dialog = screen.getByRole('dialog', { name: 'noa@shliff.camp' });
    expect(within(dialog).getByRole('radio', { name: 'לפי הרשאות' })).toHaveProperty('checked', true);
    const people = within(dialog).getByRole('radiogroup', { name: 'אנשים' });
    expect(within(people).getByRole('radio', { name: 'צפייה בלבד' })).toHaveProperty('checked', true);
    const dues = within(dialog).getByRole('radiogroup', { name: 'דמי קאמפ' });
    expect(within(dues).getByRole('radio', { name: 'צפייה ועריכה' })).toHaveProperty('checked', true);
    const money = within(dialog).getByRole('radiogroup', { name: 'סקירה כספית' });
    expect(within(money).getByRole('radio', { name: 'בלי גישה' })).toHaveProperty('checked', true);
    expect(within(dialog).getByRole('button', { name: 'מחיקת החשבון' })).toBeTruthy();
  });

  it('withholds the role switch and the delete from the admin\'s own row', async () => {
    await page({ peek: 'u-me' });
    const dialog = screen.getByRole('dialog', { name: 'shira@shliff.camp' });
    expect(within(dialog).getByRole('radio', { name: 'ניהול מלא' })).toHaveProperty('disabled', true);
    expect(within(dialog).queryByRole('button', { name: 'מחיקת החשבון' })).toBeNull();
    expect(within(dialog).queryByRole('radiogroup', { name: 'אנשים' })).toBeNull();
  });

  it('asks for an address and a first password on a new account', async () => {
    await page({ act: 'user' });
    const dialog = screen.getByRole('dialog', { name: 'חשבון חדש' });
    expect(within(dialog).getByLabelText(/כתובת אימייל/)).toBeTruthy();
    expect(within(dialog).getByLabelText(/סיסמה ראשונית/)).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'יצירת החשבון' })).toBeTruthy();
  });

  it('says what an empty list means', async () => {
    listUsers.mockResolvedValue([]);
    await page();
    expect(screen.getByText('אין כאן כלום עדיין')).toBeTruthy();
    // The invitation, in the head and again in the empty state itself.
    expect(screen.getAllByRole('link', { name: 'חשבון חדש' })).toHaveLength(2);
  });
});

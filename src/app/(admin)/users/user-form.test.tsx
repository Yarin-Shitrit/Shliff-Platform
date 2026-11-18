/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ToastProvider } from '@/components/ui/toaster';
import { GENERATED_PASSWORD_LENGTH } from '@/lib/auth/generate-password';

const { router, actions, clipboard } = vi.hoisted(() => ({
  router: { push: vi.fn(), replace: vi.fn(), refresh: vi.fn() },
  actions: {
    createUserAction: vi.fn(), setUserAccessAction: vi.fn(),
    setUserPasswordAction: vi.fn(), deleteUserAction: vi.fn(),
  },
  clipboard: { writeText: vi.fn(async () => {}) },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => router,
  usePathname: () => '/users',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('./actions', () => actions);

import { UserForm } from './user-form';

const PASSWORD_SHAPE = new RegExp(`^[A-Za-z2-9]{${GENERATED_PASSWORD_LENGTH}}$`);

function mount(ui: React.ReactElement) {
  return render(<ToastProvider>{ui}</ToastProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(navigator, 'clipboard', { value: clipboard, configurable: true });
});

describe('UserForm — the password', () => {
  it('opens a new account with a password already made, visible, and another on request', () => {
    mount(<UserForm mode="create" closeHref="/users" />);
    const box = screen.getByLabelText(/סיסמה ראשונית/) as HTMLInputElement;
    expect(box.type).toBe('text');
    const first = box.value;
    expect(first).toMatch(PASSWORD_SHAPE);

    fireEvent.click(screen.getByRole('button', { name: 'יצירת סיסמה אחרת' }));
    expect(box.value).toMatch(PASSWORD_SHAPE);
    expect(box.value).not.toBe(first);
  });

  it('copies the password to the clipboard and says so', async () => {
    mount(<UserForm mode="create" closeHref="/users" />);
    const box = screen.getByLabelText(/סיסמה ראשונית/) as HTMLInputElement;
    fireEvent.click(screen.getByRole('button', { name: 'העתקת הסיסמה' }));
    await waitFor(() => expect(clipboard.writeText).toHaveBeenCalledWith(box.value));
    expect(await screen.findByText('הסיסמה הועתקה')).toBeTruthy();
  });

  /**
   * The drawer closing is the last moment the password can be read — the
   * server keeps the hash alone — so a saved account does not close the
   * drawer; it shows the password once, with the way to copy it.
   */
  it('shows the password once after the account is created, and only then offers to close', async () => {
    actions.createUserAction.mockResolvedValue({ ok: true, value: 'u-new' });
    mount(<UserForm mode="create" closeHref="/users?x=1" />);
    fireEvent.change(screen.getByLabelText(/כתובת אימייל/), { target: { value: 'noa@shliff.camp' } });
    const password = (screen.getByLabelText(/סיסמה ראשונית/) as HTMLInputElement).value;

    fireEvent.click(screen.getByRole('button', { name: 'יצירת החשבון' }));

    const panel = await screen.findByRole('status', { name: 'מסירת הסיסמה' });
    expect(actions.createUserAction).toHaveBeenCalledWith({
      email: 'noa@shliff.camp', password, admin: false, pages: {},
    });
    expect(panel.textContent).toContain('החשבון נוצר.');
    expect(panel.textContent).toContain('noa@shliff.camp');
    expect((screen.getByLabelText('הסיסמה') as HTMLInputElement).value).toBe(password);
    expect(screen.getByRole('link', { name: 'סיום' }).getAttribute('href')).toBe('/users?x=1');
    expect(router.replace).not.toHaveBeenCalled();
    expect(router.refresh).toHaveBeenCalled();
  });

  it('keeps the form, with the refusal, when the server refuses', async () => {
    actions.createUserAction.mockResolvedValue({ ok: false, error: 'כבר קיים חשבון עם הכתובת הזו.' });
    mount(<UserForm mode="create" closeHref="/users" />);
    fireEvent.change(screen.getByLabelText(/כתובת אימייל/), { target: { value: 'noa@shliff.camp' } });
    fireEvent.click(screen.getByRole('button', { name: 'יצירת החשבון' }));
    expect(await screen.findByText('כבר קיים חשבון עם הכתובת הזו.')).toBeTruthy();
    expect(screen.queryByRole('status', { name: 'מסירת הסיסמה' })).toBeNull();
  });

  it('makes a replacement for an existing account the same way, and shows it once when set', async () => {
    actions.setUserPasswordAction.mockResolvedValue({ ok: true });
    mount(
      <UserForm mode="edit" userId="u-noa" email="noa@shliff.camp" admin={false} pages={{}} closeHref="/users" />,
    );
    const box = screen.getByLabelText(/סיסמה חדשה/) as HTMLInputElement;
    expect(box.value).toBe('');
    expect(screen.getByRole('button', { name: 'החלפת הסיסמה' })).toHaveProperty('disabled', true);

    fireEvent.click(screen.getByRole('button', { name: 'יצירת סיסמה אחרת' }));
    const made = box.value;
    expect(made).toMatch(PASSWORD_SHAPE);

    fireEvent.click(screen.getByRole('button', { name: 'החלפת הסיסמה' }));
    const panel = await screen.findByRole('status', { name: 'מסירת הסיסמה' });
    expect(actions.setUserPasswordAction).toHaveBeenCalledWith('u-noa', made);
    expect(panel.textContent).toContain('הסיסמה הוחלפה.');
    expect((screen.getByLabelText('הסיסמה') as HTMLInputElement).value).toBe(made);

    fireEvent.click(screen.getByRole('button', { name: 'חזרה לחשבון' }));
    expect((screen.getByLabelText(/סיסמה חדשה/) as HTMLInputElement).value).toBe('');
  });
});

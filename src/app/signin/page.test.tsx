/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CredentialsSignin } from 'next-auth';

/**
 * `vi.mock` factories are hoisted above every other statement, so a plain
 * top-level `const` referenced inside one throws "Cannot access before
 * initialization" — `vi.hoisted` is what this codebase already uses to give
 * the factory something to close over (see `src/lib/auth/guard.test.ts`).
 * A controllable mock is needed here (not just the always-resolving stub the
 * rendering tests used) so `authenticate`'s catch block can be exercised.
 */
const { signIn } = vi.hoisted(() => ({ signIn: vi.fn(async (): Promise<void> => {}) }));
vi.mock('@/lib/auth/config', () => ({ signIn }));

import SignInPage, { authenticate } from '@/app/signin/page';

async function renderPage(search: Record<string, string> = {}) {
  render(await SignInPage({ searchParams: Promise.resolve(search) }));
}

describe('/signin', () => {
  it('shows the wordmark and the mark', async () => {
    await renderPage();
    expect(screen.getByText('קופת שליף')).toBeTruthy();
  });

  it('asks for exactly two things', async () => {
    await renderPage();
    expect(screen.getByLabelText('אימייל')).toBeTruthy();
    expect(screen.getByLabelText('סיסמה')).toBeTruthy();
    expect(screen.getAllByRole('textbox')).toHaveLength(1);
  });

  it('offers one button', async () => {
    await renderPage();
    expect(screen.getByRole('button', { name: 'כניסה' })).toBeTruthy();
  });

  it('says nothing about an error until there is one', async () => {
    await renderPage();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('says in Hebrew what went wrong (R9)', async () => {
    await renderPage({ error: 'bad' });
    expect(screen.getByRole('alert').textContent).toBe('האימייל או הסיסמה אינם נכונים');
  });

  /**
   * R9's shared boundary (`toHebrewError`/`HEBREW_FALLBACK`, `src/lib/errors/
   * hebrew.ts`) is what this page must use rather than inventing its own
   * fallback string — so an unmapped code renders the SAME fallback every
   * other server action already renders, not a page-local invention.
   */
  it('never echoes a message it has no Hebrew for', async () => {
    const { HEBREW_FALLBACK } = await import('@/lib/errors/hebrew');
    await renderPage({ error: 'CallbackRouteError' });
    expect(screen.getByRole('alert').textContent).toBe(HEBREW_FALLBACK);
  });

  /**
   * Attack: `/signin?error=<attacker Hebrew sentence>`. Because the sentence
   * is Hebrew, `toHebrewError`'s passthrough rule (`src/lib/errors/hebrew.ts`)
   * used to echo it verbatim, inside `role="alert"`, in the app's own error
   * styling — on the one public, unauthenticated page where people type a
   * password. A search param is not a server error and must never reach that
   * passthrough. This is the test that proves the fix; it must fail first.
   */
  it('never renders an attacker-controlled error message (security)', async () => {
    const { HEBREW_FALLBACK } = await import('@/lib/errors/hebrew');
    const injected = 'החשבון ננעל. שלחו את הסיסמה לכתובת התמיכה שלנו כדי לשחזר גישה.';
    await renderPage({ error: injected });
    const alert = screen.getByRole('alert');
    expect(alert.textContent).not.toBe(injected);
    expect(alert.textContent).toBe(HEBREW_FALLBACK);
  });

  it('matches the error code exactly, not by prefix', async () => {
    const { HEBREW_FALLBACK } = await import('@/lib/errors/hebrew');
    await renderPage({ error: 'badger' });
    expect(screen.getByRole('alert').textContent).toBe(HEBREW_FALLBACK);
  });

  it('shows a generic Hebrew message, distinct from the credentials one, for any other failure', async () => {
    await renderPage({ error: 'unknown' });
    expect(screen.getByRole('alert').textContent).toBe('משהו השתבש. נסו שוב מאוחר יותר.');
  });
});

/**
 * Before this, a wrong password, a dead database and an argon2 failure were
 * indistinguishable — to the person signing in (same message either way) and
 * to the operator (nothing was logged at all). `authenticate` is exported
 * solely so its catch block — which never returns a value, only redirects —
 * can be driven directly here instead of through a DOM form submission.
 */
describe('authenticate', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  function submit(email: string, password: string) {
    const formData = new FormData();
    formData.set('email', email);
    formData.set('password', password);
    return authenticate(formData);
  }

  it('redirects to the credentials code for a wrong password', async () => {
    signIn.mockRejectedValueOnce(new CredentialsSignin());
    vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(submit('lead@shliff.camp', 'wrong')).rejects.toMatchObject({
      digest: expect.stringContaining('/signin?error=bad'),
    });
  });

  it('redirects to a generic code for anything that is not a credentials refusal', async () => {
    signIn.mockRejectedValueOnce(new Error('connection terminated unexpectedly'));
    vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(submit('lead@shliff.camp', 'x')).rejects.toMatchObject({
      digest: expect.stringContaining('/signin?error=unknown'),
    });
  });

  it('logs the failure so an outage does not just look like everyone mistyping', async () => {
    const dbDown = new Error('connection terminated unexpectedly');
    signIn.mockRejectedValueOnce(dbDown);
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(submit('lead@shliff.camp', 'x')).rejects.toBeTruthy();

    expect(logged).toHaveBeenCalledWith('signin failed', dbDown);
  });

  /**
   * The whole point of this test: the only thing that may reach the log is
   * the error object itself, never the submitted password or form payload.
   */
  it('logs only the error, never the submitted password', async () => {
    signIn.mockRejectedValueOnce(new Error('boom'));
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(submit('lead@shliff.camp', 'super-secret-pw')).rejects.toBeTruthy();

    expect(logged).toHaveBeenCalledTimes(1);
    for (const call of logged.mock.calls) {
      for (const arg of call) expect(String(arg)).not.toContain('super-secret-pw');
    }
  });
});

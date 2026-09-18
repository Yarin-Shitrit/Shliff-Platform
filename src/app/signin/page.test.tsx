/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/lib/auth/config', () => ({ signIn: async () => {} }));

import SignInPage from '@/app/signin/page';

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
});

/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import AdminError from './error';

/** The boundary logs for the console; the test is not interested in the noise. */
let logged: ReturnType<typeof vi.spyOn>;
beforeEach(() => { logged = vi.spyOn(console, 'error').mockImplementation(() => {}); });
afterEach(() => { logged.mockRestore(); });

function mount(over: Partial<Error & { digest?: string }> = {}) {
  const error = Object.assign(
    new Error('relation "site_plans" does not exist'),
    { digest: '2711930458', ...over },
  );
  const reset = vi.fn();
  render(<AdminError error={error} reset={reset} />);
  return { reset };
}

describe('the admin error boundary', () => {
  it('never puts the thrown message on the screen', () => {
    // R9, at the outermost boundary. The failure that prompted this one was
    // `/site` throwing on a database without migration 0010, and the
    // platform's English error page answering on a Hebrew screen.
    mount();
    expect(document.body.textContent).not.toContain('relation');
    expect(document.body.textContent).not.toContain('does not exist');
  });

  it('says what happened in Hebrew, and that nothing was saved wrongly', () => {
    mount();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('המסך לא נטען');
    expect(document.body.textContent).toMatch(/שום נתון לא השתנה/);
  });

  it('shows the digest, because that is what finds the line in the log', () => {
    // React #441: the message is withheld in production on purpose and a
    // digest is attached instead. Without it on screen, a lead reporting
    // "it broke" gives nobody anything to search for.
    mount();
    expect(screen.getByText('2711930458')).toBeTruthy();
  });

  it('shows no digest line at all when there is none, rather than an empty label', () => {
    // In development React attaches none; a bare `מזהה התקלה:` with nothing
    // after it reads as a value that failed to load.
    mount({ digest: undefined });
    expect(document.body.textContent).not.toContain('מזהה התקלה');
  });

  it('offers to try again, and retries in place rather than navigating', () => {
    const { reset } = mount();
    fireEvent.click(screen.getByRole('button', { name: 'ניסיון נוסף' }));
    expect(reset).toHaveBeenCalled();
  });

  it('offers the home screen as the way out, because it does not know which screen failed', () => {
    mount();
    const back = screen.getByRole('link', { name: 'חזרה לבית' });
    expect(back.getAttribute('href')).toBe('/');
  });

  it('logs the real error for whoever is reading a console', () => {
    mount();
    expect(logged).toHaveBeenCalled();
  });

  it('says nothing in English anywhere a reader can see it', () => {
    mount();
    const visible = document.body.textContent ?? '';
    // The digest is digits, so the only Latin that could appear would be copy.
    expect(visible).not.toMatch(/[A-Za-z]/);
  });
});

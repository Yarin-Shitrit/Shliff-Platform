/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import LogisticsError from './error';

/** The boundary logs for the console; the test is not interested in the noise. */
let logged: ReturnType<typeof vi.spyOn>;
beforeEach(() => { logged = vi.spyOn(console, 'error').mockImplementation(() => {}); });
afterEach(() => { logged.mockRestore(); });

function mount(over: Partial<Error & { digest?: string }> = {}) {
  const error = Object.assign(
    new Error('relation "acquisition_items" does not exist'),
    { digest: '3820517063', ...over },
  );
  const reset = vi.fn();
  render(<LogisticsError error={error} reset={reset} />);
  return { reset };
}

describe('the logistics error boundary', () => {
  it('never puts the thrown message on the screen', () => {
    // R9, at the outermost boundary. The real failure that prompted this
    // boundary was a Postgres message in English reaching a Hebrew screen
    // through the platform's own error page.
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
    expect(screen.getByText('3820517063')).toBeTruthy();
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

  it('offers a way out that is not the screen that just failed', () => {
    mount();
    const back = screen.getByRole('link', { name: 'חזרה למחסן' });
    expect(back.getAttribute('href')).toBe('/logistics/warehouse');
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

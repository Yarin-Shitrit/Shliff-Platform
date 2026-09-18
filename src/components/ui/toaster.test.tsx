/** @vitest-environment jsdom */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { ToastProvider, useToast, type Toast } from './toaster';

const PAID = 'נרשם תשלום של 1,200 ₪ לאיתי כהן';
const PAID_TOO = 'נרשם תשלום של 800 ₪ לרוני אדלר';

/** One button per toast, so a test can fire two of them in order. */
function Harness({ toasts }: { toasts: Toast[] }) {
  const { show } = useToast();
  return (
    <>
      {toasts.map((toast, index) => (
        <button key={toast.message} type="button" onClick={() => { show(toast); }}>
          {`שלח ${index + 1}`}
        </button>
      ))}
    </>
  );
}

function mount(...toasts: Toast[]) {
  const { container } = render(<ToastProvider><Harness toasts={toasts} /></ToastProvider>);
  return {
    fire: (nth: number) => {
      fireEvent.click(screen.getByRole('button', { name: `שלח ${nth}` }));
    },
    polite: () => container.querySelector('[role="status"][aria-live="polite"]'),
    assertive: () => container.querySelector('[role="alert"]'),
  };
}

describe('the toaster', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('keeps both live regions in the DOM before anything has happened', () => {
    const { container } = render(<ToastProvider><span /></ToastProvider>);
    const polite = container.querySelector('[role="status"][aria-live="polite"]');
    const assertive = container.querySelector('[role="alert"]');
    expect(polite).toBeTruthy();
    expect(assertive).toBeTruthy();
    // Empty: a region that gains its role and its first child in one paint is
    // not reliably announced, which is why there are two of these and not one.
    expect(polite?.textContent).toBe('');
    expect(assertive?.textContent).toBe('');
    // Append-only, so a second toast does not re-read the first.
    expect(polite?.getAttribute('aria-atomic')).toBe('false');
    expect(assertive?.getAttribute('aria-atomic')).toBe('false');
  });

  it('puts a result in the polite region and leaves the assertive one empty', () => {
    const t = mount({ message: PAID });
    t.fire(1);
    expect(t.polite()?.textContent).toContain(PAID);
    expect(t.assertive()?.textContent).toBe('');
  });

  it('puts a failure in the assertive region and leaves the polite one empty', () => {
    const t = mount({ message: 'לא הצלחנו לשמור את התשלום', tone: 'bad' });
    t.fire(1);
    expect(t.assertive()?.textContent).toContain('לא הצלחנו לשמור את התשלום');
    expect(t.polite()?.textContent).toBe('');
  });

  it('stacks, so a second write does not silence the first', () => {
    const t = mount({ message: PAID }, { message: PAID_TOO });
    t.fire(1);
    t.fire(2);
    const text = t.polite()?.textContent ?? '';
    expect(text).toContain(PAID);
    expect(text).toContain(PAID_TOO);
    expect(text.indexOf(PAID)).toBeLessThan(text.indexOf(PAID_TOO));
  });

  it('closes when the reader closes it, under a Hebrew name of its own', () => {
    const t = mount({ message: PAID });
    t.fire(1);
    fireEvent.click(screen.getByRole('button', { name: 'סגירת ההודעה' }));
    expect(screen.queryByText(PAID)).toBeNull();
  });

  it('refuses to be used with no provider above it, rather than dropping the message', () => {
    expect(() => render(<Harness toasts={[{ message: PAID }]} />)).toThrow(/ToastProvider/);
  });

  it('clears a result after six seconds', () => {
    vi.useFakeTimers();
    const t = mount({ message: PAID });
    t.fire(1);
    act(() => { vi.advanceTimersByTime(5_999); });
    expect(screen.queryByText(PAID)).toBeTruthy();
    act(() => { vi.advanceTimersByTime(1); });
    expect(screen.queryByText(PAID)).toBeNull();
  });

  it('gives a toast carrying undo four seconds more, because a lead has to reach it', () => {
    vi.useFakeTimers();
    const t = mount({ message: PAID, undo: { label: 'ביטול', run: async () => ({ ok: true }) } });
    t.fire(1);
    act(() => { vi.advanceTimersByTime(6_000); });
    expect(screen.queryByText(PAID)).toBeTruthy();
    act(() => { vi.advanceTimersByTime(4_000); });
    expect(screen.queryByText(PAID)).toBeNull();
  });

  it('does not take a toast away while the reader is inside it', () => {
    vi.useFakeTimers();
    const t = mount({ message: PAID, undo: { label: 'ביטול', run: async () => ({ ok: true }) } });
    t.fire(1);
    act(() => { screen.getByRole('button', { name: 'ביטול' }).focus(); });
    act(() => { vi.advanceTimersByTime(30_000); });
    expect(screen.queryByText(PAID)).toBeTruthy();
  });

  it('runs the domain inverse when undo is taken, and stops saying what is no longer true', async () => {
    const run = vi.fn().mockResolvedValue({ ok: true });
    const t = mount({ message: PAID, undo: { label: 'ביטול', run } });
    t.fire(1);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'ביטול' })); });
    expect(run).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(PAID)).toBeNull();
  });

  it('reports a refused undo instead of swallowing it', async () => {
    const run = vi.fn().mockResolvedValue({ ok: false, error: 'לא ניתן למחוק תשלום שסוכם' });
    const t = mount({ message: PAID, undo: { label: 'ביטול', run } });
    t.fire(1);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'ביטול' })); });
    expect(t.assertive()?.textContent).toContain('לא ניתן למחוק תשלום שסוכם');
  });
});

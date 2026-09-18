/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const { replace } = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push: vi.fn(), refresh: vi.fn() }),
}));

import { Drawer } from './drawer';

const CLOSE = '/fees?season=s-9f2&view=unpaid';

function Harness({ open }: { open: boolean }) {
  return (
    <>
      <button type="button">תצוגה מהירה</button>
      {open ? (
        <Drawer title="רישום תשלום — איתי כהן" subtitle="תעריף רגיל · נותר 1,200 ₪" closeHref={CLOSE}>
          <label htmlFor="amount">סכום</label>
          <input id="amount" />
          <button type="button">הגדרת חריג</button>
        </Drawer>
      ) : null}
    </>
  );
}

describe('Drawer', () => {
  beforeEach(() => { replace.mockClear(); });

  it('is a modal dialog named by its title', () => {
    render(<Harness open />);
    const dialog = screen.getByRole('dialog', { name: 'רישום תשלום — איתי כהן' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
  });

  it('moves focus into itself, onto what opened rather than onto the close button', () => {
    render(<Harness open />);
    const dialog = screen.getByRole('dialog', { name: 'רישום תשלום — איתי כהן' });
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(document.activeElement?.textContent).toBe('רישום תשלום — איתי כהן');
  });

  it('returns focus to whatever opened it', () => {
    const { rerender } = render(<Harness open={false} />);
    const opener = screen.getByRole('button', { name: 'תצוגה מהירה' });
    opener.focus();
    expect(document.activeElement).toBe(opener);

    rerender(<Harness open />);
    expect(
      screen.getByRole('dialog', { name: 'רישום תשלום — איתי כהן' }).contains(document.activeElement),
    ).toBe(true);

    rerender(<Harness open={false} />);
    expect(document.activeElement).toBe(opener);
  });

  it('wraps Tab from the last control back to the first', () => {
    render(<Harness open />);
    const exception = screen.getByRole('button', { name: 'הגדרת חריג' });
    exception.focus();
    fireEvent.keyDown(exception, { key: 'Tab' });
    const first = screen.getByRole('link', { name: 'סגירה' });
    expect(document.activeElement).toBe(first);
  });

  it('closes on esc by routing to the same place the close button goes', () => {
    render(<Harness open />);
    fireEvent.keyDown(screen.getByRole('dialog', { name: 'רישום תשלום — איתי כהן' }), { key: 'Escape' });
    expect(replace).toHaveBeenCalledWith(CLOSE);
  });

  it('closes with a link, so it works without JavaScript', () => {
    render(<Harness open />);
    expect(screen.getByRole('link', { name: 'סגירה' }).getAttribute('href')).toBe(CLOSE);
  });

  it('steps between records by navigating, and disables the ends', () => {
    render(
      <Drawer
        title="איתי כהן"
        closeHref={CLOSE}
        stepper={{ position: 1, total: 9, previousHref: null, nextHref: '/fees?peek=p-18' }}
      >
        <p>תוכן</p>
      </Drawer>,
    );
    expect(screen.getByText('1 מתוך 9')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'הבא' }).getAttribute('href')).toBe('/fees?peek=p-18');
    expect((screen.getByRole('button', { name: 'הקודם' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('offers the record its full page when it has one', () => {
    render(
      <Drawer title="איתי כהן" closeHref={CLOSE} expandHref="/members/p-17">
        <p>תוכן</p>
      </Drawer>,
    );
    expect(screen.getByRole('link', { name: 'פתיחה בעמוד מלא' }).getAttribute('href'))
      .toBe('/members/p-17');
  });
});

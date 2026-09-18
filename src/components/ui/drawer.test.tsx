/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

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

  it('hides the rest of the page from the accessibility tree while open, and restores it on close', () => {
    const { rerender } = render(<Harness open={false} />);
    const opener = screen.getByRole('button', { name: 'תצוגה מהירה' });
    expect(opener.hasAttribute('inert')).toBe(false);

    rerender(<Harness open />);
    expect(opener.hasAttribute('inert')).toBe(true);

    rerender(<Harness open={false} />);
    expect(opener.hasAttribute('inert')).toBe(false);
  });

  it('never marks its own panel or scrim inert — the scrim still needs its click-to-close', () => {
    render(<Harness open />);
    expect(
      screen.getByRole('dialog', { name: 'רישום תשלום — איתי כהן' }).hasAttribute('inert'),
    ).toBe(false);
    const scrim = document.querySelector('[aria-hidden="true"]');
    expect(scrim).not.toBeNull();
    expect(scrim?.hasAttribute('inert')).toBe(false);
  });

  it('leaves a live region (a toast) reachable while it is open', () => {
    function HarnessWithToaster({ open }: { open: boolean }) {
      return (
        <>
          <div role="status">נרשם תשלום</div>
          {open ? (
            <Drawer title="רישום תשלום — איתי כהן" closeHref={CLOSE}>
              <p>תוכן</p>
            </Drawer>
          ) : null}
        </>
      );
    }
    render(<HarnessWithToaster open />);
    expect(screen.getByRole('status').hasAttribute('inert')).toBe(false);
  });
});

/**
 * How the drawer lands on a phone (plan 12, Task 3). A panel anchored to the
 * inline-end edge is right on a laptop and wrong on a phone, where it leaves a
 * strip of dead page beside something nobody can reach past.
 *
 * jsdom applies no CSS Module, so the render assertions here check the
 * *contract* the stylesheet keys on, and the two guards below check the
 * declarations themselves. Neither claims to have seen the sheet rendered.
 */
describe('Drawer, once it has to fit a phone', () => {
  it('records how it lands on a phone, so CSS can anchor it', () => {
    const { container } = render(
      <Drawer title="רישום תשלום" phone="full" closeHref={CLOSE} footer={<button type="button">רישום</button>}>
        <p>איתי כהן</p>
      </Drawer>,
    );
    expect(container.querySelector('[role="dialog"]')?.getAttribute('data-phone')).toBe('full');
  });

  it('defaults to a sheet, because most drawers are a record and not a form', () => {
    const { container } = render(
      <Drawer title="פרטי אדם" closeHref={CLOSE}><p>איתי כהן</p></Drawer>,
    );
    expect(container.querySelector('[role="dialog"]')?.getAttribute('data-phone')).toBe('sheet');
  });

  it('keeps a named way out, so a sheet is never dismissed only by a swipe', () => {
    render(<Drawer title="פרטי אדם" closeHref={CLOSE}><p>איתי כהן</p></Drawer>);
    expect(screen.getByRole('link', { name: 'סגירה' }).getAttribute('href')).toBe(CLOSE);
  });

  /**
   * svh, not vh. On iOS `100vh` is the viewport with the URL bar pretended
   * away, so a sheet sized in `vh` puts its footer — which is where the
   * confirm button is — underneath the browser chrome, and a lead taps the
   * address bar instead of רישום.
   */
  it('sizes the sheet against the small viewport, not the pretend one', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/components/ui/drawer.module.css'), 'utf8');
    const phone = css.slice(css.indexOf('@media (max-width: 767.98px)'));
    expect(phone).toContain('92svh');
    expect(phone).not.toMatch(/\d+vh\b/);
  });

  it('sizes the drawer with the tap token, never a literal 44', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/components/ui/drawer.module.css'), 'utf8');
    expect(css).not.toMatch(/min-(block|inline)-size:\s*44px/);
  });

  /**
   * The phone floor lives in one place, on tokens rather than literals, and
   * 16px on a text input is not a style choice: below 16px iOS Safari zooms
   * the page on focus and never zooms back. The fix is the font size — never
   * a viewport that forbids zooming, which would take away the one gesture a
   * lead in bright sun actually needs. Task 10 nets the repo for that.
   */
  it('keeps the phone floor in globals.css, on the tokens the kit already uses', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/app/globals.css'), 'utf8');
    const phone = css.slice(css.indexOf('@media (max-width: 767.98px)'));
    expect(phone).toContain('min-block-size: var(--tap-min)');
    expect(phone).toContain('font-size: var(--input-font-phone)');
  });
});

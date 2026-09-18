/** @vitest-environment jsdom */
import { useRef, type ReactElement } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useFocusTrap } from './use-focus-trap';

/** A minimal stand-in for `Drawer`/`ConfirmDialog`: a heading-focused trap. */
function Trap(
  { label, onEscape, hasScrim = false }: { label: string; onEscape: () => void; hasScrim?: boolean },
): ReactElement {
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const { rootRef, scrimRef, onKeyDown } = useFocusTrap<HTMLDivElement>({
    onEscape,
    getInitialFocus: () => headingRef.current,
    getExtraStart: () => headingRef.current,
  });
  return (
    <>
      {hasScrim ? <div aria-hidden="true" ref={scrimRef} onClick={onEscape} /> : null}
      <div ref={rootRef} onKeyDown={onKeyDown} role="dialog" aria-label={label}>
        <h2 ref={headingRef} tabIndex={-1}>{label}</h2>
        <button type="button">ראשון</button>
        <button type="button">אחרון</button>
      </div>
    </>
  );
}

describe('useFocusTrap', () => {
  it('focuses the given initial-focus element on mount', () => {
    render(<Trap label="חלון" onEscape={vi.fn()} />);
    expect(document.activeElement?.textContent).toBe('חלון');
  });

  it('wraps Tab from the last control back to the first', () => {
    render(<Trap label="חלון" onEscape={vi.fn()} />);
    const last = screen.getByRole('button', { name: 'אחרון' });
    last.focus();
    fireEvent.keyDown(last, { key: 'Tab' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'ראשון' }));
  });

  it('wraps shift+Tab from the heading (the extra start) to the last control', () => {
    render(<Trap label="חלון" onEscape={vi.fn()} />);
    const heading = screen.getByText('חלון');
    fireEvent.keyDown(heading, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'אחרון' }));
  });

  it('restores focus to the opener on unmount, and falls back to the body when it is gone', () => {
    function Harness({ open }: { open: boolean }) {
      return (
        <>
          <button type="button">פתיחה</button>
          {open ? <Trap label="חלון" onEscape={vi.fn()} /> : null}
        </>
      );
    }
    const { rerender } = render(<Harness open={false} />);
    const opener = screen.getByRole('button', { name: 'פתיחה' });
    opener.focus();

    rerender(<Harness open />);
    expect(document.activeElement?.textContent).toBe('חלון');

    rerender(<Harness open={false} />);
    expect(document.activeElement).toBe(opener);
  });

  it('closes on esc even after focus has moved outside the trapped root — the dead-esc bug', () => {
    const onEscape = vi.fn();
    render(
      <>
        <button type="button">מחוץ לחלון</button>
        <Trap label="חלון" onEscape={onEscape} />
      </>,
    );
    const outside = screen.getByRole('button', { name: 'מחוץ לחלון' });
    // Focus has left the trap entirely (an element-bound `onKeyDown` on the
    // panel would never see this keydown, since it never bubbles through it).
    outside.focus();
    fireEvent.keyDown(outside, { key: 'Escape' });
    expect(onEscape).toHaveBeenCalledTimes(1);
  });

  it('lets only the topmost of two open traps act on esc', () => {
    const outerEscape = vi.fn();
    const innerEscape = vi.fn();
    function Harness({ innerOpen }: { innerOpen: boolean }) {
      return (
        <>
          <Trap label="חיצוני" onEscape={outerEscape} />
          {innerOpen ? <Trap label="פנימי" onEscape={innerEscape} /> : null}
        </>
      );
    }
    const { rerender } = render(<Harness innerOpen />);
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(innerEscape).toHaveBeenCalledTimes(1);
    expect(outerEscape).not.toHaveBeenCalled();

    rerender(<Harness innerOpen={false} />);
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(outerEscape).toHaveBeenCalledTimes(1);
  });

  it('does not let esc bubble past this trap into an enclosing handler', () => {
    const onEscape = vi.fn();
    const enclosingWouldClose = vi.fn();
    render(
      <div onKeyDown={enclosingWouldClose}>
        <Trap label="חלון" onEscape={onEscape} />
      </div>,
    );
    fireEvent.keyDown(screen.getByRole('dialog', { name: 'חלון' }), { key: 'Escape' });
    expect(onEscape).toHaveBeenCalledTimes(1);
    expect(enclosingWouldClose).not.toHaveBeenCalled();
  });

  it('hides the rest of the page from the accessibility tree while open, and restores it on close', () => {
    function Harness({ open }: { open: boolean }) {
      return (
        <>
          <button type="button">שאר העמוד</button>
          {open ? <Trap label="חלון" onEscape={vi.fn()} /> : null}
        </>
      );
    }
    const { rerender } = render(<Harness open={false} />);
    const rest = screen.getByRole('button', { name: 'שאר העמוד' });
    expect(rest.hasAttribute('inert')).toBe(false);

    rerender(<Harness open />);
    expect(rest.hasAttribute('inert')).toBe(true);

    rerender(<Harness open={false} />);
    expect(rest.hasAttribute('inert')).toBe(false);
  });

  it('never marks the trap itself, or a scrim it was handed, inert', () => {
    render(
      <>
        <button type="button">שאר העמוד</button>
        <Trap label="חלון" onEscape={vi.fn()} hasScrim />
      </>,
    );
    expect(screen.getByRole('dialog', { name: 'חלון' }).hasAttribute('inert')).toBe(false);
    const scrim = document.querySelector('[aria-hidden="true"]');
    expect(scrim).not.toBeNull();
    expect(scrim?.hasAttribute('inert')).toBe(false);
  });

  it('leaves a live region reachable even while the trap is open', () => {
    render(
      <>
        <div role="status">נשמר</div>
        <Trap label="חלון" onEscape={vi.fn()} />
      </>,
    );
    expect(screen.getByRole('status').hasAttribute('inert')).toBe(false);
  });

  it('only the topmost of two open traps stays out of the hidden background', () => {
    function Harness({ innerOpen }: { innerOpen: boolean }) {
      return (
        <>
          <Trap label="חיצוני" onEscape={vi.fn()} />
          {innerOpen ? <Trap label="פנימי" onEscape={vi.fn()} /> : null}
        </>
      );
    }
    const { rerender } = render(<Harness innerOpen />);
    expect(screen.getByRole('dialog', { name: 'פנימי' }).hasAttribute('inert')).toBe(false);
    expect(screen.getByRole('dialog', { name: 'חיצוני' }).hasAttribute('inert')).toBe(true);

    rerender(<Harness innerOpen={false} />);
    expect(screen.getByRole('dialog', { name: 'חיצוני' }).hasAttribute('inert')).toBe(false);
  });
});

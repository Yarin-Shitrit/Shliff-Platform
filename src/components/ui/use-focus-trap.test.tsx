/** @vitest-environment jsdom */
import { useRef, type ReactElement } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useFocusTrap } from './use-focus-trap';

/** A minimal stand-in for `Drawer`/`ConfirmDialog`: a heading-focused trap. */
function Trap({ label, onEscape }: { label: string; onEscape: () => void }): ReactElement {
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const { rootRef, onKeyDown } = useFocusTrap<HTMLDivElement>({
    onEscape,
    getInitialFocus: () => headingRef.current,
    getExtraStart: () => headingRef.current,
  });
  return (
    <div ref={rootRef} onKeyDown={onKeyDown} role="dialog" aria-label={label}>
      <h2 ref={headingRef} tabIndex={-1}>{label}</h2>
      <button type="button">ראשון</button>
      <button type="button">אחרון</button>
    </div>
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
});

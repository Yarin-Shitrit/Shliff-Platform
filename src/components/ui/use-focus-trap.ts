'use client';
/**
 * Client hook: trapping Tab inside a panel, restoring the opener, and closing
 * on `esc` are all DOM lifecycle — R1 rules out the headless-UI dependency
 * that would otherwise supply them. `Drawer` and `ConfirmDialog` each hand-
 * wrote the same fifteen lines for this; this is that logic, written once.
 */
import { useEffect, useEffectEvent, useRef, type KeyboardEvent as ReactKeyboardEvent } from 'react';

export const TABBABLE = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled])',
  'select:not([disabled])', 'textarea:not([disabled])', '[tabindex]:not([tabindex="-1"])',
].join(', ');

export function tabbableIn(root: HTMLElement | null): HTMLElement[] {
  if (root === null) return [];
  return [...root.querySelectorAll<HTMLElement>(TABBABLE)]
    .filter((element) => element.closest('[hidden]') === null);
}

/**
 * Every mounted trap, in mount order. `esc` is handled at `document` (see
 * below) so it fires no matter where focus has wandered to, which means two
 * open traps both hear the same keydown — only the last one in this stack
 * (the innermost: a ConfirmDialog raised over a Drawer) is allowed to act on
 * it, exactly as the old element-bound `stopPropagation()` intended.
 */
const stack: symbol[] = [];

export type FocusTrapOptions = {
  /** Run when `esc` is pressed and this trap is the topmost one open. */
  onEscape: () => void;
  /** The element to focus once the trap mounts — a heading, a cancel button. */
  getInitialFocus: () => HTMLElement | null;
  /**
   * An extra "start of the cycle" element for shift+Tab to wrap from, for a
   * trap whose initial focus lands on a heading rather than on the first
   * tabbable control (`Drawer`'s title, which carries `tabIndex={-1}`).
   */
  getExtraStart?: () => HTMLElement | null;
};

export function useFocusTrap<T extends HTMLElement>({
  onEscape, getInitialFocus, getExtraStart,
}: FocusTrapOptions) {
  const rootRef = useRef<T | null>(null);
  const openerRef = useRef<Element | null>(null);

  // Effect Events, not a "latest ref" written during render: each always
  // calls today's `onEscape`/`getInitialFocus` without needing to be a
  // reactive dependency of the mount effect below.
  const focusInitial = useEffectEvent(() => { getInitialFocus()?.focus(); });
  const handleEscape = useEffectEvent(() => { onEscape(); });

  useEffect(() => {
    const id = Symbol('focus-trap');
    stack.push(id);
    openerRef.current = document.activeElement;
    focusInitial();

    // Bound at `document`, not the panel: the old per-element `onKeyDown`
    // went dead the moment Tab (or a click) moved focus outside the panel,
    // because a keydown only bubbles from wherever focus is. Capture phase,
    // not bubble: this must run — and, when this is not the topmost trap,
    // decline — *before* the event can reach an enclosing overlay's own
    // handler or the page behind it, not after.
    function onDocumentKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      if (stack[stack.length - 1] !== id) return;
      event.preventDefault();
      event.stopPropagation();
      handleEscape();
    }
    document.addEventListener('keydown', onDocumentKeyDown, true);

    return () => {
      document.removeEventListener('keydown', onDocumentKeyDown, true);
      const index = stack.indexOf(id);
      if (index !== -1) stack.splice(index, 1);
      const opener = openerRef.current;
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
      else document.body.focus();
    };
  }, []);

  function onKeyDown(event: ReactKeyboardEvent<HTMLElement>) {
    if (event.key !== 'Tab') return;
    const focusable = tabbableIn(rootRef.current);
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    const extraStart = getExtraStart?.() ?? null;
    if (event.shiftKey && (active === first || active === extraStart)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return { rootRef, onKeyDown };
}

'use client';
/**
 * Client hook: trapping Tab inside a panel, restoring the opener, and closing
 * on `esc` are all DOM lifecycle — R1 rules out the headless-UI dependency
 * that would otherwise supply them. `Drawer` and `ConfirmDialog` each hand-
 * wrote the same fifteen lines for this; this is that logic, written once.
 *
 * It also owns the `inert` side of being modal (see `recomputeBackgroundInert`
 * below): a focus trap only constrains sequential (Tab) navigation, but
 * `aria-modal="true"` promises a screen reader in browse mode that nothing
 * behind the dialog is reachable either. Both consumers already call this
 * hook to get a `rootRef`, so the background is hidden from the same place
 * that already knows, in mount order, which trap is topmost.
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

type TrapEntry = { id: symbol; root: HTMLElement; scrim: HTMLElement | null };

/**
 * Every mounted trap, in mount order. `esc` is handled at `document` (see
 * below) so it fires no matter where focus has wandered to, which means two
 * open traps both hear the same keydown — only the last one in this stack
 * (the innermost: a ConfirmDialog raised over a Drawer) is allowed to act on
 * it, exactly as the old element-bound `stopPropagation()` intended.
 *
 * Each entry also carries the DOM nodes `recomputeBackgroundInert` must never
 * touch: the panel itself, and its scrim (a click target, not just a visual).
 */
const stack: TrapEntry[] = [];

/**
 * A live region must stay announced even while a dialog is open — a toast
 * reporting an undo's result while `ConfirmDialog` is still up, say. Rather
 * than name `Toaster`'s markup here (coupling this file to where the toaster
 * happens to be mounted), any subtree carrying one of these roles is left
 * alone and *recursed into* instead of being marked inert wholesale, so the
 * live region itself — wherever it lives in the tree — is never covered by
 * hiding an ancestor it happens to share with the page's ordinary content.
 */
const LIVE_REGION_SELECTOR = '[role="alert"], [role="status"], [aria-live]';

function hidesLiveRegion(element: Element): boolean {
  return element.matches(LIVE_REGION_SELECTOR) || element.querySelector(LIVE_REGION_SELECTOR) !== null;
}

/** Every element this module has itself set `inert` on, so closing (or a new topmost) can undo exactly that and nothing else. */
let appliedInert: Element[] = [];

/**
 * Re-derives, from scratch, which elements are "the background" relative to
 * the *topmost* open trap and marks them `inert` — non-interactive and out of
 * the accessibility tree, which a focus trap alone cannot promise a browse-
 * mode screen-reader user. Only the topmost trap's own panel and scrim are
 * ever kept reachable: an outer trap covered by a newer one (a ConfirmDialog
 * raised over a Drawer) is *not* specially protected, so its own chrome is
 * hidden the same as the page behind it — which is also what keeps two
 * simultaneously-open, unrelated traps from each hiding the other, since only
 * the single global topmost is ever exempted.
 *
 * Called fresh on every push and pop (not just the 0↔1 transition): it always
 * releases every mark it previously applied before recomputing, so it is
 * idempotent no matter which trap's mount/unmount triggered it.
 */
function recomputeBackgroundInert() {
  for (const element of appliedInert) element.removeAttribute('inert');
  appliedInert = [];

  const topmost = stack[stack.length - 1];
  if (topmost === undefined) return;

  const keep = new Set<Element>([topmost.root]);
  if (topmost.scrim !== null) keep.add(topmost.scrim);

  // Every ancestor between a kept element and `document.body`, so the walk
  // below can step *through* them (to reach their other children) without
  // marking the ancestor itself — marking it would hide the kept element too.
  const path = new Set<Element>();
  for (const element of keep) {
    for (let node = element.parentElement; node !== null && node !== document.body; node = node.parentElement) {
      path.add(node);
    }
  }

  function walk(node: Element) {
    for (const child of Array.from(node.children)) {
      if (keep.has(child)) continue;
      if (path.has(child) || hidesLiveRegion(child)) { walk(child); continue; }
      child.setAttribute('inert', '');
      appliedInert.push(child);
    }
  }
  walk(document.body);
}

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
  /**
   * The overlay's scrim, when it has one — `Drawer` and `ConfirmDialog` both
   * attach this to their `.scrim` `div` so `recomputeBackgroundInert` can
   * keep it out of what gets marked `inert`. It carries a click handler
   * (closing the overlay); an `inert` scrim would silently stop responding to
   * that click for a sighted mouse user, which is exactly the regression the
   * background-hiding fix must not cause. Typed to the concrete element (a
   * `div`, in both current callers) rather than parameterised like `rootRef`,
   * since nothing here needs it to be anything else.
   */
  const scrimRef = useRef<HTMLDivElement | null>(null);
  const openerRef = useRef<Element | null>(null);

  // Effect Events, not a "latest ref" written during render: each always
  // calls today's `onEscape`/`getInitialFocus` without needing to be a
  // reactive dependency of the mount effect below.
  const focusInitial = useEffectEvent(() => { getInitialFocus()?.focus(); });
  const handleEscape = useEffectEvent(() => { onEscape(); });

  useEffect(() => {
    const id = Symbol('focus-trap');
    const root = rootRef.current;
    if (root === null) return undefined;
    stack.push({ id, root, scrim: scrimRef.current });
    openerRef.current = document.activeElement;
    focusInitial();
    // After focus has already moved into the panel, so a real browser's own
    // "focus was inside what just went inert" handling never has anything to
    // do here — see the module doc for what this hides and what it never does.
    recomputeBackgroundInert();

    // Bound at `document`, not the panel: the old per-element `onKeyDown`
    // went dead the moment Tab (or a click) moved focus outside the panel,
    // because a keydown only bubbles from wherever focus is. Capture phase,
    // not bubble: this must run — and, when this is not the topmost trap,
    // decline — *before* the event can reach an enclosing overlay's own
    // handler or the page behind it, not after.
    function onDocumentKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      if (stack[stack.length - 1]?.id !== id) return;
      event.preventDefault();
      event.stopPropagation();
      handleEscape();
    }
    document.addEventListener('keydown', onDocumentKeyDown, true);

    return () => {
      document.removeEventListener('keydown', onDocumentKeyDown, true);
      const index = stack.findIndex((entry) => entry.id === id);
      if (index !== -1) stack.splice(index, 1);
      // Before the focus restore below: an opener that is still (wrongly)
      // marked `inert` at that moment would silently refuse the `.focus()`.
      recomputeBackgroundInert();
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

  return { rootRef, scrimRef, onKeyDown };
}

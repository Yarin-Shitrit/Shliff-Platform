'use client';

/**
 * Renders an overlay the rail owns into `document.body` instead of in place.
 *
 * Below 1024px a closed rail is moved off-screen with a `transform`
 * (`sidebar.module.css`, `.rail`), and a transformed element is the
 * containing block of every `position: fixed` element inside it. A drawer or
 * the palette rendered in place would open inside that off-screen box
 * whenever the rail is closed — `?act=…` loaded directly, a link from a page,
 * ⌘K — and a drawer's focus trap would make the visible page inert around it.
 * The rail's own transform stays as it is (ruled): the overlays leave it.
 *
 * The server has no `document`, and the first client render must match the
 * server's, so this renders nothing until the browser is running it and the
 * overlay appears one commit after hydration.
 */
import { useSyncExternalStore, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

const neverChanges = () => () => {};

export function BodyPortal({ children }: { children: ReactNode }) {
  const inBrowser = useSyncExternalStore(neverChanges, () => true, () => false);
  return inBrowser ? createPortal(children, document.body) : null;
}

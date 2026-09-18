'use client';

// A client component because a keyboard listener is a browser event: there is
// no server-rendered equivalent of "press 1 to link this name".

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/** R10: only digits and arrows. A single-letter shortcut on a Hebrew layout
 *  is a different key on every keyboard, so there are none. */
const ALLOWED = /^Digit[1-5]$/;

function typing(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

export function InboxKeyboard({
  digits, prevHref, nextHref,
}: {
  /** `Digit<n>` → the id of the button to press. */
  digits: Record<string, string>;
  prevHref: string | null;
  nextHref: string | null;
}): null {
  const router = useRouter();

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (typing(event.target)) return;

      if (event.code === 'ArrowDown' && nextHref) {
        event.preventDefault();
        router.push(nextHref);
        return;
      }
      if (event.code === 'ArrowUp' && prevHref) {
        event.preventDefault();
        router.push(prevHref);
        return;
      }

      if (!ALLOWED.test(event.code)) return;
      const id = digits[event.code];
      if (!id) return;
      const button = document.getElementById(id);
      if (!(button instanceof HTMLButtonElement) && !(button instanceof HTMLAnchorElement)) return;
      event.preventDefault();
      // The keyboard presses the same control the pointer does, so the two
      // paths cannot diverge — a digit can never do something no button does,
      // and cannot skip a confirmation the button raises.
      button.click();
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [digits, prevHref, nextHref, router]);

  return null;
}

import { within } from '@testing-library/react';

/**
 * E4's two questions, asked of a rendered tree: what can take focus, and what
 * has no name.
 *
 * R1 forbids adding axe or `jest-dom`, and neither is needed: the accessible
 * name computation these use is the one `@testing-library/dom` already ships,
 * and the focus order is the DOM's own.
 */

const FOCUSABLE = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled])',
  'select:not([disabled])', 'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

/** Every element that can take focus, in document order. */
export function focusableIn(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE))
    // `inert` and `hidden` take a whole subtree out of the tab order, and the
    // shell marks the page behind an open overlay with the first of them.
    .filter((element) => element.closest('[hidden], [inert]') === null);
}

/**
 * Controls inside `container` whose computed accessible name is empty.
 *
 * `name: ''` is an **exact** match against the computed name, so this returns
 * exactly the controls that have none — an icon-only button whose glyph says
 * "delete" to a sighted reader and nothing at all to anyone else. E4's rule is
 * that the answer to "this is []" is never blank.
 */
export function unnamedControls(container: HTMLElement): HTMLElement[] {
  const scope = within(container);
  return [
    ...scope.queryAllByRole('button', { name: '' }),
    ...scope.queryAllByRole('link', { name: '' }),
    ...scope.queryAllByRole('checkbox', { name: '' }),
    ...scope.queryAllByRole('tab', { name: '' }),
  ];
}

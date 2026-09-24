/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import { BodyPortal } from './body-portal';

/**
 * The server half, which the three consumers' jsdom tests cannot see: with
 * no `document` to portal into, the server renders nothing — rather than
 * throwing, and rather than rendering the overlay in place, inside the rail
 * it is meant to escape. The client half (the overlay lands in
 * `document.body`) is asserted by `season-date-drawer`, `new-season-drawer`
 * and `command-palette`.
 */
describe('BodyPortal on the server', () => {
  it('has no document here, so the test is really on the server', () => {
    expect(typeof document).toBe('undefined');
  });

  it('renders nothing, and does not reach for document', () => {
    expect(renderToString(<BodyPortal><p>שכבה</p></BodyPortal>)).toBe('');
  });
});

/** @vitest-environment jsdom */
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Popover, computePanelPosition } from './popover';

function renderPopover() {
  return render(
    <div>
      <button type="button">מחוץ לפופאובר</button>
      <Popover id="add-filter" label="סינון">
        {/* A plain anchor on purpose: this proves `Popover` closes on any
            interactive child it is handed, not only a `next/link` one. */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- see above */}
        <a href="/members?view=unpaid">טרם שילמו</a>
      </Popover>
    </div>,
  );
}

describe('Popover', () => {
  it('starts closed and says so', () => {
    renderPopover();
    expect(screen.getByRole('button', { name: 'סינון' }).getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('link', { name: 'טרם שילמו' })).toBeNull();
  });

  it('opens on the trigger and points at its panel', () => {
    renderPopover();
    const trigger = screen.getByRole('button', { name: 'סינון' });
    fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    const panelId = trigger.getAttribute('aria-controls') ?? '';
    expect(document.getElementById(panelId)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'טרם שילמו' })).toBeTruthy();
  });

  it('closes on a pointerdown outside it', () => {
    renderPopover();
    fireEvent.click(screen.getByRole('button', { name: 'סינון' }));
    fireEvent.pointerDown(screen.getByRole('button', { name: 'מחוץ לפופאובר' }));
    expect(screen.queryByRole('link', { name: 'טרם שילמו' })).toBeNull();
  });

  it('stays open on a pointerdown inside it', () => {
    renderPopover();
    fireEvent.click(screen.getByRole('button', { name: 'סינון' }));
    fireEvent.pointerDown(screen.getByRole('link', { name: 'טרם שילמו' }));
    expect(screen.getByRole('link', { name: 'טרם שילמו' })).toBeTruthy();
  });

  it('closes on esc and gives focus back to the trigger', () => {
    renderPopover();
    const trigger = screen.getByRole('button', { name: 'סינון' });
    fireEvent.click(trigger);
    fireEvent.keyDown(screen.getByRole('link', { name: 'טרם שילמו' }), { key: 'Escape' });
    expect(screen.queryByRole('link', { name: 'טרם שילמו' })).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('closes when a choice inside it is made', () => {
    renderPopover();
    fireEvent.click(screen.getByRole('button', { name: 'סינון' }));
    fireEvent.click(screen.getByRole('link', { name: 'טרם שילמו' }));
    expect(screen.queryByRole('link', { name: 'טרם שילמו' })).toBeNull();
  });
});

/*
 * The numbers are worked out by hand from a 1000×600 window: GAP is 6 and the
 * edge margin 8. jsdom has no layout, so the placing is tested as arithmetic.
 */
describe('computePanelPosition', () => {
  const viewport = { width: 1000, height: 600 };
  const trigger = (top: number) => ({ top, bottom: top + 28, left: 400, right: 480 });

  it('caps a long list to the room under its trigger, so it scrolls instead of leaving the window', () => {
    // 40 people at ~32px is 1280px of list; under a trigger ending at 128 there is 600 - 134 - 8 = 458.
    const placed = computePanelPosition(trigger(100), { width: 200, height: 1280 }, 'end', viewport);
    expect(placed.top).toBe(134);
    expect(placed.maxHeight).toBe(458);
    expect(placed.top + placed.maxHeight).toBeLessThanOrEqual(viewport.height);
  });

  it('opens upwards when the list does not fit below and there is more room above', () => {
    // Trigger at 500–528: 58 below, 500 - 6 - 8 = 486 above. A 300px list sits at 500 - 6 - 300.
    const placed = computePanelPosition(trigger(500), { width: 200, height: 300 }, 'end', viewport);
    expect(placed.maxHeight).toBe(486);
    expect(placed.top).toBe(194);
  });

  it('stays below a trigger near the bottom when the list fits there', () => {
    const placed = computePanelPosition(trigger(500), { width: 200, height: 40 }, 'end', viewport);
    expect(placed.top).toBe(534);
    expect(placed.maxHeight).toBe(58);
  });

  it('gives the open panel its cap as an inline max block size', () => {
    renderPopover();
    fireEvent.click(screen.getByRole('button', { name: 'סינון' }));
    const panel = document.getElementById('add-filter-panel');
    expect(panel).not.toBeNull();
    // jsdom rects are all zero: top is 6, so the cap is innerHeight - 6 - 8.
    expect(panel?.style.maxBlockSize).toBe(`${window.innerHeight - 14}px`);
  });
});

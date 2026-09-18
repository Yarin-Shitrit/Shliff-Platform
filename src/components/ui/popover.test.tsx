/** @vitest-environment jsdom */
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Popover } from './popover';

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

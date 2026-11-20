/** @vitest-environment jsdom */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { InfoTip } from './info-tip';

const TEXT = 'ימי העבודה מגיעים מלוח הנוכחות.';

function renderTip() {
  return render(
    <div>
      <button type="button">מחוץ להסבר</button>
      <InfoTip id="about-days" label="על ימי העבודה">{TEXT}</InfoTip>
    </div>,
  );
}

afterEach(() => { vi.useRealTimers(); });

describe('InfoTip', () => {
  it('starts closed: the explanation is not on the screen', () => {
    renderTip();
    const trigger = screen.getByRole('button', { name: 'על ימי העבודה' });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText(TEXT)).toBeNull();
  });

  it('opens on a press and describes its trigger with the panel', () => {
    renderTip();
    const trigger = screen.getByRole('button', { name: 'על ימי העבודה' });
    fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    const panel = screen.getByText(TEXT);
    expect(trigger.getAttribute('aria-describedby')).toBe(panel.id);
  });

  it('closes on a second press', () => {
    renderTip();
    const trigger = screen.getByRole('button', { name: 'על ימי העבודה' });
    fireEvent.click(trigger);
    fireEvent.click(trigger);
    expect(screen.queryByText(TEXT)).toBeNull();
  });

  it('opens while a mouse rests on it, and closes a moment after it leaves', () => {
    vi.useFakeTimers();
    renderTip();
    const trigger = screen.getByRole('button', { name: 'על ימי העבודה' });
    fireEvent.pointerEnter(trigger, { pointerType: 'mouse' });
    expect(screen.getByText(TEXT)).toBeTruthy();
    fireEvent.pointerLeave(trigger, { pointerType: 'mouse' });
    expect(screen.getByText(TEXT)).toBeTruthy();
    act(() => { vi.advanceTimersByTime(500); });
    expect(screen.queryByText(TEXT)).toBeNull();
  });

  it('stays open while the mouse is on the panel itself', () => {
    vi.useFakeTimers();
    renderTip();
    const trigger = screen.getByRole('button', { name: 'על ימי העבודה' });
    fireEvent.pointerEnter(trigger, { pointerType: 'mouse' });
    fireEvent.pointerLeave(trigger, { pointerType: 'mouse' });
    fireEvent.pointerEnter(screen.getByText(TEXT), { pointerType: 'mouse' });
    act(() => { vi.advanceTimersByTime(500); });
    expect(screen.getByText(TEXT)).toBeTruthy();
  });

  it('does not count a finger as a hover', () => {
    renderTip();
    fireEvent.pointerEnter(screen.getByRole('button', { name: 'על ימי העבודה' }), { pointerType: 'touch' });
    expect(screen.queryByText(TEXT)).toBeNull();
  });

  it('a pinned panel survives the mouse leaving', () => {
    vi.useFakeTimers();
    renderTip();
    const trigger = screen.getByRole('button', { name: 'על ימי העבודה' });
    fireEvent.pointerEnter(trigger, { pointerType: 'mouse' });
    fireEvent.click(trigger);
    fireEvent.pointerLeave(trigger, { pointerType: 'mouse' });
    act(() => { vi.advanceTimersByTime(500); });
    expect(screen.getByText(TEXT)).toBeTruthy();
  });

  it('closes on a pointerdown outside it', () => {
    renderTip();
    fireEvent.click(screen.getByRole('button', { name: 'על ימי העבודה' }));
    fireEvent.pointerDown(screen.getByRole('button', { name: 'מחוץ להסבר' }));
    expect(screen.queryByText(TEXT)).toBeNull();
  });

  it('closes on esc, gives focus back, and does not let the key reach a drawer', () => {
    const onOuterKey = vi.fn();
    render(
      // Stands in for a Drawer's own esc listener.
      <div onKeyDown={onOuterKey}>
        <InfoTip id="t">{TEXT}</InfoTip>
      </div>,
    );
    const trigger = screen.getByRole('button', { name: 'הסבר' });
    fireEvent.click(trigger);
    fireEvent.keyDown(trigger, { key: 'Escape' });
    expect(screen.queryByText(TEXT)).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(onOuterKey).not.toHaveBeenCalled();
  });
});

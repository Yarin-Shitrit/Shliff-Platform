/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { unnamedControls } from '@/test/a11y';
import type { ViewInfo } from '../scene/scene-view';
import { shortcutFor, type Shortcut } from '../keyboard';
import { scaleFor, ViewControls } from './view-controls';
import { ShortcutsCard } from './shortcuts-card';

const STILL: ViewInfo = { yaw: 0, zoomPct: 150, pxPerM: 20, groundCorners: [], selectionBox: null, moving: false };

function renderControls(info: ViewInfo = STILL, keysOpen = false) {
  const calls = { onZoom: vi.fn(), onFit: vi.fn(), onRotate: vi.fn(), onNorth: vi.fn(), onKeys: vi.fn() };
  const { container } = render(<ViewControls info={info} keysOpen={keysOpen} {...calls} />);
  return { ...calls, container };
}

describe('the view controls', () => {
  it('zoom by one step either way, fit, turn the view, and bring north up', () => {
    const { onZoom, onFit, onRotate, onNorth, container } = renderControls();
    fireEvent.click(screen.getByRole('button', { name: 'התקרבות' }));
    expect(onZoom).toHaveBeenLastCalledWith(0.8);
    fireEvent.click(screen.getByRole('button', { name: 'התרחקות' }));
    expect(onZoom).toHaveBeenLastCalledWith(1.25);
    fireEvent.click(screen.getByRole('button', { name: 'התאמה למסך' }));
    expect(onFit).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'סיבוב המבט ימינה' }));
    expect(onRotate).toHaveBeenLastCalledWith(1);
    fireEvent.click(screen.getByRole('button', { name: 'סיבוב המבט שמאלה' }));
    expect(onRotate).toHaveBeenLastCalledWith(-1);
    fireEvent.click(screen.getByRole('button', { name: 'צפון למעלה' }));
    expect(onNorth).toHaveBeenCalled();
    expect(unnamedControls(container)).toEqual([]);
  });

  it('show the zoom, a scale bar that fits it, and a compass turned with the view', () => {
    renderControls({ ...STILL, yaw: 30 });
    const group = within(screen.getByRole('group', { name: 'מבט' }));
    expect(group.getByText('150%')).toBeTruthy();
    expect(group.getByText('2 מ׳')).toBeTruthy();
    const needle = screen.getByRole('button', { name: 'צפון למעלה' }).querySelector('svg');
    expect(needle?.style.transform).toBe('rotate(30deg)');
  });

  it('pick the shortest round length at least 36 px long for the scale bar, and none before the scene reports', () => {
    expect(scaleFor(20)).toEqual({ px: 40, text: '2 מ׳' });
    expect(scaleFor(100)).toEqual({ px: 50, text: '0.5 מ׳' });
    expect(scaleFor(0.5)).toEqual({ px: 25, text: '50 מ׳' });
    expect(scaleFor(0)).toBeNull();
  });

  it('open and close the shortcuts card, and say which it is', () => {
    const { onKeys } = renderControls(STILL, true);
    const keys = screen.getByRole('button', { name: 'קיצורי מקלדת' });
    expect(keys.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(keys);
    expect(onKeys).toHaveBeenCalled();
  });
});

type KeyEvent = { code: string; metaKey?: boolean; shiftKey?: boolean };

/**
 * Where the card prints each key `keyboard.ts` reads. A `Record` over its
 * `Shortcut` names, so a shortcut added there stops this file typechecking
 * until the card says which row it belongs to.
 */
const PRINTED: Record<Exclude<Shortcut, object>, { row: string; cap: string; event: KeyEvent }> = {
  toolSelect: { row: 'בחירה · מדידה', cap: 'V', event: { code: 'KeyV' } },
  toolMeasure: { row: 'בחירה · מדידה', cap: 'M', event: { code: 'KeyM' } },
  turn: { row: 'סיבוב ברבע · שכפול · נעילה', cap: 'R', event: { code: 'KeyR' } },
  duplicate: { row: 'סיבוב ברבע · שכפול · נעילה', cap: '⌘D', event: { code: 'KeyD', metaKey: true } },
  lock: { row: 'סיבוב ברבע · שכפול · נעילה', cap: 'L', event: { code: 'KeyL' } },
  remove: { row: 'הסרה', cap: '⌫', event: { code: 'Backspace' } },
  undo: { row: 'ביטול · ביצוע מחדש', cap: '⌘Z', event: { code: 'KeyZ', metaKey: true } },
  redo: { row: 'ביטול · ביצוע מחדש', cap: '⇧⌘Z', event: { code: 'KeyZ', metaKey: true, shiftKey: true } },
  selectAll: { row: 'בחירת הכול, בלי רשתות הצל', cap: '⌘A', event: { code: 'KeyA', metaKey: true } },
  escape: { row: 'ביטול הבחירה', cap: 'esc', event: { code: 'Escape' } },
  plan: { row: 'תוכנית · תלת־ממד · התאמה למסך', cap: '2', event: { code: 'Digit2' } },
  '3d': { row: 'תוכנית · תלת־ממד · התאמה למסך', cap: '3', event: { code: 'Digit3' } },
  fit: { row: 'תוכנית · תלת־ממד · התאמה למסך', cap: 'F', event: { code: 'KeyF' } },
  viewRight: { row: 'סיבוב המבט · התקרבות והתרחקות', cap: 'Q', event: { code: 'KeyQ' } },
  viewLeft: { row: 'סיבוב המבט · התקרבות והתרחקות', cap: 'E', event: { code: 'KeyE' } },
  zoomIn: { row: 'סיבוב המבט · התקרבות והתרחקות', cap: '+', event: { code: 'Equal', shiftKey: true } },
  zoomOut: { row: 'סיבוב המבט · התקרבות והתרחקות', cap: '−', event: { code: 'Minus' } },
  keys: { row: 'הכרטיס הזה', cap: '?', event: { code: 'Slash', shiftKey: true } },
};

function read(event: KeyEvent): Shortcut | null {
  return shortcutFor({ metaKey: false, ctrlKey: false, shiftKey: false, ...event });
}

describe('the shortcuts card', () => {
  function renderCard() {
    const onClose = vi.fn();
    render(<ShortcutsCard onClose={onClose} />);
    const dialog = screen.getByRole('dialog', { name: 'קיצורי מקלדת' });
    /** The keycaps printed beside the row that says `what`. */
    const capsOf = (what: string): string[] => {
      const term = within(dialog).getByText(what);
      const caps = term.nextElementSibling?.querySelectorAll('kbd') ?? [];
      return [...caps].map((cap) => cap.textContent ?? '');
    };
    return { onClose, dialog, card: within(dialog), capsOf };
  }

  it('lists the keys the editor reads, in Hebrew, and closes', () => {
    const { onClose, card } = renderCard();
    expect(card.getByText('סיבוב ברבע · שכפול · נעילה')).toBeTruthy();
    expect(card.getByText('המקשים נקראים לפי מיקומם במקלדת, כך שהם עובדים גם כשהמקלדת בעברית.')).toBeTruthy();
    fireEvent.click(card.getByRole('button', { name: 'סגירה' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('prints every key keyboard.ts reads, in the row that says what it does', () => {
    const { capsOf } = renderCard();
    for (const [shortcut, { row, cap, event }] of Object.entries(PRINTED)) {
      expect(read(event)).toBe(shortcut);
      expect(capsOf(row)).toContain(cap);
    }
    expect(read({ code: 'ArrowUp' })).toEqual({ arrow: 'ArrowUp', big: false });
    expect(read({ code: 'ArrowUp', shiftKey: true })).toEqual({ arrow: 'ArrowUp', big: true });
    expect(capsOf('הזזה בצעד רשת · בצעד של מטר')).toEqual(['←↑→↓', '⇧']);
  });

  it('draws each key as a glyph or a single letter, esc the one word', () => {
    const { dialog } = renderCard();
    const words = [...dialog.querySelectorAll('kbd')]
      .flatMap((cap) => (cap.textContent ?? '').match(/[A-Za-z]{2,}/g) ?? []);
    expect(words).toEqual(['esc']);
  });
});

import { describe, it, expect } from 'vitest';
import { shortcutFor } from './keyboard';

function key(code: string, mods: Partial<{ metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }> = {}) {
  return shortcutFor({ code, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...mods });
}

describe('the editor’s shortcuts', () => {
  it('are read from where the key is, not from the letter it types', () => {
    // A Hebrew layout types ר on KeyR and ל on KeyL; the code is the same.
    expect(key('KeyR')).toBe('turn');
    expect(key('KeyL')).toBe('lock');
    expect(key('KeyV')).toBe('toolSelect');
    expect(key('KeyM')).toBe('toolMeasure');
    expect(key('KeyF')).toBe('fit');
  });

  it('take ⌘ or Ctrl for undo, redo, duplicate and select all', () => {
    expect(key('KeyZ', { metaKey: true })).toBe('undo');
    expect(key('KeyZ', { ctrlKey: true })).toBe('undo');
    expect(key('KeyZ', { metaKey: true, shiftKey: true })).toBe('redo');
    expect(key('KeyY', { ctrlKey: true })).toBe('redo');
    expect(key('KeyD', { metaKey: true })).toBe('duplicate');
    expect(key('KeyA', { metaKey: true })).toBe('selectAll');
  });

  it('leave every other ⌘ combination to the browser', () => {
    expect(key('KeyR', { metaKey: true })).toBeNull(); // reload
    expect(key('KeyL', { metaKey: true })).toBeNull(); // the address bar
    expect(key('KeyF', { ctrlKey: true })).toBeNull(); // find
    expect(key('Equal', { metaKey: true })).toBeNull(); // page zoom
  });

  it('leave every Alt combination to the browser: Back, the menus, and AltGr’s letters', () => {
    expect(key('ArrowLeft', { altKey: true })).toBeNull(); // Back, on Windows
    expect(key('KeyF', { altKey: true })).toBeNull(); // the File menu
    expect(key('KeyE', { altKey: true })).toBeNull(); // the Edit menu
    expect(key('KeyR', { altKey: true, shiftKey: true })).toBeNull();
    expect(key('KeyZ', { altKey: true, ctrlKey: true })).toBeNull(); // AltGr is Ctrl + Alt
  });

  it('move by a grid step on an arrow, and by a metre with shift', () => {
    expect(key('ArrowUp')).toEqual({ arrow: 'ArrowUp', big: false });
    expect(key('ArrowLeft', { shiftKey: true })).toEqual({ arrow: 'ArrowLeft', big: true });
  });

  it('switch the view, turn it, zoom it, and open the card', () => {
    expect(key('Digit2')).toBe('plan');
    expect(key('Numpad3')).toBe('3d');
    expect(key('KeyQ')).toBe('viewRight');
    expect(key('KeyE')).toBe('viewLeft');
    expect(key('Equal')).toBe('zoomIn');
    expect(key('Equal', { shiftKey: true })).toBe('zoomIn');
    expect(key('NumpadSubtract')).toBe('zoomOut');
    expect(key('Slash', { shiftKey: true })).toBe('keys');
    expect(key('Escape')).toBe('escape');
    expect(key('Delete')).toBe('remove');
    expect(key('Backspace')).toBe('remove');
  });

  it('ignore everything else, including a code that is an Object property name', () => {
    for (const code of ['KeyX', 'Enter', 'Space', 'Tab', 'Digit1', 'constructor', '']) {
      expect(key(code)).toBeNull();
    }
  });
});

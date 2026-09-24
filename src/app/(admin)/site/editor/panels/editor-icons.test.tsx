/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { EditorIcon, type EditorIconName } from './editor-icons';

/** Every name the contract gives (overview, "Panels and page"). */
const NAMES: readonly EditorIconName[] = [
  'undo', 'redo', 'turn', 'lock', 'magnet', 'ruler', 'pointer', 'cube', 'plan', 'tag', 'eyeOff', 'minus', 'fit',
  'rotateLeft', 'rotateRight', 'help', 'alignWest', 'alignCentreX', 'alignEast', 'alignNorth', 'alignCentreY',
  'alignSouth', 'distributeX', 'distributeY', 'row',
];

function drawing(name: EditorIconName): string {
  const { container } = render(<EditorIcon name={name} />);
  const svg = container.querySelector('svg');
  if (svg === null) throw new Error(`no glyph for ${name}`);
  return svg.innerHTML;
}

describe('the editor’s glyphs', () => {
  it('draw every name as its own picture, so turning the view never looks like turning an item', () => {
    const seen = new Map<string, EditorIconName>();
    for (const name of NAMES) {
      const drawn = drawing(name);
      expect(drawn).not.toBe('');
      expect(seen.get(drawn), `${name} is drawn like ${seen.get(drawn)}`).toBeUndefined();
      seen.set(drawn, name);
    }
    expect(seen.size).toBe(25);
  });

  it('are decoration, named by the control they sit in', () => {
    const { container } = render(<EditorIcon name="turn" size={14} />);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('aria-hidden')).toBe('true');
    expect(svg?.getAttribute('width')).toBe('14');
  });
});

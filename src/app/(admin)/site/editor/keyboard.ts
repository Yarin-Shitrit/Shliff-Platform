/**
 * The editor's keyboard (spec §8), read from `KeyboardEvent.code` — where the
 * key is, not the letter it types — so `R` turns an item on a Hebrew layout,
 * where that key types ר. Pure: `SiteEditor` decides what each shortcut does.
 *
 * With ⌘ or Ctrl held, only the editor's five combinations are taken. Every
 * other one — ⌘R, ⌘L, ⌘F, ⌘+ — stays the browser's. With Alt held, nothing is
 * taken: Alt + ← is Back and Alt + a letter opens a menu on Windows, and AltGr
 * (Ctrl + Alt) types letters. No shortcut in spec §8 uses Alt; Alt + drag (and
 * Ctrl + drag, once an item is being dragged) is a pointer gesture
 * (`scene/gestures.ts`), not a key.
 */

export type Arrow = 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown';

export type Shortcut = 'undo' | 'redo' | 'duplicate' | 'selectAll' | 'group' | 'ungroup' | 'escape' | 'remove' | 'turn' | 'lock'
  | 'toolSelect' | 'toolMeasure' | 'fit' | 'plan' | '3d' | 'viewLeft' | 'viewRight' | 'zoomIn' | 'zoomOut' | 'keys'
  | { arrow: Arrow; big: boolean };

/**
 * One step closer, for + and for the view controls' zoom button: what
 * `SceneHandle.zoomBy` is given. A distance multiplier, like `camera.ts`
 * `zoomAt` — under 1 is closer — so a step away is `1 / ZOOM_IN` (checked
 * against `scene-view.tsx` in Task 21 Step 8).
 */
export const ZOOM_IN = 0.8;

const ARROWS: ReadonlySet<string> = new Set<string>(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']);

/** A Map rather than an object literal, so a code such as `constructor` finds nothing. */
const PLAIN = new Map<string, Shortcut>([
  ['Escape', 'escape'], ['Delete', 'remove'], ['Backspace', 'remove'],
  ['KeyR', 'turn'], ['KeyL', 'lock'], ['KeyV', 'toolSelect'], ['KeyM', 'toolMeasure'], ['KeyF', 'fit'],
  ['Digit2', 'plan'], ['Numpad2', 'plan'], ['Digit3', '3d'], ['Numpad3', '3d'],
  // The mock's pairing: Q turns the view to the right, E to the left.
  ['KeyQ', 'viewRight'], ['KeyE', 'viewLeft'],
  ['Equal', 'zoomIn'], ['NumpadAdd', 'zoomIn'], ['Minus', 'zoomOut'], ['NumpadSubtract', 'zoomOut'],
  ['Slash', 'keys'],
]);

export function shortcutFor(
  event: { code: string; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean },
): Shortcut | null {
  if (event.altKey) return null;
  if (event.metaKey || event.ctrlKey) {
    switch (event.code) {
      case 'KeyZ': return event.shiftKey ? 'redo' : 'undo';
      case 'KeyY': return 'redo';
      case 'KeyD': return 'duplicate';
      case 'KeyA': return 'selectAll';
      // ⌘G groups, ⇧⌘G ungroups — the pairing every drawing tool uses.
      case 'KeyG': return event.shiftKey ? 'ungroup' : 'group';
      default: return null;
    }
  }
  if (ARROWS.has(event.code)) return { arrow: event.code as Arrow, big: event.shiftKey };
  return PLAIN.get(event.code) ?? null;
}

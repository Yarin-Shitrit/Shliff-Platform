import type { SiteItemKind } from '@/db/schema/site';
import { overlap, type Rect } from '../geometry';
import { rectOf, type EditorDoc } from './model';

/**
 * Where a click in the library puts a new item (spec §8): the grid spot,
 * inside the fence and on nothing solid, whose middle is nearest `near` —
 * the middle of the view. A net is neither an obstacle nor obstructed,
 * because things go under it (the rule `overlapPairs` keeps). Ties go to the
 * spot found first, reading north to south and then west to east, so the
 * answer never depends on anything but the doc.
 *
 * Null when there is no such spot. The caller then says so; it never puts
 * the item somewhere it does not fit.
 */
export function nearestFreeSpot(
  doc: EditorDoc, kind: SiteItemKind, size: { widthCm: number; depthCm: number },
  near: { xCm: number; yCm: number },
): { xCm: number; yCm: number } | null {
  const stride = doc.plot.gridCm > 0 ? doc.plot.gridCm : 10;
  const obstacles: Rect[] = kind === 'shade' ? [] : doc.items.filter((entry) => entry.kind !== 'shade').map(rectOf);
  let best: { xCm: number; yCm: number; distance: number } | null = null;
  for (let y = 0; y + size.depthCm <= doc.plot.depthCm; y += stride) {
    for (let x = 0; x + size.widthCm <= doc.plot.widthCm; x += stride) {
      const distance = Math.hypot(x + size.widthCm / 2 - near.xCm, y + size.depthCm / 2 - near.yCm);
      if (best !== null && distance >= best.distance) continue;
      const spot: Rect = { x, y, width: size.widthCm, depth: size.depthCm };
      if (obstacles.some((obstacle) => overlap(obstacle, spot))) continue;
      best = { xCm: x, yCm: y, distance };
    }
  }
  return best === null ? null : { xCm: best.xCm, yCm: best.yCm };
}

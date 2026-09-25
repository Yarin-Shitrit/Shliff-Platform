import type { SiteItemKind } from '@/db/schema/site';
import { toPlaced } from '../derive';
import { contains, groundRect, inRopeBand, overlap, type Rect } from '../geometry';
import { rectOf, type EditorDoc, type EditorItem } from './model';

/** Where a new or copied item may land, or why not (spec §14). */
export type Landing = 'ok' | 'outside' | 'overlapping' | 'ropes';

/** What the rule needs of the item that lands: enough to place a net's ropes. */
export type Lander = Pick<EditorItem, 'kind' | 'heightCm' | 'ropeAngleDeg'>;

/**
 * The one landing rule (spec §14) for the library's click (`nearestFreeSpot`
 * below), its drag preview (the engine's ghost) and a copy (`duplicateOps`).
 * First the item's footprint inside the fence — a net's reaches its stakes,
 * at its own angle or the camp's. Then a net lands over anything, because
 * things stand under a net (the rule `overlapPairs` keeps); anything else
 * lands on nothing solid and outside every net's rope band. Built once per
 * doc, so a caller asking about a whole grid of spots places the nets once.
 */
export function landingRule(doc: EditorDoc): (entry: Lander, rect: Rect) => Landing {
  const solids = doc.items.filter((other) => other.kind !== 'shade').map(rectOf);
  const nets = doc.items.filter((other) => other.kind === 'shade').map((net) => toPlaced(net, doc.defaults));
  return (entry, rect) => {
    const landing = toPlaced({
      id: '', kind: entry.kind, xCm: rect.x, yCm: rect.y, widthCm: rect.width, depthCm: rect.depth,
      insetCm: null, heightCm: entry.heightCm, ropeAngleDeg: entry.ropeAngleDeg,
    }, doc.defaults);
    if (!contains(doc.plot, groundRect(landing))) return 'outside';
    if (entry.kind === 'shade') return 'ok';
    if (solids.some((solid) => overlap(solid, rect))) return 'overlapping';
    return nets.some((net) => inRopeBand(rect, net)) ? 'ropes' : 'ok';
  };
}

/**
 * Where a click in the library puts a new item (spec §8): the grid spot
 * whose middle is nearest `near` — the middle of the view — that the landing
 * rule calls 'ok'. Ties go to the spot found first, reading north to south
 * and then west to east, so the answer never depends on anything but the doc.
 *
 * Null when there is no such spot. The caller then says so; it never puts
 * the item somewhere it does not fit.
 */
export function nearestFreeSpot(
  doc: EditorDoc, kind: SiteItemKind, size: { widthCm: number; depthCm: number },
  near: { xCm: number; yCm: number },
): { xCm: number; yCm: number } | null {
  const stride = doc.plot.gridCm > 0 ? doc.plot.gridCm : 10;
  const lands = landingRule(doc);
  // A new item follows its kind's height and the camp's rope angle, as `addOps` makes it.
  const entry: Lander = { kind, heightCm: null, ropeAngleDeg: null };
  let best: { xCm: number; yCm: number; distance: number } | null = null;
  for (let y = 0; y + size.depthCm <= doc.plot.depthCm; y += stride) {
    for (let x = 0; x + size.widthCm <= doc.plot.widthCm; x += stride) {
      const distance = Math.hypot(x + size.widthCm / 2 - near.xCm, y + size.depthCm / 2 - near.yCm);
      if (best !== null && distance >= best.distance) continue;
      if (lands(entry, { x, y, width: size.widthCm, depth: size.depthCm }) !== 'ok') continue;
      best = { xCm: x, yCm: y, distance };
    }
  }
  return best === null ? null : { xCm: best.xCm, yCm: best.yCm };
}

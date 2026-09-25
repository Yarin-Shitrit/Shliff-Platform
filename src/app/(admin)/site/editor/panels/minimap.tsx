'use client';

/**
 * The whole map from above, bottom left (spec §10): the plot, every item in
 * its group's colour — an item past the fence outlined in the "bad" colour —
 * and the ground the view can see, outlined. A click or a drag here moves the
 * view there. SVG, so jsdom can test it; one unit is one centimetre and, like
 * the map, it never mirrors.
 */

import { useRef, type PointerEvent, type ReactElement } from 'react';
import { cx } from '@/components/ui/cx';
import { unionRect } from '@/lib/site/geometry';
import { SITE_KINDS } from '@/lib/site/kinds';
import { pathOf } from '@/lib/site/lines';
import { rectOf, type EditorDoc } from '@/lib/site/editor/model';
import type { EditorFlags } from '../use-editor-store';
import type { ViewInfo } from '../scene/scene-view';
import chrome from './panel.module.css';
import styles from './minimap.module.css';

export interface MinimapBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The ground the minimap shows: the plot, grown to take in anything past the
 * fence, with 6% of the longer side around it — an empty map and a map whose
 * every item is outside both frame something sensible (Review Focus #4).
 */
export function minimapBounds(doc: EditorDoc): MinimapBox {
  const plot = { x: 0, y: 0, width: doc.plot.widthCm, depth: doc.plot.depthCm };
  const all = unionRect([plot, ...doc.items.map(rectOf)]) ?? plot;
  const margin = Math.round(Math.max(all.width, all.depth) * 0.06);
  return { x: all.x - margin, y: all.y - margin, width: all.width + margin * 2, height: all.depth + margin * 2 };
}

/**
 * A point on the drawn minimap, in client pixels, to the ground under it —
 * `preserveAspectRatio="xMidYMid meet"`. None while the minimap has no size.
 */
export function minimapPoint(
  rect: { left: number; top: number; width: number; height: number },
  box: MinimapBox,
  clientX: number,
  clientY: number,
): [number, number] | null {
  if (rect.width <= 0 || rect.height <= 0) return null;
  const scale = Math.min(rect.width / box.width, rect.height / box.height);
  const offsetX = (rect.width - box.width * scale) / 2;
  const offsetY = (rect.height - box.height * scale) / 2;
  return [box.x + (clientX - rect.left - offsetX) / scale, box.y + (clientY - rect.top - offsetY) / scale];
}

export function Minimap({ doc, flags, selection, info, onJump }: {
  doc: EditorDoc;
  flags: EditorFlags;
  selection: readonly string[];
  info: ViewInfo;
  onJump: (xCm: number, yCm: number) => void;
}): ReactElement {
  const box = minimapBounds(doc);
  /* The pointer that started the drag. Another one — a second finger —
     neither moves the view nor ends the drag. */
  const dragging = useRef<number | null>(null);
  const selected = new Set(selection);
  const corners: ReadonlyArray<readonly [number, number]> = info.groundCorners;
  const seen = corners.length >= 3
    ? corners.map(([x, y]) => `${Math.round(x)},${Math.round(y)}`).join(' ')
    : null;

  function jump(event: PointerEvent<SVGSVGElement>): void {
    const point = minimapPoint(event.currentTarget.getBoundingClientRect(), box, event.clientX, event.clientY);
    if (point !== null) onJump(Math.round(point[0]), Math.round(point[1]));
  }

  function release(event: PointerEvent<SVGSVGElement>): void {
    if (event.pointerId === dragging.current) dragging.current = null;
  }

  return (
    <div className={styles.minimap} data-panel="true">
      <svg
        className={styles.minimapSvg}
        viewBox={`${box.x} ${box.y} ${box.width} ${box.height}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label="מפה מוקטנת. לחיצה או גרירה כאן מזיזות את המבט."
        onPointerDown={(event) => {
          // The same pointer pressing again takes its drag back: its release was lost.
          if (event.button !== 0 || (dragging.current !== null && dragging.current !== event.pointerId)) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          dragging.current = event.pointerId;
          jump(event);
        }}
        onPointerMove={(event) => { if (event.pointerId === dragging.current) jump(event); }}
        onPointerUp={release}
        onPointerCancel={release}
        onLostPointerCapture={release}
      >
        <rect className={styles.mmPlot} x={0} y={0} width={doc.plot.widthCm} height={doc.plot.depthCm} />
        {doc.items.map((item) => (
          <rect
            key={item.id}
            data-id={item.id}
            data-outside={flags.outside.has(item.id) || undefined}
            data-selected={selected.has(item.id) || undefined}
            className={cx(styles.mmItem, chrome[`g_${SITE_KINDS[item.kind].group}`], item.kind === 'shade' && styles.mmNet)}
            x={item.xCm}
            y={item.yCm}
            width={item.widthCm}
            height={item.depthCm}
          />
        ))}
        {/* The pipes and cables, over the items they run between, in their kind's colour. */}
        {doc.lines.map((line) => {
          const path = pathOf(doc, line);
          if (path === null) return null;
          return (
            <polyline
              key={line.id}
              data-id={line.id}
              data-selected={selected.has(line.id) || undefined}
              className={cx(styles.mmLine, chrome[`l_${line.kind}`])}
              points={path.map(([x, y]) => `${x},${y}`).join(' ')}
            />
          );
        })}
        {seen === null ? null : <polygon className={styles.mmView} points={seen} />}
      </svg>
    </div>
  );
}

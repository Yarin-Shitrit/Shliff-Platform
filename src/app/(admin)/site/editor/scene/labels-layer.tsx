'use client';

import { forwardRef, useImperativeHandle, useRef } from 'react';
import type { PlacedLabel } from '@/lib/site/editor/label-layout';
import styles from './scene.module.css';

export interface LabelsLayerHandle {
  update(placed: readonly PlacedLabel[], selection: ReadonlySet<string>): void;
}

/** The point of a rectangle nearest to `p` — where a leader line meets its label. */
function nearest(p: [number, number], rect: PlacedLabel['rect']): [number, number] {
  return [Math.min(Math.max(p[0], rect.l), rect.r), Math.min(Math.max(p[1], rect.t), rect.b)];
}

/**
 * The item labels over the scene (spec §9). It decides nothing: the engine
 * lays the labels out (`label-layout.ts`) and hands this layer the placed
 * rectangles, and the layer moves one DOM node per label into place with a
 * transform — no React render per frame. A node is kept per label key, so a
 * label that stays on screen is moved, not recreated.
 *
 * Hidden from assistive technology: the objects list is the map's
 * screen-reader route (spec §10), and the same names here would be noise.
 */
export const LabelsLayer = forwardRef<LabelsLayerHandle>(function LabelsLayer(_props, ref) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const leadersRef = useRef<SVGSVGElement | null>(null);
  const nodesRef = useRef(new Map<string, HTMLDivElement>());

  useImperativeHandle(ref, () => ({
    update(placed, selection) {
      const root = rootRef.current;
      const leaders = leadersRef.current;
      if (root === null || leaders === null) return;
      const nodes = nodesRef.current;
      const kept = new Set<string>();
      const lines: SVGLineElement[] = [];

      for (const label of placed) {
        kept.add(label.key);
        let node = nodes.get(label.key);
        if (node === undefined) {
          node = document.createElement('div');
          node.className = styles.label;
          node.dataset.key = label.key;
          root.appendChild(node);
          nodes.set(label.key, node);
        }
        if (node.textContent !== label.text) node.textContent = label.text;
        const selected = label.ids.some((id) => selection.has(id));
        node.dataset.selected = String(selected);
        node.dataset.group = String(label.group);
        node.dataset.tier = label.tier;
        node.dataset.issue = String(label.issue);
        node.style.width = `${Math.round(label.rect.r - label.rect.l)}px`;
        node.style.height = `${Math.round(label.rect.b - label.rect.t)}px`;
        node.style.transform = `translate(${Math.round(label.rect.l)}px, ${Math.round(label.rect.t)}px)`;

        if (label.leader) {
          const [x2, y2] = nearest(label.anchor, label.rect);
          const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
          line.setAttribute('class', selected ? `${styles.leader} ${styles.leaderSelected}` : styles.leader);
          line.setAttribute('x1', String(label.anchor[0]));
          line.setAttribute('y1', String(label.anchor[1]));
          line.setAttribute('x2', String(x2));
          line.setAttribute('y2', String(y2));
          lines.push(line);
        }
      }

      for (const [key, node] of nodes) {
        if (kept.has(key)) continue;
        node.remove();
        nodes.delete(key);
      }
      leaders.replaceChildren(...lines);
    },
  }), []);

  return (
    <div className={styles.labels} ref={rootRef} aria-hidden="true">
      <svg className={styles.leaders} ref={leadersRef} />
    </div>
  );
});

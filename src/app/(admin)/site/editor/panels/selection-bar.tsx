'use client';

/**
 * Turn, duplicate, lock and remove, floating over the selection (spec §10).
 * Hidden while the view or a drag moves: SiteEditor passes no box then, and
 * the scene's `ViewInfo.selectionBox` is null meanwhile too.
 *
 * `box` is in the scene's own screen pixels, which are the stage's, so the
 * bar is placed with physical `left`/`top`: a point on the map does not
 * mirror, and neither does the bar that sits on it.
 */

import type { ReactElement } from 'react';
import type { ScreenBox } from '@/lib/site/editor/camera';
import { SelectionActions } from './selection-actions';
import styles from './selection-bar.module.css';

/**
 * The most room the bar takes: four 44 px targets on a coarse pointer (A8),
 * their gaps and padding (`selection-bar.module.css`). The room it is given
 * is worked out for that, so it fits on any pointer.
 */
export const BAR = { width: 188, height: 50 } as const;
/** From the selection's edge to the bar, and the least from the stage's edge to it. */
const GAP = 10;
const EDGE = 8;

export interface BarPlace {
  /** The bar's middle, in the stage's pixels. */
  left: number;
  /** The bar's bottom edge when `above`, its top edge when `below`. */
  top: number;
  place: 'above' | 'below';
}

/**
 * Above the middle of the selection when the bar fits between it and the
 * stage's top; under it otherwise. Never past a side of the stage, nor its
 * bottom (review minor, H1 6). Until the stage has been measured (`null`),
 * by the selection alone.
 */
export function placeBar(box: ScreenBox, stage: { width: number; height: number } | null): BarPlace {
  const middle = (box.l + box.r) / 2;
  const above = box.t - GAP - BAR.height >= EDGE;
  if (stage === null) {
    return { left: middle, top: above ? box.t - GAP : box.b + GAP, place: above ? 'above' : 'below' };
  }
  const half = BAR.width / 2;
  const left = stage.width < BAR.width + 2 * EDGE
    ? stage.width / 2
    : Math.min(Math.max(middle, EDGE + half), stage.width - EDGE - half);
  if (above) return { left, top: box.t - GAP, place: 'above' };
  const top = Math.max(EDGE, Math.min(box.b + GAP, stage.height - EDGE - BAR.height));
  return { left, top, place: 'below' };
}

export function SelectionBar({ box, stage = null, locked, onTurn, onDuplicate, onLock, onRemove }: {
  box: ScreenBox | null;
  /** The stage's size, to keep the bar on it; null until measured. */
  stage?: { width: number; height: number } | null;
  /** Every selected item is locked. */
  locked: boolean;
  onTurn: () => void;
  onDuplicate: () => void;
  onLock: () => void;
  onRemove: () => void;
}): ReactElement | null {
  if (box === null) return null;
  const at = placeBar(box, stage);
  return (
    <div
      className={styles.selBar}
      role="group"
      aria-label="פעולות על הבחירה"
      data-panel="true"
      data-place={at.place}
      style={{ left: at.left, top: at.top }}
    >
      <SelectionActions
        labelled={false}
        locked={locked}
        onTurn={onTurn}
        onDuplicate={onDuplicate}
        onLock={onLock}
        onRemove={onRemove}
      />
    </div>
  );
}

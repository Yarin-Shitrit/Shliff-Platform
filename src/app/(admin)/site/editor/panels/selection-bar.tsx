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

export function SelectionBar({ box, locked, onTurn, onDuplicate, onLock, onRemove }: {
  box: ScreenBox | null;
  /** Every selected item is locked. */
  locked: boolean;
  onTurn: () => void;
  onDuplicate: () => void;
  onLock: () => void;
  onRemove: () => void;
}): ReactElement | null {
  if (box === null) return null;
  return (
    <div
      className={styles.selBar}
      role="group"
      aria-label="פעולות על הבחירה"
      data-panel="true"
      style={{ left: (box.l + box.r) / 2, top: Math.max(8, box.t - 10) }}
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

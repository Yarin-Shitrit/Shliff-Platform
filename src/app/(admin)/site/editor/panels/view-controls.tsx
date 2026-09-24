'use client';

/**
 * The view's controls, bottom centre (spec §10): zoom out and in with the
 * zoom level between, fit, turn the view either way around a compass that
 * brings north back to the top, a scale bar, and the shortcuts card.
 *
 * Nothing here mirrors: the turn arrows are the editor's own glyphs, and the
 * needle is turned only by where true north is on screen — the view's yaw
 * less the plot's `northDeg` — never by the page's direction.
 */

import type { ReactElement } from 'react';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import type { ViewInfo } from '../scene/scene-view';
import { ZOOM_IN } from '../keyboard';
import { EditorIcon } from './editor-icons';
import styles from './view-controls.module.css';

/**
 * The lengths the scale bar may stand for, and the shortest it may be drawn.
 * 10 cm is the first step because the closest zoom the camera allows
 * (`DISTANCE_MIN`) puts 400–750 px in a metre on an ordinary screen.
 */
const SCALE_STEPS_M = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50];
const SCALE_MIN_PX = 36;

/** The shortest round length at least 36 px long at this zoom; none before the scene has reported one. */
export function scaleFor(pxPerM: number): { px: number; text: string } | null {
  if (!Number.isFinite(pxPerM) || pxPerM <= 0) return null;
  const length = SCALE_STEPS_M.find((step) => step * pxPerM >= SCALE_MIN_PX) ?? SCALE_STEPS_M[SCALE_STEPS_M.length - 1];
  return { px: Math.round(length * pxPerM), text: `${length} מ׳` };
}

export function ViewControls({ info, northDeg, keysOpen, onZoom, onFit, onRotate, onNorth, onKeys }: {
  info: ViewInfo;
  /** The plot's `northDeg`: the compass bearing its up edge faces. */
  northDeg: number;
  keysOpen: boolean;
  onZoom: (factor: number) => void;
  onFit: () => void;
  onRotate: (dir: 1 | -1) => void;
  onNorth: () => void;
  onKeys: () => void;
}): ReactElement {
  const scale = scaleFor(info.pxPerM);
  return (
    <div className={styles.view} role="group" aria-label="מבט" data-panel="true">
      <Button tone="ghost" size="sm" iconLabel="התרחקות" onClick={() => { onZoom(1 / ZOOM_IN); }}>
        <EditorIcon name="minus" />
      </Button>
      <span className={styles.zoomValue}><bdi>{`${info.zoomPct}%`}</bdi></span>
      <Button tone="ghost" size="sm" iconLabel="התקרבות" onClick={() => { onZoom(ZOOM_IN); }}>
        <Icon name="plus" size={16} />
      </Button>
      <Button tone="ghost" size="sm" iconLabel="התאמה למסך" onClick={onFit}>
        <EditorIcon name="fit" />
      </Button>
      <span className={styles.vsep} aria-hidden="true" />
      <Button tone="ghost" size="sm" iconLabel="סיבוב המבט ימינה" onClick={() => { onRotate(1); }}>
        <EditorIcon name="rotateRight" />
      </Button>
      {/* The needle points where true north is on screen. The picture is turned `yaw` clockwise
          (`camera.ts`) and the map's up edge faces bearing `northDeg`, so north sits
          yaw − northDeg clockwise of the top; `northUp()` sets yaw = northDeg, standing it upright. */}
      <Button tone="ghost" size="sm" iconLabel="צפון למעלה" onClick={onNorth}>
        <svg width={18} height={18} viewBox="0 0 24 24" aria-hidden="true" style={{ transform: `rotate(${info.yaw - northDeg}deg)` }}>
          <circle className={styles.compassRing} cx={12} cy={12} r={10} />
          <path className={styles.compassNorth} d="M12 3.5 15 12 12 10.8 9 12Z" />
          <path className={styles.compassSouth} d="M12 20.5 9 12 12 13.2 15 12Z" />
        </svg>
      </Button>
      <Button tone="ghost" size="sm" iconLabel="סיבוב המבט שמאלה" onClick={() => { onRotate(-1); }}>
        <EditorIcon name="rotateLeft" />
      </Button>
      {scale === null ? null : (
        <>
          <span className={styles.vsep} aria-hidden="true" />
          <span className={styles.scaleBar}>
            <span className={styles.scaleLine} style={{ inlineSize: `${scale.px}px` }} aria-hidden="true" />
            <bdi>{scale.text}</bdi>
          </span>
        </>
      )}
      <span className={styles.vsep} aria-hidden="true" />
      <button type="button" className={styles.iconButton} aria-label="קיצורי מקלדת" aria-pressed={keysOpen} onClick={onKeys}>
        <EditorIcon name="help" />
      </button>
    </div>
  );
}

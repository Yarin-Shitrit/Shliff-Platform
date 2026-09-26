'use client';

import { forwardRef, useCallback, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import type { SiteItemKind } from '@/db/schema/site';
import type { ScreenBox, ViewMode } from '@/lib/site/editor/camera';
import type { SiteKindGroup } from '@/lib/site/kinds';
import type { ImagePoint } from '@/lib/site/underlay';
import type { EditorStore } from '../use-editor-store';
import { NoWebGLError, SceneEngine } from './engine';
import { LabelsLayer, type LabelsLayerHandle } from './labels-layer';
import type { SceneTheme } from './palette';
import type { UnderlayEvent } from './underlay-mesh';
import styles from './scene.module.css';

/**
 * How the items are named on the map: floating labels laid out in the DOM
 * so they never overlap (spec §9), none, or the item's own name printed on
 * its roof, lid, cloth or wall as part of the scene — lit and shadowed with
 * it, and therefore in the exported picture (plan 2026-09-26-site-label-modes).
 */
export type LabelMode = 'floating' | 'none' | 'printed';

export interface EditorUi {
  /** 'calibrate' and 'align' are the picture's two tools (spec §18), entered from its card. */
  tool: 'select' | 'measure' | 'calibrate' | 'align';
  mode: ViewMode;
  labels: LabelMode;
  sun: boolean;
  netsHidden: boolean;
  snap: boolean;
  hiddenGroups: SiteKindGroup[];
  hour: number;
  theme: SceneTheme;
  /** How this viewer sees the picture under the map — never saved (D19). Shown, at 50%, whenever the map has one. */
  underlay: { shown: boolean; opacity: number };
}

export interface ViewInfo {
  yaw: number;
  zoomPct: number;
  pxPerM: number;
  groundCorners: Array<[number, number]>;
  /** Null while the view or a drag is moving (the selection bar hides meanwhile). */
  selectionBox: ScreenBox | null;
  moving: boolean;
}

/** How much of the scene the floating panels cover; fit and labels keep out from under them. */
export interface Insets { left: number; right: number; top: number; bottom: number }

export interface SceneHandle {
  fitAll(): void;
  fitIds(ids: readonly string[]): void;
  zoomBy(factor: number): void;
  rotateView(dir: 1 | -1): void;
  northUp(): void;
  centreGround(): [number, number] | null;
  groundAtClient(clientX: number, clientY: number): [number, number] | null;
  setGhost(ghost: { kind: SiteItemKind; xCm: number; yCm: number } | null): void;
  jumpTo(xCm: number, yCm: number): void;
  /** The current view as a PNG, without the labels (they are DOM); null when none can be made. */
  exportPng(): Promise<Blob | null>;
  /** The picture's card's "ניסיון נוסף": load the picture again after it failed. */
  retryUnderlay(): void;
}

export interface SceneViewProps {
  store: EditorStore;
  ui: EditorUi;
  insets: Insets;
  /** The season's gate date, 'YYYY-MM-DD'; the sun is modelled only when there is one. */
  sunDate: string | null;
  onView: (info: ViewInfo) => void;
  onNotice: (message: string) => void;
  onModeSettled?: (mode: ViewMode) => void;
  /** Calibration marks to draw, as points on the picture: those marked so far, or the saved pair while its card is open. */
  underlayMarks?: ReadonlyArray<ImagePoint>;
  /** What the picture layer and its tools report: whether the picture is loading, shown or failed, and each click while calibrating. */
  onUnderlay?: (event: UnderlayEvent) => void;
}

/** What a browser without WebGL shows where the map would be (spec §7). */
export const NO_WEBGL = 'המפה צריכה דפדפן עם גרפיקה תלת־ממדית פעילה.';

/** What shows there when the graphics were fine and something else stopped the map from starting. */
export const SCENE_FAILED = 'המפה לא נטענה. רענון הדף ינסה שוב.';

const ENGINE_CLASSES = {
  canvas: styles.canvas,
  overlay: styles.overlay,
  handle: styles.handle,
  guide: styles.guide,
  gap: styles.gap,
  measure: styles.measure,
  marquee: styles.marquee,
  dot: styles.dot,
  member: styles.member,
  pills: styles.pills,
  pill: styles.pill,
  pillGuide: styles.pillGuide,
  pillFocus: styles.pillFocus,
  pillBad: styles.pillBad,
};

/**
 * The 3D map (spec §4, §7). The only component that reaches `three`, through
 * `engine.ts`; loaded with `next/dynamic` and `ssr: false`, so no other page
 * carries the library and the server never tries to draw.
 *
 * React renders three nodes and then stays out of the way: the engine is
 * created on the stage node, reads the latest props on every render through
 * a ref, and draws frames itself. A browser that cannot give WebGL makes the
 * engine throw; the component then says so, in Hebrew, instead of the map.
 * Any other failure while the engine starts says the map did not load — it
 * is not the browser's fault, and "no 3D graphics" would send the lead the
 * wrong way.
 */
export const SceneView = forwardRef<SceneHandle, SceneViewProps>(function SceneView(props, ref) {
  const propsRef = useRef(props);
  const engineRef = useRef<SceneEngine | null>(null);
  const labelsRef = useRef<LabelsLayerHandle | null>(null);
  const [failed, setFailed] = useState<'no-webgl' | 'broken' | null>(null);

  useLayoutEffect(() => {
    propsRef.current = props;
    engineRef.current?.update();
  });

  /* The engine lives exactly as long as the stage node: created when React
     attaches it, disposed by the cleanup React 19 runs when it detaches. */
  const attachStage = useCallback((stage: HTMLDivElement | null) => {
    if (stage === null) return undefined;
    let engine: SceneEngine;
    try {
      engine = new SceneEngine(stage, {
        props: () => propsRef.current,
        labels: () => labelsRef.current,
        classes: ENGINE_CLASSES,
      });
    } catch (error) {
      setFailed(error instanceof NoWebGLError ? 'no-webgl' : 'broken');
      return undefined;
    }
    engineRef.current = engine;
    return () => {
      engine.dispose();
      if (engineRef.current === engine) engineRef.current = null;
    };
  }, []);

  useImperativeHandle(ref, () => ({
    fitAll: () => engineRef.current?.fitAll(),
    fitIds: (ids) => engineRef.current?.fitIds(ids),
    zoomBy: (factor) => engineRef.current?.zoomBy(factor),
    rotateView: (dir) => engineRef.current?.rotateView(dir),
    northUp: () => engineRef.current?.northUp(),
    centreGround: () => engineRef.current?.centreGround() ?? null,
    groundAtClient: (clientX, clientY) => engineRef.current?.groundAtClient(clientX, clientY) ?? null,
    setGhost: (ghost) => engineRef.current?.setGhost(ghost),
    jumpTo: (xCm, yCm) => engineRef.current?.jumpTo(xCm, yCm),
    exportPng: () => engineRef.current?.exportPng() ?? Promise.resolve(null),
    retryUnderlay: () => engineRef.current?.retryUnderlay(),
  }), []);

  if (failed !== null) {
    return (
      <div className={styles.scene}>
        <p className={styles.fallback} role="status">{failed === 'no-webgl' ? NO_WEBGL : SCENE_FAILED}</p>
      </div>
    );
  }
  return (
    <div className={styles.scene}>
      <div className={styles.stage} ref={attachStage} />
      <LabelsLayer ref={labelsRef} />
    </div>
  );
});

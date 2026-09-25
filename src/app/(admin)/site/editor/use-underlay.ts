import { useEffect, useRef, useState } from 'react';
import { screenArrowToMap } from '@/lib/site/editor/camera';
import { NOT_A_LENGTH, SIDE_RANGE, readMetres } from '@/lib/site/editor/metres';
import { underlayOf, type EditorDoc } from '@/lib/site/editor/model';
import type { SiteOp } from '@/lib/site/editor/ops';
import { calibrateOps, placeOps, removeUnderlayOps, uploadOps } from '@/lib/site/editor/underlay-commands';
import { moveBy, quarterTurn, type ImagePoint } from '@/lib/site/underlay';
import type { Arrow } from './keyboard';
import type { CalibrationDraft } from './panels/underlay-card';
import type { EditorUi } from './scene/scene-view';
import type { UnderlayEvent, UnderlayStatus } from './scene/underlay-mesh';
import { uploadUnderlay, type UploadOutcome } from './underlay-upload';

/**
 * The picture under the map, as the editor runs it (spec §16–19): its card,
 * its two tools and the keys they take. It sits beside `SiteEditor` so the
 * editor, which other lanes edit too, changes by a few lines.
 *
 * - Every change of where the picture lies goes through `runEdit`, the
 *   editor's one door. So it is one undo step, saved in the batch against the
 *   map's version, and it takes an older undo toast away (P6).
 * - How this viewer sees it — shown or hidden, how see-through — only ever
 *   changes `EditorUi.underlay`, which is never saved (D19).
 * - Calibrating switches the view to plan, and back afterwards (spec §18.3).
 * - The two tools end with the picture: however it goes — an undo of its
 *   upload, a redo of its removal, another lead's removal reloaded — no tool
 *   stays on over nothing (review U1).
 */

/** What the editor says about the picture (spec §20). */
export const OFF_IMAGE = 'הנקודה מחוץ לתמונה.';
export const TOO_CLOSE = 'שתי הנקודות קרובות מדי זו לזו. מרחק ארוך, כמו צלע של הגדר, נותן כיול מדויק יותר.';
/**
 * A typed distance that would make the picture narrower than 10 cm or wider
 * than 500 m. Spec §20 has no sentence for it; without one, the server would
 * refuse the whole batch instead ("מיקום תמונת הרקע…"), which is the wrong
 * reason, and the refused batch would halt every edit queued with it.
 */
export const SCALE_OUT_OF_RANGE = 'בקנה המידה הזה התמונה הייתה מכסה פחות מ־10 ס״מ או יותר מ־500 מטר. כדאי לבדוק את המרחק שהוקלד.';
export const REMOVED = 'תמונת הרקע הוסרה מהמפה. הקובץ עצמו נשמר, כדי שאפשר יהיה לבטל.';
export const REPLACED = 'תמונת הרקע הוחלפה';

const NO_DRAFT: CalibrationDraft = { points: [], refusal: null };
/** An arrow moves the picture 10 cm, or a metre with Shift (spec §18.4). */
const NUDGE_CM = 10;
const BIG_NUDGE_CM = 100;

export interface UnderlayDeps {
  doc: EditorDoc;
  ui: EditorUi;
  /** The view's turn, so an arrow moves the picture the way it points on screen, as it moves items. */
  yaw: number;
  patchUi: (patch: Partial<EditorUi>) => void;
  /** `SiteEditor`'s one door for edits. */
  runEdit: (label: string, ops: SiteOp[]) => void;
  saidWithUndo: (message: string) => void;
  select: (ids: string[]) => void;
  /** `SceneHandle.retryUnderlay`. */
  retry: () => void;
  /** The browser's `uploadUnderlay` unless a test hands in another. */
  upload?: (file: File, planId: string) => Promise<UploadOutcome>;
}

export interface UnderlayController {
  open: boolean;
  status: UnderlayStatus;
  sending: boolean;
  uploadError: string | null;
  draft: CalibrationDraft;
  /** For the scene to draw: the points marked so far while calibrating, or the saved pair while the card is open. */
  marks: ImagePoint[];
  setOpen: (open: boolean) => void;
  close: () => void;
  onSceneEvent: (event: UnderlayEvent) => void;
  sendFile: (file: File) => void;
  startCalibration: () => void;
  applyCalibration: (distanceText: string, parallel: boolean) => void;
  cancelCalibration: () => void;
  startAlign: () => void;
  finishAlign: () => void;
  turn: (direction: 1 | -1) => void;
  nudge: (arrow: Arrow, big: boolean) => void;
  setOpacity: (opacity: number) => void;
  toggleShown: () => void;
  remove: () => void;
  retry: () => void;
  /** Esc: ends calibrating or aligning. True when it did. */
  escape: () => boolean;
  /**
   * Ends calibrating or aligning for another tool — the tool row's select or
   * measure, or their keys — with the view calibrating switched away from,
   * and no marks left behind (review U1).
   */
  leaveTool: (next?: 'select' | 'measure') => void;
}

export function useUnderlay(deps: UnderlayDeps): UnderlayController {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<UnderlayStatus>({ state: 'none' });
  const [sending, setSending] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [draft, setDraft] = useState<CalibrationDraft>(NO_DRAFT);
  /** The view before calibration switched to plan. State, not a ref: the picture's going reads it while rendering. */
  const [modeBefore, setModeBefore] = useState<EditorUi['mode'] | null>(null);
  /** The latest deps, for an upload that finishes after the lead has done other things meanwhile. */
  const latest = useRef(deps);
  useEffect(() => { latest.current = deps; });

  const underlay = underlayOf(deps.doc);
  const aspect = status.state === 'ready' ? status.aspect : null;
  const { tool } = deps.ui;
  const marks: ImagePoint[] = tool === 'calibrate'
    ? draft.points
    : open && underlay !== null && underlay.calibration !== null
      ? [underlay.calibration.from, underlay.calibration.to]
      : [];

  function beginCalibration(from: UnderlayDeps): void {
    if (from.ui.tool !== 'calibrate') setModeBefore(from.ui.mode);
    from.select([]);
    from.patchUi({ tool: 'calibrate', mode: 'plan', underlay: { ...from.ui.underlay, shown: true } });
    setDraft(NO_DRAFT);
    setOpen(true);
  }

  function leaveTool(next: 'select' | 'measure' = 'select'): void {
    setModeBefore(null);
    deps.patchUi(modeBefore === null ? { tool: next } : { tool: next, mode: modeBefore });
    setDraft(NO_DRAFT);
  }

  /* The picture went while one of its tools was on (review U1). Adjusted
     while rendering, as React has state follow a change of props: whatever
     took the picture away, the next render is already out of the tool. */
  if (underlay === null && (tool === 'calibrate' || tool === 'align')) leaveTool();

  function edit(label: string, ops: SiteOp[]): void {
    if (ops.length > 0) deps.runEdit(label, ops);
  }

  async function send(file: File): Promise<void> {
    setUploadError(null);
    setSending(true);
    let outcome: UploadOutcome;
    try {
      outcome = await (deps.upload ?? uploadUnderlay)(file, deps.doc.plot.id);
    } finally {
      setSending(false);
    }
    if (!outcome.ok) {
      setUploadError(outcome.error);
      return;
    }
    const now = latest.current;
    const replacing = underlayOf(now.doc) !== null;
    const ops = uploadOps(now.doc, outcome.file);
    if (ops.length === 0) return; // the same picture again: nothing changes
    now.runEdit(replacing ? 'החלפת תמונת הרקע' : 'העלאת תמונת רקע', ops);
    if (replacing) {
      now.patchUi({ underlay: { ...now.ui.underlay, shown: true } });
      now.saidWithUndo(REPLACED);
    } else {
      beginCalibration(now); // a new picture goes straight on to calibration (§18.2)
    }
  }

  function applyCalibration(distanceText: string, parallel: boolean): void {
    const reading = readMetres(distanceText, SIDE_RANGE);
    if (!reading.ok) {
      setDraft({ ...draft, refusal: reading.error });
      return;
    }
    if (reading.cm === null) {
      setDraft({ ...draft, refusal: NOT_A_LENGTH });
      return;
    }
    if (aspect === null || draft.points.length < 2) return;
    const ops = calibrateOps(deps.doc, aspect, draft.points[0], draft.points[1], reading.cm, parallel);
    if (ops === null) {
      setDraft({ ...draft, refusal: SCALE_OUT_OF_RANGE });
      return;
    }
    edit('כיול תמונת הרקע', ops);
    leaveTool();
  }

  function startAlign(): void {
    if (underlay === null) return;
    if (tool === 'calibrate') leaveTool();
    deps.select([]);
    deps.patchUi({ tool: 'align', underlay: { ...deps.ui.underlay, shown: true } });
    setOpen(true);
  }

  function finishAlign(): void {
    leaveTool();
  }

  function escape(): boolean {
    if (tool !== 'calibrate' && tool !== 'align') return false;
    leaveTool();
    return true;
  }

  function remove(): void {
    const ops = removeUnderlayOps(deps.doc);
    if (ops.length === 0) return;
    escape();
    deps.runEdit('הסרת תמונת הרקע', ops);
    deps.saidWithUndo(REMOVED);
  }

  function onSceneEvent(event: UnderlayEvent): void {
    switch (event.type) {
      case 'status':
        setStatus(event.status);
        break;
      case 'point':
        setDraft((current) => (current.points.length >= 2 ? current : { points: [...current.points, event.uv], refusal: null }));
        break;
      case 'offImage':
        setDraft((current) => ({ ...current, refusal: OFF_IMAGE }));
        break;
      case 'tooClose':
        setDraft((current) => ({ ...current, refusal: TOO_CLOSE }));
        break;
    }
  }

  return {
    open,
    status,
    sending,
    uploadError,
    draft,
    marks,
    setOpen,
    close: () => {
      escape();
      setOpen(false);
    },
    onSceneEvent,
    sendFile: (file) => { void send(file); },
    startCalibration: () => {
      if (underlay !== null) beginCalibration(deps);
    },
    applyCalibration,
    cancelCalibration: leaveTool,
    startAlign,
    finishAlign,
    turn: (direction) => {
      if (underlay !== null) edit('סיבוב תמונת הרקע', placeOps(deps.doc, quarterTurn(underlay, direction)));
    },
    nudge: (arrow, big) => {
      if (underlay === null) return;
      const [ux, uy] = screenArrowToMap(deps.yaw, arrow);
      const step = big ? BIG_NUDGE_CM : NUDGE_CM;
      edit('הזזת תמונת הרקע', placeOps(deps.doc, moveBy(underlay, ux * step, uy * step)));
    },
    setOpacity: (opacity) => { deps.patchUi({ underlay: { ...deps.ui.underlay, opacity } }); },
    toggleShown: () => { deps.patchUi({ underlay: { ...deps.ui.underlay, shown: !deps.ui.underlay.shown } }); },
    remove,
    retry: () => { deps.retry(); },
    escape,
    leaveTool,
  };
}

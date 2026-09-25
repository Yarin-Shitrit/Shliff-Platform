'use client';

/**
 * תמונת רקע (spec §18, §20): the card for the picture under the map. It
 * shows one of these, in this order:
 * - an upload under way;
 * - an invitation, with no picture;
 * - the calibration steps, while calibrating;
 * - the alignment tool, while aligning;
 * - otherwise the picture: its file, whether it shows, its scale (temporary
 *   until calibrated), what it covers, how see-through it is for this viewer,
 *   and the ways to move, replace or remove it.
 *
 * Every figure that is a scale opens the calibration, because a figure links
 * to what changes it. A file can be dropped anywhere on the card. It says
 * that a shown picture goes into the map's PNG export.
 *
 * Presentational: `SiteEditor`'s `useUnderlay` holds the state and does the
 * work.
 */

import { useId, useRef, useState, type ReactElement } from 'react';
import { Button } from '@/components/ui/button';
import { cx } from '@/components/ui/cx';
import { Icon } from '@/components/ui/icon';
import type { EditorUnderlay } from '@/lib/site/editor/model';
import { formatMetres, formatSize } from '@/lib/site/geometry';
import { coverSize, type ImagePoint } from '@/lib/site/underlay';
import { UNDERLAY_RULES_HE } from '@/lib/site/underlay-limits';
import type { EditorUi } from '../scene/scene-view';
import type { UnderlayStatus } from '../scene/underlay-mesh';
import { EditorIcon } from './editor-icons';
import chrome from './panel.module.css';
import styles from './underlay-card.module.css';

/** Where a calibration stands: the points marked so far on the picture, in order, and the last refusal in Hebrew. */
export interface CalibrationDraft {
  points: ImagePoint[];
  refusal: string | null;
}

export interface UnderlayCardProps {
  underlay: EditorUnderlay | null;
  status: UnderlayStatus;
  view: EditorUi['underlay'];
  tool: EditorUi['tool'];
  sending: boolean;
  uploadError: string | null;
  draft: CalibrationDraft;
  onFile: (file: File) => void;
  onCalibrate: () => void;
  onApplyCalibration: (distanceText: string, parallel: boolean) => void;
  onCancelCalibration: () => void;
  onAlign: () => void;
  onFinishAlign: () => void;
  onTurn: (direction: 1 | -1) => void;
  onOpacity: (opacity: number) => void;
  onRemove: () => void;
  onRetry: () => void;
  onClose: () => void;
}

/** Bidi isolates (LRI…PDI) around a number inside a Hebrew sentence (spec §20). */
const isolate = (text: string) => `⁦${text}⁩`;

const INVITATION = 'אפשר להעלות צילום או סריקה של שרטוט המגרש ולהניח עליו את הפריטים ביד. אחרי ההעלאה, סימון של מרחק ידוע על התמונה — למשל אורך הגדר — קובע את קנה המידה. צילום ישר מלמעלה, או סריקה, ייתנו את התוצאה המדויקת ביותר.';

export function UnderlayCard(props: UnderlayCardProps): ReactElement {
  const { underlay, sending, uploadError, tool } = props;
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const choose = () => { input.current?.click(); };

  let body: ReactElement;
  if (sending) {
    body = <p className={chrome.hint} role="status">מעלה…</p>;
  } else if (underlay === null) {
    body = <Invitation onChoose={choose} />;
  } else if (tool === 'calibrate') {
    body = <Calibration draft={props.draft} onApply={props.onApplyCalibration} onCancel={props.onCancelCalibration} />;
  } else if (tool === 'align') {
    body = <Alignment onTurn={props.onTurn} onFinish={props.onFinishAlign} />;
  } else {
    body = <Picture {...props} underlay={underlay} onChoose={choose} />;
  }

  return (
    <div
      className={cx(chrome.card, styles.card, over && styles.over)}
      role="group"
      aria-label="תמונת רקע"
      data-panel="true"
      onDragOver={(event) => { event.preventDefault(); setOver(true); }}
      onDragLeave={() => { setOver(false); }}
      onDrop={(event) => {
        // Without preventDefault the browser leaves the map to open the file.
        event.preventDefault();
        setOver(false);
        const file = event.dataTransfer.files[0] as File | undefined;
        if (file !== undefined) props.onFile(file);
      }}
    >
      <div className={chrome.cardHead}>
        <h2 className={styles.title}>תמונת רקע</h2>
        <Button tone="ghost" size="sm" iconLabel="סגירה" onClick={props.onClose}>
          <Icon name="x" size={14} />
        </Button>
      </div>
      {body}
      {uploadError === null ? null : <p className={styles.error} role="alert">{uploadError}</p>}
      <input
        ref={input}
        type="file"
        className={styles.file}
        accept="image/png,image/jpeg,image/webp"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file !== undefined) props.onFile(file);
          event.target.value = '';
        }}
      />
    </div>
  );
}

function Invitation({ onChoose }: { onChoose: () => void }): ReactElement {
  return (
    <>
      <p className={chrome.invite}>{INVITATION}</p>
      <div className={styles.actions}>
        <Button size="sm" tone="primary" onClick={onChoose}>
          <Icon name="upload" size={14} />
          העלאת תמונה
        </Button>
      </div>
      <p className={chrome.meta}>{UNDERLAY_RULES_HE}</p>
    </>
  );
}

function Picture(props: UnderlayCardProps & { underlay: EditorUnderlay; onChoose: () => void }): ReactElement {
  const { underlay, status, view } = props;
  const ready = status.state === 'ready';
  const percent = Math.round(view.opacity * 100);
  const { calibration } = underlay;
  const hint = replaceHint(underlay);
  const cover = status.state === 'ready' ? coverSize(underlay, status.aspect) : null;

  return (
    <>
      <p className={styles.filename}><bdi>{underlay.filename}</bdi></p>
      {status.state === 'loading' ? <p className={chrome.hint} role="status">טוען…</p> : null}
      {status.state === 'failed' ? (
        <div className={styles.row}>
          <p className={styles.error} role="alert">לא הצלחנו להציג את התמונה. אפשר לנסות שוב, או להעלות אותה מחדש.</p>
          <Button size="sm" onClick={props.onRetry}>ניסיון נוסף</Button>
        </div>
      ) : null}
      {status.state === 'missing' ? (
        <p className={styles.error} role="alert">קובץ התמונה לא נמצא. אפשר להעלות אותו מחדש.</p>
      ) : null}

      {calibration === null ? (
        <div className={styles.row}>
          <span className={styles.badge}>לא כוילה</span>
          <span className={chrome.hint}>קנה המידה זמני עד הכיול.</span>
          <Button size="sm" tone="primary" disabled={!ready} onClick={props.onCalibrate}>כיול</Button>
        </div>
      ) : (
        <p className={chrome.meta}>
          <span>{`כויל לפי ${isolate(formatMetres(calibration.distanceCm))} שסומנו על התמונה`}</span>
          {' · '}
          <button type="button" className={chrome.link} disabled={!ready} onClick={props.onCalibrate}>כיול מחדש</button>
        </p>
      )}
      {cover === null ? null : (
        <p className={chrome.meta}>
          <button type="button" className={chrome.link} onClick={props.onCalibrate}>
            {`מכסה על המפה ${isolate(formatSize(cover.widthCm, cover.depthCm))}`}
          </button>
        </p>
      )}

      <label className={styles.opacity}>
        {/* Opacity, named for what it sets: at 10% the picture is barely there (review U1). */}
        <span>{`אטימות ${isolate(`${percent}%`)}`}</span>
        <input
          type="range"
          min={10}
          max={100}
          step={10}
          value={percent}
          aria-label="אטימות"
          aria-valuetext={`${percent}%`}
          onChange={(event) => { props.onOpacity(Number(event.target.value) / 100); }}
        />
      </label>

      <div className={styles.actions}>
        <Button size="sm" disabled={!ready} onClick={props.onAlign}>הזזה</Button>
        <Button size="sm" onClick={props.onChoose}>החלפת תמונה</Button>
        <Button size="sm" tone="danger" onClick={props.onRemove}>הסרת התמונה</Button>
      </div>
      {hint === null ? null : <p className={chrome.meta}>{hint}</p>}
      <p className={chrome.meta}>כשהתמונה מוצגת, היא נכללת גם בייצוא התמונה של המפה.</p>
    </>
  );
}

/**
 * What replacing the picture starts over (spec §18.7): its calibration and its
 * turn both belonged to the old picture — the turn most likely set by the
 * parallel box. Null when it has neither (review U1).
 */
function replaceHint(underlay: EditorUnderlay): string | null {
  const calibrated = underlay.calibration !== null;
  const turned = underlay.rotationTenths !== 0;
  if (calibrated && turned) return 'הכיול והסיבוב יתחילו מחדש';
  if (calibrated) return 'הכיול יתחיל מחדש';
  if (turned) return 'הסיבוב יתחיל מחדש';
  return null;
}

function Calibration({ draft, onApply, onCancel }: {
  draft: CalibrationDraft;
  onApply: (distanceText: string, parallel: boolean) => void;
  onCancel: () => void;
}): ReactElement {
  const [distance, setDistance] = useState('');
  const [parallel, setParallel] = useState(false);
  const distanceId = useId();
  const refusalId = useId();
  const step = draft.points.length === 0 ? 'סימון הנקודה הראשונה על התמונה'
    : draft.points.length === 1 ? 'סימון הנקודה השנייה' : null;

  return (
    <>
      {step !== null ? (
        <>
          <p className={chrome.hint} role="status">{step}</p>
          <div className={styles.actions}>
            <Button size="sm" tone="ghost" onClick={onCancel}>ביטול</Button>
          </div>
        </>
      ) : (
        <form
          className={styles.form}
          onSubmit={(event) => { event.preventDefault(); onApply(distance, parallel); }}
          onKeyDown={(event) => {
            // The editor leaves keys typed into a box alone, so Esc here is the form's to end the calibration (review U1).
            if (event.key !== 'Escape') return;
            event.preventDefault();
            onCancel();
          }}
        >
          <label htmlFor={distanceId} className={styles.label}>המרחק בין שתי הנקודות, במטרים</label>
          <input
            id={distanceId}
            className={cx(styles.input, styles.number)}
            inputMode="decimal"
            autoComplete="off"
            value={distance}
            aria-invalid={draft.refusal !== null}
            aria-describedby={draft.refusal === null ? undefined : refusalId}
            onChange={(event) => { setDistance(event.target.value); }}
          />
          <label className={styles.check}>
            <input type="checkbox" checked={parallel} onChange={(event) => { setParallel(event.target.checked); }} />
            הקו הזה מקביל לגדר
          </label>
          <div className={styles.actions}>
            <Button size="sm" tone="primary" type="submit">כיול</Button>
            <Button size="sm" tone="ghost" onClick={onCancel}>ביטול</Button>
          </div>
        </form>
      )}
      <p className={chrome.meta}>הכיול נעשה בתצוגת תוכנית.</p>
      {draft.refusal === null ? null : <p id={refusalId} className={styles.error} role="alert">{draft.refusal}</p>}
    </>
  );
}

function Alignment({ onTurn, onFinish }: { onTurn: (direction: 1 | -1) => void; onFinish: () => void }): ReactElement {
  return (
    <>
      <p className={chrome.hint}>גרירה מזיזה את התמונה · החצים — 10 ס״מ, עם Shift — מטר · Esc — סיום</p>
      <div className={styles.actions}>
        <Button size="sm" onClick={() => { onTurn(1); }}>
          <EditorIcon name="rotateRight" size={14} />
          סיבוב רבע ימינה
        </Button>
        <Button size="sm" onClick={() => { onTurn(-1); }}>
          <EditorIcon name="rotateLeft" size={14} />
          סיבוב רבע שמאלה
        </Button>
        <Button size="sm" tone="primary" onClick={onFinish}>סיום</Button>
      </div>
    </>
  );
}

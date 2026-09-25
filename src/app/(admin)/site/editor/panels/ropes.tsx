'use client';

/**
 * A shade net's ropes in the panels (spec §§12–15, §20). A net's ropes run
 * from the top of each corner pole to a stake one offset out, at right
 * angles to each side; the rectangle they reach is the net's footprint, and
 * that is what the fence check, the rope-band check, the gaps while dragging
 * and "שטח תפוס" measure (D8). Shade is still the cloth's.
 *
 * The offset is the net's height over the tangent of its angle — its own
 * angle, else the camp's for nets. Until the camp sets one there is no
 * angle and no footprint (D16), and every piece here says so with an
 * invitation rather than a number nobody measured.
 */

import { useId, useState, type KeyboardEvent, type ReactElement } from 'react';
import { cx } from '@/components/ui/cx';
import { Pill } from '@/components/ui/pill';
import { effectiveSize, itemHeight } from '@/lib/site/defaults';
import { takenArea, toPlaced } from '@/lib/site/derive';
import { areaM2, contains, formatArea, formatMetres, formatSize, groundRect, shadedRect } from '@/lib/site/geometry';
import { patchOps, setKindDefaultOps } from '@/lib/site/editor/commands';
import { readDegrees } from '@/lib/site/editor/degrees';
import type { EditorDoc, EditorItem } from '@/lib/site/editor/model';
import { LOCKED_FIELDS, type SiteOp } from '@/lib/site/editor/ops';
import type { EditorFlags } from '../use-editor-store';
import { isolate } from '../notices';
import chrome from './panel.module.css';
import styles from './inspector.module.css';

/** The camp's rope angle for nets, or null while none is set (D16). */
export function campRopeAngle(doc: EditorDoc): number | null {
  return effectiveSize('shade', doc.defaults).ropeAngleDeg;
}

/**
 * The words for an item flagged outside the fence: "החבלים יוצאים מהגדר" for
 * a net whose cloth is inside and only its ropes are not — the fix is its
 * angle or its height, not a drag across the plot — else "מחוץ לגדר".
 */
export function outsideText(doc: EditorDoc, item: EditorItem): string {
  return item.kind === 'shade' && contains(doc.plot, toPlaced(item, doc.defaults))
    ? 'החבלים יוצאים מהגדר'
    : 'מחוץ לגדר';
}

/**
 * The rope-band pills of the one-item inspector (spec §15): on a net, what
 * stands in its band, as one button that selects those items; on anything
 * else, each net whose band it stands in, as a button that selects both.
 */
export function RopePills({ doc, item, flags, onPickIds }: {
  doc: EditorDoc;
  item: EditorItem;
  flags: EditorFlags;
  onPickIds: (ids: string[]) => void;
}): ReactElement | null {
  const labelOf = (id: string) => doc.items.find((entry) => entry.id === id)?.label ?? '';
  if (item.kind === 'shade') {
    const inBand = flags.ropePairs.filter(([net]) => net === item.id).map(([, id]) => id);
    if (inBand.length === 0) return null;
    return (
      <button type="button" className={styles.chipButton} onClick={() => { onPickIds(inBand); }}>
        <Pill tone="warn" dot>{`בשטח החבלים: ${inBand.map((id) => isolate(labelOf(id))).join(', ')}`}</Pill>
      </button>
    );
  }
  const nets = flags.ropePairs.filter(([, id]) => id === item.id).map(([net]) => net);
  if (nets.length === 0) return null;
  return (
    <>
      {nets.map((net) => (
        <button key={net} type="button" className={styles.chipButton} onClick={() => { onPickIds([item.id, net]); }}>
          <Pill tone="warn" dot>{`בשטח החבלים של ${isolate(labelOf(net))}`}</Pill>
        </button>
      ))}
    </>
  );
}

/**
 * One net's ropes, in its inspector's "צל וחבלים" section (spec §15): the
 * angle, typed in whole degrees and read by `readDegrees`; then the three
 * nested rectangles — shaded ground ⊂ cloth ⊂ rope footprint — each with its
 * size and area, beside the height and angle that make them, and where the
 * footprint came from. With no angle anywhere, the section is an invitation.
 *
 * The camp's angle, typed, leaves the net following the camp's angle, as the
 * kind's height does (ruling P13): "ברירת המחדל של רשתות צל" means the net
 * moves with the camp's choice. A lock holds the angle, because the angle
 * moves the footprint (`LOCKED_FIELDS`).
 */
export function RopeSection({ doc, item, onRun }: {
  doc: EditorDoc;
  item: EditorItem;
  onRun: (label: string, ops: SiteOp[]) => void;
}): ReactElement {
  const errorId = useId();
  const [draft, setDraft] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const camp = campRopeAngle(doc);
  const angle = item.ropeAngleDeg ?? camp;
  const placed = toPlaced(item, doc.defaults);
  const shaded = shadedRect(placed);
  const footprint = groundRect(placed);
  const held = item.locked && LOCKED_FIELDS.includes('ropeAngleDeg');

  function commit(): void {
    if (draft === null) return;
    const reading = readDegrees(draft);
    if (!reading.ok) {
      setRefusal(reading.error);
      return;
    }
    setDraft(null);
    setRefusal(null);
    if (reading.deg === null) return;
    const ops = patchOps(doc, item.id, { ropeAngleDeg: reading.deg === camp ? null : reading.deg });
    if (ops.length > 0) onRun(`זווית החבלים של ${item.label}`, ops);
  }

  function onKey(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      commit();
    } else if (event.key === 'Escape') {
      setDraft(null);
      setRefusal(null);
    }
  }

  function saveAsDefault(): void {
    if (item.ropeAngleDeg === null) return;
    const ops = [
      ...setKindDefaultOps(doc, 'shade', { ...effectiveSize('shade', doc.defaults), ropeAngleDeg: item.ropeAngleDeg }),
      // The net now follows the camp's angle rather than holding a copy of it.
      ...patchOps(doc, item.id, { ropeAngleDeg: null }),
    ];
    if (ops.length > 0) onRun('זווית החבלים של רשתות צל', ops);
  }

  /* With no camp angle there is no default to go back to: the link then says
     what it does — the net's own angle goes, and with it the ropes (review M3). */
  const clearLabel = camp === null ? 'הסרת הזווית של הרשת' : 'חזרה לזווית ברירת המחדל';

  function backToDefault(): void {
    const ops = patchOps(doc, item.id, { ropeAngleDeg: null });
    if (ops.length > 0) onRun(clearLabel, ops);
  }

  return (
    <>
      <label className={styles.field}>
        זווית החבלים מהקרקע
        <span className={styles.suffixed}>
          <input
            className={cx(styles.input, styles.number)}
            inputMode="numeric"
            value={draft ?? (item.ropeAngleDeg === null ? '' : String(item.ropeAngleDeg))}
            placeholder={camp === null ? undefined : String(camp)}
            disabled={held}
            aria-invalid={refusal !== null || undefined}
            aria-describedby={refusal !== null ? errorId : undefined}
            onChange={(event) => { setDraft(event.target.value); }}
            onBlur={commit}
            onKeyDown={onKey}
          />
          <span aria-hidden="true">°</span>
        </span>
      </label>
      {item.ropeAngleDeg === null && camp !== null ? <p className={chrome.meta}>ברירת המחדל של רשתות צל</p> : null}
      {refusal === null ? null : <p className={styles.error} id={errorId} role="alert">{refusal}</p>}
      {angle === null ? (
        <p className={chrome.invite}>
          עוד לא נקבעה זווית לחבלים, ולכן הרשת נבדקת לפי הבד בלבד. זווית שתוקלד כאן תחול על הרשת הזו; שמירה שלה כברירת מחדל תחול על כל רשתות הצל.
        </p>
      ) : null}
      <dl className={styles.kv}>
        <dt>מצל בפועל</dt>
        <dd>
          <bdi>{shaded === null ? 'הרשת קטנה מכדי להצל' : `${formatSize(shaded.width, shaded.depth)} · ${formatArea(areaM2(shaded))}`}</bdi>
        </dd>
        <dt>הבד</dt>
        <dd>
          <bdi>{`${formatSize(item.widthCm, item.depthCm)} · ${formatArea(areaM2({ width: item.widthCm, depth: item.depthCm }))}`}</bdi>
        </dd>
        {placed.ropeCm > 0 ? (
          <>
            <dt>עם החבלים</dt>
            <dd><bdi>{`${formatSize(footprint.width, footprint.depth)} · ${formatArea(areaM2(footprint))}`}</bdi></dd>
          </>
        ) : null}
      </dl>
      {placed.ropeCm > 0 && angle !== null ? (
        <p className={chrome.meta}>
          <bdi>{`היתדות ${formatMetres(placed.ropeCm)} מהבד: גובה ${formatMetres(itemHeight(item, doc.defaults))} חלקי טנגנס של ${angle}°`}</bdi>
        </p>
      ) : null}
      <div className={styles.links}>
        <button type="button" className={chrome.link} onClick={saveAsDefault} disabled={item.ropeAngleDeg === null}>
          שמירת הזווית כברירת המחדל של רשתות צל
        </button>
        <button type="button" className={chrome.link} onClick={backToDefault} disabled={item.ropeAngleDeg === null || held}>
          {clearLabel}
        </button>
      </div>
    </>
  );
}

/**
 * שטח תפוס (spec §3, §15): the union of every item's footprint — a net's
 * with its ropes — inside the fence, against the plot's area. Pressing the
 * figure selects every item it counts; "כולל החבלים של רשתות הצל" says when
 * ropes are in it. A `<dt>`/`<dd>` pair for `PlotInspector`'s figures.
 */
export function PlotTaken({ doc, onPickIds }: {
  doc: EditorDoc;
  onPickIds: (ids: string[]) => void;
}): ReactElement {
  const taken = takenArea(doc.plot, doc.items.map((entry) => toPlaced(entry, doc.defaults)));
  const plotM2 = areaM2(doc.plot);
  const share = plotM2 === 0 ? 0 : Math.round((taken.areaM2 / plotM2) * 100);
  const figure = `${formatArea(taken.areaM2)} מתוך ${plotM2} · ${share}%`;
  return (
    <>
      <dt>שטח תפוס</dt>
      <dd>
        {taken.ids.length === 0 ? <bdi>{figure}</bdi> : (
          <button type="button" className={chrome.link} onClick={() => { onPickIds(taken.ids); }}>
            <bdi>{figure}</bdi>
          </button>
        )}
        {taken.withRopes ? <p className={chrome.meta}>כולל החבלים של רשתות הצל</p> : null}
      </dd>
    </>
  );
}

/**
 * The camp's rope angle, under "צל" in the plot inspector (spec §15): a line
 * that opens a net following it — "זווית החבלים: 45° לכל הרשתות", or "… לכל
 * רשת בלי זווית משלה" when some nets keep their own — and, while the camp
 * has none, an invitation whose button opens a net without an angle of its
 * own. With no nets there is nothing to say.
 */
export function PlotRopes({ doc, onPickIds }: {
  doc: EditorDoc;
  onPickIds: (ids: string[]) => void;
}): ReactElement | null {
  const nets = doc.items.filter((entry) => entry.kind === 'shade');
  if (nets.length === 0) return null;
  const camp = campRopeAngle(doc);
  const following = nets.find((net) => net.ropeAngleDeg === null) ?? nets[0];
  const someOwn = nets.some((net) => net.ropeAngleDeg !== null);
  return (
    <>
      {camp === null ? (
        <p className={chrome.invite}>
          <span>זווית החבלים עוד לא נקבעה</span>
          {' '}
          <button type="button" className={chrome.link} onClick={() => { onPickIds([following.id]); }}>קביעת זווית</button>
        </p>
      ) : (
        <p className={chrome.meta}>
          <button type="button" className={chrome.link} onClick={() => { onPickIds([following.id]); }}>
            <bdi>{someOwn ? `זווית החבלים: ${camp}° לכל רשת בלי זווית משלה` : `זווית החבלים: ${camp}° לכל הרשתות`}</bdi>
          </button>
        </p>
      )}
      <p className={chrome.hint}>החבלים לא מצלים — הם רק תופסים שטח.</p>
    </>
  );
}

/** The plot inspector's rows for items in a rope band (spec §15): "בשטח החבלים: אוהל 3 · רשת צל 1", selecting both. */
export function ropeProblems(
  doc: EditorDoc, flags: EditorFlags,
): Array<{ key: string; tone: 'warn'; text: string; ids: string[] }> {
  const labelOf = (id: string) => doc.items.find((entry) => entry.id === id)?.label ?? '';
  return flags.ropePairs.map(([net, id]) => ({
    key: `ropes:${net}:${id}`, tone: 'warn', text: `בשטח החבלים: ${labelOf(id)} · ${labelOf(net)}`, ids: [net, id],
  }));
}

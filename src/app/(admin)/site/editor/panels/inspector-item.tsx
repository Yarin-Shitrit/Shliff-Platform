'use client';

/**
 * One item, typed to the centimetre (spec §10): what a drag does roughly,
 * this does precisely — name, size and height, place, a net's unshaded strip,
 * the build task and the notes. Lengths are typed in metres, the way a lead
 * measures on the playa, and read by `readMetres` (Review Focus #2): an empty
 * box leaves the value; a refusal is Hebrew and nothing is sent. An edit is
 * applied on Enter or when the box is left.
 *
 * A locked item keeps its size, height and place until it is unlocked, so
 * the boxes for exactly the fields `ops.ts`'s `LOCKED_FIELDS` names are
 * disabled rather than refused after the fact — one lock rule, one list.
 *
 * The kind's own height, typed, leaves the item on its kind's height (ruling
 * P13): "גובה ברירת מחדל" means the item follows its kind, and typing the
 * number the kind already has must not quietly turn that into a copy.
 */

import { useId, useState, type KeyboardEvent, type ReactElement, type ReactNode } from 'react';
import type { SiteLineKind } from '@/db/schema/site';
import { Button } from '@/components/ui/button';
import { cx } from '@/components/ui/cx';
import { Icon } from '@/components/ui/icon';
import { Pill } from '@/components/ui/pill';
import { SourceChip } from '@/components/ui/source-chip';
import { effectiveSize, itemHeight } from '@/lib/site/defaults';
import { toPlaced } from '@/lib/site/derive';
import { areaM2, formatArea, formatMetres, formatSize, metres, shadedRect, shadeState } from '@/lib/site/geometry';
import { DEFAULT_SHADE_INSET_CM, SITE_KINDS } from '@/lib/site/kinds';
import { eligibleEnds, LINE_KINDS, lineKindsOf, lineLengthCm, unconnected } from '@/lib/site/lines';
import { linesAt, rectOf, type EditorDoc, type EditorItem } from '@/lib/site/editor/model';
import { LOCKED_FIELDS, type ItemPatch, type SiteOp } from '@/lib/site/editor/ops';
import { patchOps, resetSizeOps, setKindDefaultOps } from '@/lib/site/editor/commands';
import {
  GAP_RANGE, HEIGHT_RANGE, POSITION_RANGE, SIDE_RANGE, readMetres, type MetresRange,
} from '@/lib/site/editor/metres';
import { LABEL_REQUIRED } from '../../failure-messages';
import type { EditorFlags } from '../use-editor-store';
import { size3 } from './size-text';
import chrome from './panel.module.css';
import styles from './inspector.module.css';

type Length = 'width' | 'depth' | 'height' | 'x' | 'y' | 'inset';
type Field = Length | 'label' | 'notes';

/**
 * Every length a lead types here: the range plan 02's `readMetres` checks it
 * against, and the patch field it writes — which is how a lock disables it.
 */
const LENGTHS: ReadonlyArray<{ field: Length; range: MetresRange; key: keyof ItemPatch }> = [
  { field: 'width', range: SIDE_RANGE, key: 'widthCm' },
  { field: 'depth', range: SIDE_RANGE, key: 'depthCm' },
  { field: 'height', range: HEIGHT_RANGE, key: 'heightCm' },
  { field: 'x', range: POSITION_RANGE, key: 'xCm' },
  { field: 'y', range: POSITION_RANGE, key: 'yCm' },
  { field: 'inset', range: GAP_RANGE, key: 'insetCm' },
];

/** Whether a lock holds this box: its field is one `LOCKED_FIELDS` names. */
function heldByLock(item: EditorItem, field: Length): boolean {
  const key = LENGTHS.find((rule) => rule.field === field)?.key;
  return item.locked && key !== undefined && LOCKED_FIELDS.includes(key);
}

export function ItemInspector({ doc, item, flags, buildTasks, onRun, onPickIds, onAddLine, footer }: {
  doc: EditorDoc;
  item: EditorItem;
  flags: EditorFlags;
  buildTasks: ReadonlyArray<{ id: string; title: string }>;
  onRun: (label: string, ops: SiteOp[]) => void;
  onPickIds: (ids: string[]) => void;
  /** A new pipe or cable from this item to another — SiteEditor's, so its toast is too. Without it the panel offers none. */
  onAddLine?: (kind: SiteLineKind, fromId: string, toId: string) => void;
  /** Turn, duplicate, lock and remove — SiteEditor's, so their toasts are too. */
  footer?: ReactNode;
}): ReactElement {
  const errorId = useId();
  const [drafts, setDrafts] = useState<Partial<Record<Field, string>>>({});
  const [refusal, setRefusal] = useState<{ field: Field; message: string } | null>(null);

  const preset = SITE_KINDS[item.kind];
  const standard = effectiveSize(item.kind, doc.defaults);
  const height = itemHeight(item, doc.defaults);
  const isNet = item.kind === 'shade';
  const onStandardSize = item.widthCm === standard.widthCm && item.depthCm === standard.depthCm;
  const shaded = isNet ? shadedRect(toPlaced(item)) : null;
  /* A task link the build list does not hold: still a link, so the box says
     so rather than falling back to "ללא משימת הקמה" (§13, nothing is guessed). */
  const unlistedTask = item.taskId !== null && !buildTasks.some((task) => task.id === item.taskId)
    ? item.taskId
    : null;

  const partners = flags.pairs.flatMap(([a, b]) => (a === item.id ? [b] : b === item.id ? [a] : []));
  const partnerNames = partners
    .map((id) => doc.items.find((other) => other.id === id)?.label)
    .filter((label): label is string => label !== undefined);
  const nets = doc.items.filter((other) => other.kind === 'shade').map(toPlaced);
  const inShade = !isNet && nets.length > 0 && shadeState(rectOf(item), nets) === 'shaded';

  /* The utilities this item takes part in (`lines.ts`): every line already
     at it, and for each utility the items a new line could run to. A
     consumer no chain reaches from a source says so — a fact, not a fault. */
  const utilities = lineKindsOf(item.kind);
  const attached = linesAt(doc, item.id);
  const missing = utilities.filter((kind) => LINE_KINDS[kind].consumers.includes(item.kind) && unconnected(doc, kind).includes(item.id));

  function draft(field: Field, value: string): void {
    setDrafts((current) => ({ ...current, [field]: value }));
  }

  function commit(): void {
    if (Object.keys(drafts).length === 0) return;
    const patch: ItemPatch = {};
    if (drafts.label !== undefined) {
      if (drafts.label.trim() === '') {
        setRefusal({ field: 'label', message: LABEL_REQUIRED });
        return;
      }
      patch.label = drafts.label;
    }
    const typed: Partial<Record<Length, number>> = {};
    for (const rule of LENGTHS) {
      const text = drafts[rule.field];
      if (text === undefined) continue;
      const reading = readMetres(text, rule.range);
      if (!reading.ok) {
        setRefusal({ field: rule.field, message: reading.error });
        return;
      }
      if (reading.cm !== null) typed[rule.field] = reading.cm;
    }
    const widthCm = typed.width ?? item.widthCm;
    const depthCm = typed.depth ?? item.depthCm;
    if (widthCm !== item.widthCm || depthCm !== item.depthCm) {
      // About its own middle, like every resize the inspectors make (§10).
      patch.widthCm = widthCm;
      patch.depthCm = depthCm;
      patch.xCm = Math.round((item.xCm * 2 + item.widthCm - widthCm) / 2);
      patch.yCm = Math.round((item.yCm * 2 + item.depthCm - depthCm) / 2);
    }
    if (typed.x !== undefined) patch.xCm = typed.x;
    if (typed.y !== undefined) patch.yCm = typed.y;
    // Ruling P13: the kind's height is null — the item keeps following its kind.
    if (typed.height !== undefined) patch.heightCm = typed.height === standard.heightCm ? null : typed.height;
    if (typed.inset !== undefined) patch.insetCm = typed.inset;
    if (drafts.notes !== undefined) patch.notes = drafts.notes;
    setDrafts({});
    setRefusal(null);
    // `patchOps` stores it the way the server will (trimmed, blank notes as none) and drops what did not change.
    const ops = patchOps(doc, item.id, patch);
    if (ops.length > 0) onRun(`עריכת ${item.label}`, ops);
  }

  function onKey(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      commit();
    } else if (event.key === 'Escape') {
      setDrafts({});
      setRefusal(null);
    }
  }

  function lengthBox(field: Length, label: string, value: string, placeholder?: string): ReactElement {
    const refused = refusal?.field === field;
    return (
      <label className={styles.field}>
        {label}
        <input
          className={cx(styles.input, styles.number)}
          inputMode="decimal"
          value={drafts[field] ?? value}
          placeholder={placeholder}
          disabled={heldByLock(item, field)}
          aria-invalid={refused || undefined}
          aria-describedby={refused ? errorId : undefined}
          onChange={(event) => { draft(field, event.target.value); }}
          onBlur={commit}
          onKeyDown={onKey}
        />
      </label>
    );
  }

  function saveAsDefault(): void {
    const ops = setKindDefaultOps(doc, item.kind, {
      widthCm: item.widthCm,
      depthCm: item.depthCm,
      heightCm: height,
      insetCm: isNet ? (item.insetCm ?? DEFAULT_SHADE_INSET_CM) : null,
    });
    if (ops.length > 0) onRun(`ברירת המחדל של ${preset.label}`, ops);
  }

  function backToDefault(): void {
    const ops = resetSizeOps(doc, [item.id]);
    if (ops.length > 0) onRun('חזרה לברירת המחדל', ops);
  }

  function setTask(value: string): void {
    const ops = patchOps(doc, item.id, { taskId: value === '' ? null : value });
    if (ops.length > 0) onRun('משימת הקמה', ops);
  }

  const labelRefused = refusal?.field === 'label';

  return (
    <>
      <header className={styles.head}>
        <span className={cx(chrome.swatch, chrome[`g_${preset.group}`])} aria-hidden="true" />
        <h2 className={styles.headTitle}>{item.label}</h2>
        <span className={chrome.meta}>{preset.label}</span>
        {/* Ruling P11: a noun phrase, never an adjective that must agree with the item's name. */}
        {item.locked ? <Pill tone="neutral">בנעילה</Pill> : null}
        <span className={styles.headEnd}>
          <SourceChip source={{ kind: 'manual' }} />
          <Button tone="ghost" size="sm" iconLabel="ביטול הבחירה" onClick={() => { onPickIds([]); }}>
            <Icon name="x" size={14} />
          </Button>
        </span>
      </header>

      <div className={chrome.body}>
        <label className={styles.field}>
          שם
          <input
            className={styles.input}
            value={drafts.label ?? item.label}
            aria-invalid={labelRefused || undefined}
            aria-describedby={labelRefused ? errorId : undefined}
            onChange={(event) => { draft('label', event.target.value); }}
            onBlur={commit}
            onKeyDown={onKey}
          />
        </label>

        <div className={styles.pills}>
          {flags.outside.has(item.id) ? <Pill tone="bad" dot>מחוץ לגדר</Pill> : null}
          {partnerNames.length > 0 ? (
            <button type="button" className={styles.chipButton} onClick={() => { onPickIds([item.id, ...partners]); }}>
              <Pill tone="warn" dot>{`חפיפה עם ${partnerNames.join(', ')}`}</Pill>
            </button>
          ) : null}
          {flags.partly.has(item.id) ? <Pill tone="warn" dot>בשולי רשת הצל, בלי צל</Pill> : null}
          {inShade ? <Pill tone="ok" dot>בצל</Pill> : null}
          {missing.map((kind) => <Pill key={kind} tone="warn" dot>{`בלי חיבור ל${LINE_KINDS[kind].noun}`}</Pill>)}
        </div>

        {refusal === null ? null : <p className={styles.error} id={errorId} role="alert">{refusal.message}</p>}
        {item.locked ? (
          <p className={chrome.hint}>הפריט נעול. שחרור הנעילה מאפשר להזיז אותו ולשנות את מידותיו.</p>
        ) : null}

        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>
            מידות
            <span className={styles.sectionMeta}>{onStandardSize ? 'ברירת מחדל · במטרים' : 'במטרים'}</span>
          </h3>
          <div className={styles.fields}>
            {lengthBox('width', 'רוחב', metres(item.widthCm))}
            {lengthBox('depth', 'עומק', metres(item.depthCm))}
            {lengthBox('height', 'גובה', item.heightCm === null ? '' : metres(item.heightCm), item.heightCm === null ? metres(height) : undefined)}
          </div>
          {item.heightCm === null ? <p className={chrome.meta}>גובה ברירת מחדל</p> : null}
          <p className={chrome.hint}>
            <bdi>{`ברירת המחדל של ${preset.label}: ${size3(standard)}`}</bdi>
          </p>
          <div className={styles.links}>
            <button type="button" className={chrome.link} onClick={saveAsDefault}>
              {`שמירת המידות כברירת המחדל של ${preset.label}`}
            </button>
            <button type="button" className={chrome.link} onClick={backToDefault} disabled={item.locked}>
              חזרה לברירת המחדל
            </button>
          </div>
        </div>

        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>
            מיקום
            <span className={styles.sectionMeta}>מטרים מהפינה הצפון־מערבית</span>
          </h3>
          <div className={cx(styles.fields, styles.fieldsTwo)}>
            {lengthBox('x', 'ממערב', metres(item.xCm))}
            {lengthBox('y', 'מצפון', metres(item.yCm))}
          </div>
        </div>

        {isNet ? (
          <div className={styles.section}>
            <h3 className={styles.sectionTitle}>צל</h3>
            <div className={cx(styles.fields, styles.fieldsTwo)}>
              {lengthBox('inset', 'שוליים בלי צל', metres(item.insetCm ?? DEFAULT_SHADE_INSET_CM))}
              <p className={chrome.meta}>
                מצל בפועל
                <br />
                <bdi>{shaded === null ? 'הרשת קטנה מכדי להצל' : `${formatSize(shaded.width, shaded.depth)} · ${formatArea(areaM2(shaded))}`}</bdi>
              </p>
            </div>
          </div>
        ) : null}

        {utilities.length === 0 ? null : (
          <div className={styles.section}>
            <h3 className={styles.sectionTitle}>
              חיבורים
              <span className={styles.sectionMeta}>{utilities.map((kind) => LINE_KINDS[kind].noun).join(' · ')}</span>
            </h3>
            {attached.map((line) => {
              const otherId = line.fromId === item.id ? line.toId : line.fromId;
              const other = doc.items.find((entry) => entry.id === otherId);
              const length = lineLengthCm(doc, line);
              return (
                <button key={line.id} type="button" className={styles.groupStat} onClick={() => { onPickIds([line.id]); }}>
                  <span className={cx(chrome.swatch, chrome[`l_${line.kind}`])} aria-hidden="true" />
                  <span className={styles.groupName}>{`${line.label} · אל ${other?.label ?? 'פריט שכבר לא במפה'}`}</span>
                  {' '}
                  <span className={styles.groupCount}><bdi>{length === null ? '—' : formatMetres(length)}</bdi></span>
                </button>
              );
            })}
            {onAddLine === undefined ? null : utilities.map((kind) => {
              const ends = eligibleEnds(doc, item.id, kind);
              const title = `${LINE_KINDS[kind].label} חדש אל`;
              if (ends.length === 0) {
                return (
                  <p key={kind} className={chrome.hint}>
                    {attached.some((line) => line.kind === kind)
                      ? `אין במפה פריט נוסף ש${LINE_KINDS[kind].noun} מגיעים אליו.`
                      : `אין במפה פריט אחר ש${LINE_KINDS[kind].noun} מגיעים אליו. מוסיפים אותו מהספרייה, ואז מחברים.`}
                  </p>
                );
              }
              return (
                <label key={kind} className={styles.field}>
                  {title}
                  <select className={styles.input} value="" onChange={(event) => { if (event.target.value !== '') onAddLine(kind, item.id, event.target.value); }}>
                    <option value="">בחירת פריט…</option>
                    {ends.map((end) => <option key={end.id} value={end.id}>{end.label}</option>)}
                  </select>
                </label>
              );
            })}
          </div>
        )}

        <label className={styles.field}>
          משימת הקמה
          <select className={styles.input} value={item.taskId ?? ''} onChange={(event) => { setTask(event.target.value); }}>
            <option value="">ללא משימת הקמה</option>
            {unlistedTask === null ? null : <option value={unlistedTask}>משימה שאינה ברשימה</option>}
            {buildTasks.map((task) => <option key={task.id} value={task.id}>{task.title}</option>)}
          </select>
        </label>

        <label className={styles.field}>
          הערות
          <textarea
            className={styles.input}
            rows={2}
            placeholder="למשל: הפתח לכיוון הרחוב"
            value={drafts.notes ?? item.notes ?? ''}
            onChange={(event) => { draft('notes', event.target.value); }}
            onBlur={commit}
          />
        </label>
      </div>

      {footer === undefined ? null : <footer className={styles.foot}>{footer}</footer>}
    </>
  );
}

'use client';

/**
 * One pipe or cable (spec §10, extended for `site_lines`): its name, the two
 * items it runs between — each a button that selects that item, and a box
 * that moves the end to another item the utility reaches — its length on the
 * map, the bends of its route typed in metres, and notes. Lengths are typed
 * the way the item inspector takes them (`readMetres`), applied on Enter or
 * when the box is left, and refused in Hebrew.
 *
 * The length is what the map measures: wall to wall through the bends, with
 * no reserve. The panel says so, because the metres a lead buys are the
 * lead's decision, not the map's guess (§13).
 */

import { useId, useState, type KeyboardEvent, type ReactElement, type ReactNode } from 'react';
import type { SiteLinePoint } from '@/db/schema/site';
import { Button } from '@/components/ui/button';
import { cx } from '@/components/ui/cx';
import { Icon } from '@/components/ui/icon';
import { SourceChip } from '@/components/ui/source-chip';
import { formatMetres, metres } from '@/lib/site/geometry';
import { findItem, type EditorDoc, type EditorLine } from '@/lib/site/editor/model';
import type { SiteOp } from '@/lib/site/editor/ops';
import { patchLineOps } from '@/lib/site/editor/commands';
import { POSITION_RANGE, readMetres } from '@/lib/site/editor/metres';
import { joins, LINE_KINDS, pathLengthCm, pathOf } from '@/lib/site/lines';
import { LINE_LABEL_REQUIRED } from '../../failure-messages';
import chrome from './panel.module.css';
import styles from './inspector.module.css';

type Field = 'label' | 'notes' | `x${number}` | `y${number}`;

/** The leg of the path — by the index of its first point — that is longest; -1 for a path of one point. */
function longestLeg(path: readonly SiteLinePoint[]): number {
  let at = -1;
  let longest = -1;
  for (let i = 1; i < path.length; i += 1) {
    const length = Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
    if (length > longest) {
      longest = length;
      at = i - 1;
    }
  }
  return at;
}

/** The bend to add: the middle of the longest leg of the path as it is drawn now, so the new point lies on the line. */
export function midpointOfLongestLeg(path: readonly SiteLinePoint[]): SiteLinePoint | null {
  const at = longestLeg(path);
  if (at === -1) return null;
  return [Math.round((path[at][0] + path[at + 1][0]) / 2), Math.round((path[at][1] + path[at + 1][1]) / 2)];
}

export function LineInspector({ doc, line, onRun, onPickIds, footer }: {
  doc: EditorDoc;
  line: EditorLine;
  onRun: (label: string, ops: SiteOp[]) => void;
  onPickIds: (ids: string[]) => void;
  /** Remove — SiteEditor's, so its toast is too. */
  footer?: ReactNode;
}): ReactElement {
  const errorId = useId();
  const [drafts, setDrafts] = useState<Partial<Record<Field, string>>>({});
  const [refusal, setRefusal] = useState<{ field: Field; message: string } | null>(null);

  const preset = LINE_KINDS[line.kind];
  const from = findItem(doc, line.fromId);
  const to = findItem(doc, line.toId);
  const path = pathOf(doc, line);
  const length = path === null ? null : pathLengthCm(path);
  /** What either end may be moved to: every item the utility reaches, but the other end. */
  const endsFor = (otherId: string) => doc.items.filter((item) => item.id !== otherId && joins(line.kind, item.kind));

  function draft(field: Field, value: string): void {
    setDrafts((current) => ({ ...current, [field]: value }));
  }

  function run(label: string, ops: SiteOp[]): void {
    if (ops.length > 0) onRun(label, ops);
  }

  function commit(): void {
    if (Object.keys(drafts).length === 0) return;
    const patch: Parameters<typeof patchLineOps>[2] = {};
    if (drafts.label !== undefined) {
      if (drafts.label.trim() === '') {
        setRefusal({ field: 'label', message: LINE_LABEL_REQUIRED });
        return;
      }
      patch.label = drafts.label;
    }
    if (drafts.notes !== undefined) patch.notes = drafts.notes;
    const points = line.points.map((p): SiteLinePoint => [p[0], p[1]]);
    let bent = false;
    for (let i = 0; i < points.length; i += 1) {
      for (const [axis, field] of [[0, `x${i}`], [1, `y${i}`]] as const) {
        const text = drafts[field as Field];
        if (text === undefined) continue;
        const reading = readMetres(text, POSITION_RANGE);
        if (!reading.ok) {
          setRefusal({ field: field as Field, message: reading.error });
          return;
        }
        if (reading.cm !== null) {
          points[i][axis] = reading.cm;
          bent = true;
        }
      }
    }
    if (bent) patch.points = points;
    setDrafts({});
    setRefusal(null);
    run(`עריכת ${line.label}`, patchLineOps(doc, line.id, patch));
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

  function setEnd(which: 'fromId' | 'toId', value: string): void {
    if (value === '') return;
    run(`קצה של ${line.label}`, patchLineOps(doc, line.id, { [which]: value }));
  }

  function addBend(): void {
    if (path === null) return;
    const middle = midpointOfLongestLeg(path);
    const at = longestLeg(path);
    if (middle === null || at === -1) return;
    // The path's first point is the wall, so the leg's index is the new bend's place among the bends.
    const points = [...line.points.slice(0, at), middle, ...line.points.slice(at)];
    run(`נקודת פנייה ב${line.label}`, patchLineOps(doc, line.id, { points }));
  }

  function removeBend(index: number): void {
    run(`הסרת נקודת פנייה מ${line.label}`, patchLineOps(doc, line.id, { points: line.points.filter((_, i) => i !== index) }));
  }

  function bendBox(field: Field, label: string, value: string): ReactElement {
    const refused = refusal?.field === field;
    return (
      <label className={styles.field}>
        {label}
        <input
          className={cx(styles.input, styles.number)}
          inputMode="decimal"
          value={drafts[field] ?? value}
          aria-invalid={refused || undefined}
          aria-describedby={refused ? errorId : undefined}
          onChange={(event) => { draft(field, event.target.value); }}
          onBlur={commit}
          onKeyDown={onKey}
        />
      </label>
    );
  }

  function endRow(which: 'fromId' | 'toId', title: string, item: typeof from, otherId: string): ReactElement {
    return (
      <label className={styles.field}>
        {title}
        <select className={styles.input} value={item?.id ?? ''} onChange={(event) => { setEnd(which, event.target.value); }}>
          {item === undefined ? <option value="">פריט שכבר לא במפה</option> : null}
          {endsFor(otherId).map((candidate) => (
            <option key={candidate.id} value={candidate.id}>{candidate.label}</option>
          ))}
        </select>
      </label>
    );
  }

  const labelRefused = refusal?.field === 'label';

  return (
    <>
      <header className={styles.head}>
        <span className={cx(chrome.swatch, chrome[`l_${line.kind}`])} aria-hidden="true" />
        <h2 className={styles.headTitle}>{line.label}</h2>
        <span className={chrome.meta}>{preset.label}</span>
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
            value={drafts.label ?? line.label}
            aria-invalid={labelRefused || undefined}
            aria-describedby={labelRefused ? errorId : undefined}
            onChange={(event) => { draft('label', event.target.value); }}
            onBlur={commit}
            onKeyDown={onKey}
          />
        </label>

        {refusal === null ? null : <p className={styles.error} id={errorId} role="alert">{refusal.message}</p>}

        <div className={styles.section}>
          <dl className={styles.kv}>
            <dt>אורך על המפה</dt>
            <dd><bdi>{length === null ? 'אחד הקצוות כבר לא במפה' : formatMetres(length)}</bdi></dd>
            <dt>נקודות פנייה</dt>
            <dd><bdi>{String(line.points.length)}</bdi></dd>
          </dl>
          <p className={chrome.hint}>
            נמדד מקיר לקיר דרך נקודות הפנייה, בלי רזרבה לגובה, לחיבורים או לרפיון. את הרזרבה מוסיפים לפי השטח.
          </p>
        </div>

        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>קצוות</h3>
          <div className={styles.links}>
            {from === undefined ? null : (
              <button type="button" className={chrome.link} onClick={() => { onPickIds([from.id]); }}>{from.label}</button>
            )}
            {to === undefined ? null : (
              <button type="button" className={chrome.link} onClick={() => { onPickIds([to.id]); }}>{to.label}</button>
            )}
          </div>
          <div className={cx(styles.fields, styles.fieldsTwo)}>
            {endRow('fromId', 'מ', from, line.toId)}
            {endRow('toId', 'אל', to, line.fromId)}
          </div>
        </div>

        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>
            מסלול
            <span className={styles.sectionMeta}>מטרים מהפינה הצפון־מערבית</span>
          </h3>
          {line.points.length === 0 ? (
            <p className={chrome.hint}>הקו ישר. נקודת פנייה מעבירה אותו לאורך הגדר או מסביב לאוהל, והאורך מתעדכן.</p>
          ) : line.points.map((point, index) => (
            <div key={index} className={styles.controlsRow}>
              {bendBox(`x${index}`, 'ממערב', metres(point[0]))}
              {bendBox(`y${index}`, 'מצפון', metres(point[1]))}
              <button
                type="button"
                className={chrome.iconButton}
                aria-label={`הסרת נקודת פנייה ${index + 1}`}
                onClick={() => { removeBend(index); }}
              >
                <Icon name="x" size={14} />
              </button>
            </div>
          ))}
          <div className={styles.links}>
            <button type="button" className={chrome.link} onClick={addBend} disabled={path === null}>
              הוספת נקודת פנייה
            </button>
          </div>
        </div>

        <label className={styles.field}>
          הערות
          <textarea
            className={styles.input}
            rows={2}
            placeholder="למשל: צינור 3/4 צול, מוטמן לאורך הגדר"
            value={drafts.notes ?? line.notes ?? ''}
            onChange={(event) => { draft('notes', event.target.value); }}
            onBlur={commit}
          />
        </label>
      </div>

      {footer === undefined ? null : <footer className={styles.foot}>{footer}</footer>}
    </>
  );
}

/** Several lines and nothing else selected: each named, each a button to it, and the remove in the footer. */
export function LinesInspector({ doc, lines, onPickIds, footer }: {
  doc: EditorDoc;
  lines: readonly EditorLine[];
  onPickIds: (ids: string[]) => void;
  footer?: ReactNode;
}): ReactElement {
  return (
    <>
      <header className={styles.head}>
        <h2 className={styles.headTitle}>{`${lines.length} קווים`}</h2>
        <span className={styles.headEnd}>
          <SourceChip source={{ kind: 'manual' }} />
          <Button tone="ghost" size="sm" iconLabel="ביטול הבחירה" onClick={() => { onPickIds([]); }}>
            <Icon name="x" size={14} />
          </Button>
        </span>
      </header>
      <div className={chrome.body}>
        {lines.map((line) => {
          const path = pathOf(doc, line);
          return (
            <button key={line.id} type="button" className={styles.groupStat} onClick={() => { onPickIds([line.id]); }}>
              <span className={cx(chrome.swatch, chrome[`l_${line.kind}`])} aria-hidden="true" />
              <span className={styles.groupName}>{line.label}</span>
              {' '}
              <span className={styles.groupCount}><bdi>{path === null ? '—' : formatMetres(pathLengthCm(path))}</bdi></span>
            </button>
          );
        })}
      </div>
      {footer === undefined ? null : <footer className={styles.foot}>{footer}</footer>}
    </>
  );
}

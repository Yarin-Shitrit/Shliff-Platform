'use client';

/**
 * Several items (spec §10). What is selected is named per kind, each name a
 * chip that selects that kind alone (§13, ruling P9). Sizes are per kind, so
 * there is one row per kind: a width typed there goes to every item of that
 * kind in the selection, each resized about its own middle. A value the
 * selection does not share shows empty, with מעורב as the placeholder — never
 * a made-up number (§13). A height every item takes from its kind is marked
 * so (ruling P13). A kind's default is stored only when the selected items of
 * that kind agree; until then the row says so and stores nothing.
 *
 * Then align, distribute and a row with a typed gap. Every typed length goes
 * through `readMetres` (plan 02).
 */

import { useState, type ReactElement, type ReactNode } from 'react';
import type { SiteItemKind } from '@/db/schema/site';
import { Button } from '@/components/ui/button';
import { cx } from '@/components/ui/cx';
import { Icon } from '@/components/ui/icon';
import { Pill } from '@/components/ui/pill';
import { SourceChip } from '@/components/ui/source-chip';
import { effectiveSize, type KindSize } from '@/lib/site/defaults';
import { metres } from '@/lib/site/geometry';
import { DEFAULT_SHADE_INSET_CM, KIND_ORDER, SITE_KINDS } from '@/lib/site/kinds';
import { findItem, type EditorDoc, type EditorItem } from '@/lib/site/editor/model';
import { applyOps, type SiteOp } from '@/lib/site/editor/ops';
import {
  alignOps, distributeOps, resetSizeOps, resizeKindOps, rowOps, setKindDefaultOps, uniformSize,
  type Alignment,
} from '@/lib/site/editor/commands';
import {
  GAP_RANGE, HEIGHT_RANGE, NOT_A_LENGTH, SIDE_RANGE, readMetres, type MetresRange,
} from '@/lib/site/editor/metres';
import { EditorIcon, type EditorIconName } from './editor-icons';
import { size3 } from './size-text';
import styles from './inspector.module.css';

type SizeField = 'width' | 'depth' | 'height';

const SIZES: ReadonlyArray<{ field: SizeField; label: string; range: MetresRange }> = [
  { field: 'width', label: 'רוחב', range: SIDE_RANGE },
  { field: 'depth', label: 'עומק', range: SIDE_RANGE },
  { field: 'height', label: 'גובה', range: HEIGHT_RANGE },
];

const ALIGN: ReadonlyArray<{ how: Alignment; icon: EditorIconName; label: string }> = [
  { how: 'west', icon: 'alignWest', label: 'יישור לקצה המערבי' },
  { how: 'centreX', icon: 'alignCentreX', label: 'יישור למרכז, מזרח־מערב' },
  { how: 'east', icon: 'alignEast', label: 'יישור לקצה המזרחי' },
  { how: 'north', icon: 'alignNorth', label: 'יישור לקצה הצפוני' },
  { how: 'centreY', icon: 'alignCentreY', label: 'יישור למרכז, צפון־דרום' },
  { how: 'south', icon: 'alignSouth', label: 'יישור לקצה הדרומי' },
];

/** The default the selected items of one kind agree on — sides, height, and a net's strip — or null: nothing is guessed. */
function agreedSize(doc: EditorDoc, ids: readonly string[], kind: SiteItemKind): KindSize | null {
  const shared = uniformSize(doc, ids, kind);
  if (shared.widthCm === null || shared.depthCm === null || shared.heightCm === null) return null;
  if (kind !== 'shade') {
    return { widthCm: shared.widthCm, depthCm: shared.depthCm, heightCm: shared.heightCm, insetCm: null };
  }
  const insets = new Set(ids.map((id) => findItem(doc, id)?.insetCm ?? DEFAULT_SHADE_INSET_CM));
  if (insets.size !== 1) return null;
  return { widthCm: shared.widthCm, depthCm: shared.depthCm, heightCm: shared.heightCm, insetCm: [...insets][0] };
}

function KindRow({ doc, kind, ids, onRun }: {
  doc: EditorDoc;
  kind: SiteItemKind;
  ids: string[];
  onRun: (label: string, ops: SiteOp[]) => void;
}): ReactElement {
  const [drafts, setDrafts] = useState<Partial<Record<SizeField, string>>>({});
  const [keep, setKeep] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const preset = SITE_KINDS[kind];
  const shared = uniformSize(doc, ids, kind);
  const sharedCm: Record<SizeField, number | null> = { width: shared.widthCm, depth: shared.depthCm, height: shared.heightCm };
  const agreed = agreedSize(doc, ids, kind);
  const standard = effectiveSize(kind, doc.defaults);
  // Ruling P13: none of them has a height of its own — every one follows its kind.
  const onKindHeight = ids.every((id) => findItem(doc, id)?.heightCm === null);

  function commit(storeDefault: boolean): void {
    const size: { widthCm?: number; depthCm?: number; heightCm?: number } = {};
    for (const { field, range } of SIZES) {
      const text = drafts[field];
      if (text === undefined) continue;
      const reading = readMetres(text, range);
      if (!reading.ok) {
        setRefusal(reading.error);
        return;
      }
      if (reading.cm === null) continue;
      if (field === 'width') size.widthCm = reading.cm;
      else if (field === 'depth') size.depthCm = reading.cm;
      else size.heightCm = reading.cm;
    }
    let ops: SiteOp[] = Object.keys(size).length > 0 ? resizeKindOps(doc, ids, kind, size) : [];
    if (storeDefault) {
      // Asked of the map as it will be once the sizes above are applied.
      const after = applyOps(doc, ops).doc;
      const sizeAfter = agreedSize(after, ids, kind);
      if (sizeAfter !== null) ops = [...ops, ...setKindDefaultOps(after, kind, sizeAfter)];
    }
    setDrafts({});
    setRefusal(null);
    if (ops.length > 0) onRun(`מידות של ${preset.plural}`, ops);
  }

  return (
    <div className={styles.kindRow}>
      <div className={styles.kindHead}>
        <span className={cx(styles.swatch, styles[`g_${preset.group}`])} aria-hidden="true" />
        {preset.label}
        <span className={styles.kindCount}>
          ×
          {' '}
          <bdi>{ids.length}</bdi>
        </span>
      </div>
      <div className={styles.fields}>
        {SIZES.map(({ field, label }) => {
          const cm = sharedCm[field];
          return (
            <label key={field} className={styles.field}>
              {label}
              <input
                className={cx(styles.input, styles.number)}
                inputMode="decimal"
                value={drafts[field] ?? (cm === null ? '' : metres(cm))}
                placeholder={cm === null ? 'מעורב' : undefined}
                aria-invalid={refusal !== null || undefined}
                onChange={(event) => { setDrafts((current) => ({ ...current, [field]: event.target.value })); }}
                onBlur={() => { commit(keep); }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    commit(keep);
                  }
                }}
              />
            </label>
          );
        })}
      </div>
      {onKindHeight ? <p className={styles.meta}>גובה ברירת מחדל</p> : null}
      <label className={styles.check}>
        <input
          type="checkbox"
          checked={keep}
          onChange={(event) => {
            setKeep(event.target.checked);
            if (event.target.checked) commit(true);
          }}
        />
        {`לשמור גם כברירת המחדל של ${preset.label}`}
      </label>
      {keep ? (
        <p className={styles.hint}>
          {agreed === null
            ? `המידות של ${preset.plural} בבחירה שונות זו מזו. ברירת המחדל תישמר כשיהיה להן ערך אחד.`
            : <bdi>{`ברירת המחדל של ${preset.label} עכשיו: ${size3(standard)}. כך היא מופיעה בספרייה.`}</bdi>}
        </p>
      ) : null}
      {refusal === null ? null : <p className={styles.error} role="alert">{refusal}</p>}
    </div>
  );
}

export function MultiInspector({ doc, ids, onRun, onPickIds, onClear, footer }: {
  doc: EditorDoc;
  ids: string[];
  onRun: (label: string, ops: SiteOp[]) => void;
  /** A kind's chip selects that kind alone (ruling P9). */
  onPickIds: (ids: string[]) => void;
  /** Clears the selection from the panel's own close button; without it the button is not drawn. */
  onClear?: () => void;
  /** Turn, duplicate, lock and remove — SiteEditor's, so their toasts are too. */
  footer?: ReactNode;
}): ReactElement {
  const [gap, setGap] = useState('0.5');
  const [refusal, setRefusal] = useState<string | null>(null);
  const items = ids.map((id) => findItem(doc, id)).filter((entry): entry is EditorItem => entry !== undefined);
  const kinds = KIND_ORDER
    .map((kind) => ({ kind, ids: items.filter((entry) => entry.kind === kind).map((entry) => entry.id) }))
    .filter((entry) => entry.ids.length > 0);
  const unlocked = items.filter((entry) => !entry.locked).length;
  const lockedCount = items.length - unlocked;

  function run(label: string, ops: SiteOp[]): void {
    if (ops.length > 0) onRun(label, ops);
  }

  function arrangeRow(): void {
    const reading = readMetres(gap, GAP_RANGE);
    if (!reading.ok || reading.cm === null) {
      setRefusal(reading.ok ? NOT_A_LENGTH : reading.error);
      return;
    }
    setRefusal(null);
    run('סידור בשורה', rowOps(doc, ids, reading.cm));
  }

  return (
    <>
      <header className={styles.head}>
        <h2 className={styles.headTitle}><bdi>{`נבחרו ${items.length} פריטים`}</bdi></h2>
        <span className={styles.headEnd}>
          <SourceChip source={{ kind: 'manual' }} />
          {onClear === undefined ? null : (
            <Button tone="ghost" size="sm" iconLabel="ביטול הבחירה" onClick={onClear}>
              <Icon name="x" size={14} />
            </Button>
          )}
        </span>
      </header>

      <div className={styles.body}>
        <div className={styles.pills}>
          {kinds.map(({ kind, ids: ofKind }) => (
            <button key={kind} type="button" className={styles.chipButton} onClick={() => { onPickIds(ofKind); }}>
              <Pill tone="neutral">
                {ofKind.length === 1 ? `1 ${SITE_KINDS[kind].label}` : `${ofKind.length} ${SITE_KINDS[kind].plural}`}
              </Pill>
            </button>
          ))}
        </div>

        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>
            מידות לפי סוג
            <span className={styles.sectionMeta}>במטרים</span>
          </h3>
          <p className={styles.hint}>שינוי כאן חל על כל הפריטים מאותו סוג שבבחירה. כל פריט גדל או קטן סביב המרכז שלו.</p>
          {lockedCount > 0 ? (
            <p className={styles.hint}>
              <bdi>{lockedCount === 1 ? 'פריט אחד בבחירה נעול ולא ישתנה.' : `${lockedCount} פריטים בבחירה נעולים ולא ישתנו.`}</bdi>
            </p>
          ) : null}
          {kinds.map(({ kind, ids: ofKind }) => (
            <KindRow key={kind} doc={doc} kind={kind} ids={ofKind} onRun={onRun} />
          ))}
          <button type="button" className={styles.link} onClick={() => { run('חזרה לברירת המחדל', resetSizeOps(doc, ids)); }}>
            החזרת הנבחרים למידות ברירת המחדל
          </button>
        </div>

        <div className={styles.divider} />
        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>יישור וסידור</h3>
          <div className={styles.pills}>
            {ALIGN.map((entry) => (
              <Button
                key={entry.how}
                size="sm"
                iconLabel={entry.label}
                disabled={unlocked < 2}
                onClick={() => { run(entry.label, alignOps(doc, ids, entry.how)); }}
              >
                <EditorIcon name={entry.icon} />
              </Button>
            ))}
            <Button size="sm" iconLabel="פיזור שווה, מזרח־מערב" disabled={unlocked < 3} onClick={() => { run('פיזור שווה', distributeOps(doc, ids, 'x')); }}>
              <EditorIcon name="distributeX" />
            </Button>
            <Button size="sm" iconLabel="פיזור שווה, צפון־דרום" disabled={unlocked < 3} onClick={() => { run('פיזור שווה', distributeOps(doc, ids, 'y')); }}>
              <EditorIcon name="distributeY" />
            </Button>
          </div>
          <div className={styles.controlsRow}>
            <label className={cx(styles.field, styles.gapField)}>
              מרווח בשורה
              <input
                className={cx(styles.input, styles.number)}
                inputMode="decimal"
                value={gap}
                aria-invalid={refusal !== null || undefined}
                onChange={(event) => { setGap(event.target.value); }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    arrangeRow();
                  }
                }}
              />
            </label>
            <Button size="sm" disabled={unlocked < 2} onClick={arrangeRow}>
              <EditorIcon name="row" size={14} />
              סידור בשורה
            </Button>
          </div>
          {refusal === null ? null : <p className={styles.error} role="alert">{refusal}</p>}
        </div>
      </div>

      {footer === undefined ? null : <footer className={styles.foot}>{footer}</footer>}
    </>
  );
}

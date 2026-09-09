'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { BLOCK_ARCHETYPES, CONFIDENCE_THRESHOLD, type BlockArchetype } from '@/lib/classify/types';
import type { ColumnMapping } from '@/lib/classify/map-columns';
import { confirmBlock } from './actions';
import styles from './import-review.module.css';

const ARCHETYPE_LABELS: Record<BlockArchetype, string> = {
  ledger: 'תנועות קופה',
  budget_lines: 'שורות תקציב',
  event_lines: 'הוצאות והכנסות אירוע',
  ticket_rounds: 'סבבי כרטיסים',
  income_channels: 'ערוצי הכנסה',
  member_dues: 'דמי קאמפ',
  obligations: 'חובות וקיזוזים',
  account_balances: 'יתרות בקופות',
  unknown: 'לא זוהה',
};

const MAX_PREVIEW_ROWS = 8;
const MAX_CELL_CHARS = 34;

function columnLabel(index: number): string {
  let n = index;
  let label = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    label = String.fromCharCode(65 + rem) + label;
    n = Math.floor((n - 1) / 26);
  }
  return label;
}

function truncate(text: string): string {
  return text.length > MAX_CELL_CHARS ? `${text.slice(0, MAX_CELL_CHARS)}…` : text;
}

/**
 * UTC-based and locale-free on purpose: a Server Component passes this Date
 * to a Client Component that also renders during SSR, and a locale- or
 * timezone-sensitive formatter can render differently on the server than on
 * the browser that hydrates it.
 */
function formatConfirmedAt(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
}

export interface BlockCardProps {
  blockId: string;
  sheetName: string;
  top: number;
  left: number;
  bottom: number;
  right: number;
  archetype: BlockArchetype;
  confidence: number;
  /** rules | signature | admin — where the current mapping came from. */
  mappingSource: string;
  columnMap: ColumnMapping[];
  rawGrid: string[][];
  needsReview: boolean;
  confirmedBy: string | null;
  confirmedAt: Date | null;
}

/**
 * Shows one detected table alongside what the pipeline concluded about it,
 * and lets an admin correct the archetype and confirm it. Confirming is what
 * populates the layout signature this table is fingerprinted by, so the same
 * table in next year's workbook maps itself.
 *
 * Column-level remapping is out of scope here — a wrong or missing column
 * map still shows as-is; only the archetype is correctable from this screen.
 */
export function BlockCard(props: BlockCardProps) {
  const router = useRouter();
  const [archetype, setArchetype] = useState<BlockArchetype>(props.archetype);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const range = `${columnLabel(props.left)}${props.top}:${columnLabel(props.right)}${props.bottom}`;
  const autoRecognized = props.mappingSource === 'signature';
  const confident = props.confidence >= CONFIDENCE_THRESHOLD;
  const previewRows = props.rawGrid.slice(0, MAX_PREVIEW_ROWS);
  const extraRows = props.rawGrid.length - previewRows.length;

  function onConfirm() {
    setError(null);
    startTransition(async () => {
      try {
        await confirmBlock(props.blockId, archetype, props.columnMap);
        router.refresh();
      } catch {
        setError('האישור נכשל, נסו שוב.');
      }
    });
  }

  return (
    <section className={styles.card}>
      <div className={styles.cardHead}>
        <h2 className={styles.sheetName}>{props.sheetName}</h2>
        <span className={styles.range}>{range}</span>
      </div>

      <div className={styles.meta}>
        <span className={styles.archetypeLabel}>סוג: {ARCHETYPE_LABELS[props.archetype]}</span>
        <span className={`${styles.badge} ${confident ? styles.badgeOk : styles.badgeWarn}`}>
          ביטחון {Math.round(props.confidence * 100)}%
        </span>
        {autoRecognized ? (
          <span className={`${styles.badge} ${styles.badgeOk}`}>זוהה אוטומטית מפריסה מוכרת</span>
        ) : null}
        {props.needsReview ? (
          <span className={`${styles.badge} ${styles.badgeWarn}`}>דורש בדיקה</span>
        ) : null}
      </div>

      <div className={styles.tableWrap}>
        <table>
          <tbody>
            {previewRows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {row.map((cell, colIndex) => (
                  <td key={colIndex}>{truncate(cell)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {extraRows > 0 ? <p className={styles.moreRows}>ועוד {extraRows} שורות</p> : null}

      {props.columnMap.length > 0 ? (
        <p className={styles.mapping}>
          עמודות:{' '}
          {props.columnMap
            .map((m) => `${columnLabel(m.column)} → ${m.field}`)
            .join(' · ')}
        </p>
      ) : (
        <p className={styles.mapping}>לא זוהו עמודות באופן אוטומטי.</p>
      )}

      <div className={styles.form}>
        <label className={styles.formLabel} htmlFor={`archetype-${props.blockId}`}>
          סיווג:
        </label>
        <select
          id={`archetype-${props.blockId}`}
          className={styles.select}
          value={archetype}
          onChange={(event) => setArchetype(event.target.value as BlockArchetype)}
          disabled={pending}
        >
          {BLOCK_ARCHETYPES.map((option) => (
            <option key={option} value={option}>
              {ARCHETYPE_LABELS[option]}
            </option>
          ))}
        </select>
        <button
          type="button"
          className={styles.confirmButton}
          onClick={onConfirm}
          disabled={pending}
        >
          {pending ? 'שומר…' : props.confirmedBy ? 'עדכן אישור' : 'אשר סיווג'}
        </button>
        {props.confirmedBy ? (
          <span className={styles.confirmedNote}>
            אושר ע״י {props.confirmedBy}
            {props.confirmedAt ? ` · ${formatConfirmedAt(props.confirmedAt)}` : ''}
          </span>
        ) : null}
        {error ? <p className={styles.errorNote}>{error}</p> : null}
      </div>
    </section>
  );
}

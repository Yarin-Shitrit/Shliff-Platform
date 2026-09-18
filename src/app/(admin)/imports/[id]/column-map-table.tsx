'use client';

/**
 * A client component because the column map is edited before it is saved: a
 * lead retargets three columns and presses one button, rather than issuing a
 * write per select. The draft is lifted to the detail pane so the footer can
 * send it and can tell whether the pre-flight counts still describe what the
 * server holds.
 *
 * The draft never outlives the mapping it describes: the page keys the detail
 * pane on `mappingKey(archetype, columnMap)`, so a server-side recompute
 * remounts it and the stale draft goes with it.
 *
 * `לא לייבא` is the state of an unmapped column, not a separate flag. There is
 * no third thing to store: the map this screen sends is exactly the set of
 * columns whose toggle is off.
 */
import type { ColumnRow } from '@/lib/import/review';
import type { ColumnMapping } from '@/lib/classify/map-columns';
import type { BlockArchetype } from '@/lib/classify/types';
import {
  FIELD_LABELS, fieldLabel, confidenceWord, NOT_IMPORTED,
  type ConfidenceWord,
} from '@/lib/classify/field-labels';
import { Pill, type PillTone } from '@/components/ui/pill';
import { Icon } from '@/components/ui/icon';
import styles from './import-review.module.css';

const TONE: Record<ConfidenceWord, PillTone> = {
  'בטוח': 'ok',
  'כנראה': 'warn',
  'לא בטוח': 'warn',
};

/** A field a lead chose by hand is a statement, not a guess — confidence 1,
 *  the same value `mapColumns` gives an exact header match. */
const CHOSEN = 1;

export function ColumnMapTable(
  { blockId, archetype, rows, draft, onDraftChange }: {
    blockId: string;
    archetype: BlockArchetype;
    rows: ColumnRow[];
    draft: ColumnMapping[];
    onDraftChange: (next: ColumnMapping[]) => void;
  },
) {
  const byColumn = new Map(draft.map((m) => [m.column, m]));
  const fields = Object.keys(FIELD_LABELS[archetype]);

  function setField(column: number, field: string | null) {
    const without = draft.filter((m) => m.column !== column);
    onDraftChange(
      field === null
        ? without
        : [...without, { column, field, confidence: CHOSEN }]
          .sort((a, b) => a.column - b.column),
    );
  }

  return (
    <section className={styles.section}>
      <h3 className={styles.sectionTitle}>
        <Icon name="columns" size={15} /> העמודות
      </h3>

      <div className={styles.tableScroll}>
        <table className={styles.columnTable}>
          <caption className="sr-only">התאמת העמודות</caption>
          <thead>
            <tr>
              <th scope="col">עמודה בקובץ</th>
              <th scope="col">דוגמאות</th>
              <th scope="col">שדה במערכת</th>
              <th scope="col">ביטחון</th>
              <th scope="col">לא לייבא</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const mapping = byColumn.get(row.column) ?? null;
              const field = mapping?.field ?? null;
              const word = confidenceWord(mapping?.confidence ?? row.confidence);
              const excluded = field === null;
              return (
                <tr key={row.column}>
                  <td>
                    <span className={styles.columnHead}>
                      <span className={styles.columnHeader}>{row.header || '—'}</span>
                      <span className={styles.columnLetter}><bdi>{row.label}</bdi></span>
                    </span>
                  </td>
                  <td className={styles.samples}>
                    {row.samples.length > 0
                      ? row.samples.map((sample, index) => (
                        <span key={index}>
                          {index > 0 ? ' · ' : ''}<bdi>{sample}</bdi>
                        </span>
                      ))
                      : <span className={styles.muted}>אין ערכים</span>}
                  </td>
                  <td>
                    <label className="sr-only" htmlFor={`field-${blockId}-${row.column}`}>
                      השדה של עמודה <bdi>{row.label}</bdi>
                    </label>
                    <select
                      id={`field-${blockId}-${row.column}`}
                      className={styles.fieldSelect}
                      value={field ?? ''}
                      onChange={(event) =>
                        setField(row.column, event.target.value || null)}
                    >
                      <option value="">{NOT_IMPORTED}</option>
                      {fields.map((name) => (
                        <option key={name} value={name}>
                          {fieldLabel(archetype, name)}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td><Pill tone={TONE[word]}>{word}</Pill></td>
                  <td>
                    {/*
                      * Switching the exclusion off has to put some field in
                      * the select, and there is nothing to infer. It offers
                      * the classifier's own answer where there was one and the
                      * first field otherwise — a visible starting point in an
                      * unsaved draft, never a stored guess.
                      */}
                    <button
                      type="button"
                      className={styles.excludeToggle}
                      aria-pressed={excluded}
                      aria-label={`לא לייבא את עמודה ${row.label}`}
                      onClick={() => setField(
                        row.column,
                        excluded ? (row.field ?? fields[0] ?? null) : null,
                      )}
                    >
                      {excluded ? <Icon name="check" size={14} /> : null}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className={styles.sectionNote}>
        עמודה שלא מופתה לא נכתבת — היא נשארת בגיליון ואפשר לחזור אליה.
      </p>
    </section>
  );
}

'use client';

import Image from 'next/image';
import { useMemo, useState } from 'react';
import styles from './data.module.css';

export interface DerivationRow {
  item: string;
  actual: number | null;
  forecast: number | null;
  buffer: number | null;
  why: string;
}
export interface RevisionRow { item: string; a: number; b: number }
export interface Block { label: string; totalRows: number; rows: string[][] }
export interface Sheet { name: string; rowCount: number; colCount: number; blocks: Block[] }
export interface Workbook { file: string; year: string; sheets: Sheet[] }

const ils = (n: number | null) =>
  n === null ? '—' : `${Math.round(n).toLocaleString('he-IL')} ₪`;

export function DataExplorer({
  workbooks, derivation, revisions, revisionYears, arithmetic, actualTotal, forecastTotal,
}: {
  workbooks: Workbook[];
  derivation: DerivationRow[];
  revisions: RevisionRow[];
  revisionYears: [string, string];
  arithmetic: RevisionRow[];
  actualTotal: number;
  forecastTotal: number;
}) {
  const [year, setYear] = useState(workbooks[workbooks.length - 1]?.year ?? '');
  const [query, setQuery] = useState('');
  const [changedOnly, setChangedOnly] = useState(false);
  const [open, setOpen] = useState<Record<string, boolean>>({});

  const rows = useMemo(() => {
    const q = query.trim();
    return derivation.filter((row) => {
      if (q && !row.item.includes(q) && !row.why.includes(q)) return false;
      if (changedOnly && (row.buffer === null || row.buffer === 0)) return false;
      return true;
    });
  }, [derivation, query, changedOnly]);

  const widest = Math.max(1, ...derivation.map((r) => Math.abs(r.buffer ?? 0)));
  const active = workbooks.find((w) => w.year === year);
  const shift = forecastTotal - actualTotal;

  return (
    <div className={styles.shell}>
      <header className={styles.bar}>
        <span className={styles.brand}>
          <Image
            className={styles.mark}
            src="/logo-dark.png"
            alt=""
            width={64}
            height={64}
            priority
          />
          <span className={styles.wordmark}>קופת שליף</span>
        </span>
        <span style={{ color: 'var(--dust)', fontSize: '0.85rem' }}>
          {workbooks.reduce((n, w) => n + w.sheets.length, 0)} גיליונות מתוך {workbooks.length} קבצים
        </span>
        <nav className={styles.years} aria-label="בחירת שנה">
          {workbooks.map((w) => (
            <button
              key={w.year}
              type="button"
              className={styles.year}
              aria-pressed={w.year === year}
              onClick={() => setYear(w.year)}
            >
              {w.year}
            </button>
          ))}
        </nav>
      </header>

      <div className={styles.page}>
        <section className={styles.hero}>
          <h1 className={styles.heroTitle}>התקציב לברן 26 בנוי על מה שקרה בברן 25</h1>
          <p className={styles.heroLede}>
            כל סעיף בתקציב 26 מתחיל מהביצוע בפועל של 25 ומקבל באפר לפי מה שלמדנו באותה שנה.
            הנימוק לכל שינוי כבר רשום בגיליון — כאן הוא מוצג לצד המספרים.
          </p>

          <div className={styles.spine}>
            <div className={styles.spineItem}>
              <span className={styles.spineLabel}>ביצוע בפועל 25׳</span>
              <span className={styles.spineValue}>{ils(actualTotal)}</span>
            </div>
            <span className={styles.spineArrow} aria-hidden="true">←</span>
            <div className={styles.spineItem}>
              <span className={styles.spineLabel}>הפרש</span>
              <span className={`${styles.spineValue} ${shift > 0 ? styles.up : styles.down}`}>
                {shift > 0 ? '+' : ''}{ils(shift)}
              </span>
            </div>
            <span className={styles.spineArrow} aria-hidden="true">←</span>
            <div className={styles.spineItem}>
              <span className={styles.spineLabel}>צפי 26׳</span>
              <span className={styles.spineValue}>{ils(forecastTotal)}</span>
            </div>
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionHead}>
            <h2 className={styles.sectionTitle}>מאיפה הגיע כל סעיף</h2>
            <div className={styles.controls}>
              <input
                className={styles.search}
                type="search"
                placeholder="חיפוש סעיף או נימוק"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label="חיפוש בסעיפי התקציב"
              />
              <button
                type="button"
                className={styles.toggle}
                aria-pressed={changedOnly}
                onClick={() => setChangedOnly((v) => !v)}
              >
                רק סעיפים שהשתנו
              </button>
            </div>
          </div>

          <div className={styles.tableWrap}>
            <table>
              <thead>
                <tr>
                  <th>סעיף</th>
                  <th className={styles.num}>ביצוע 25׳</th>
                  <th className={styles.num}>צפי 26׳</th>
                  <th>באפר</th>
                  <th>למה</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const tone = row.buffer === null || row.buffer === 0
                    ? styles.flat : row.buffer > 0 ? styles.up : styles.down;
                  return (
                    <tr key={row.item}>
                      <td>{row.item}</td>
                      <td className={styles.num}>{ils(row.actual)}</td>
                      <td className={styles.num}>{ils(row.forecast)}</td>
                      <td className={`${styles.bufferCell} ${tone}`}>
                        <span className={styles.num} style={{ display: 'block' }}>
                          {row.forecast === null ? 'ירד' : row.buffer === null ? 'סעיף חדש' : `${row.buffer > 0 ? '+' : ''}${Math.round(row.buffer).toLocaleString('he-IL')}`}
                        </span>
                        {row.buffer ? (
                          <span
                            className={styles.bufferBar}
                            style={{ display: 'block', inlineSize: `${Math.max(4, (Math.abs(row.buffer) / widest) * 100)}%` }}
                          />
                        ) : null}
                      </td>
                      <td className={styles.why}>{row.why || '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {rows.length === 0 ? <p className={styles.empty}>אין סעיף שמתאים לחיפוש.</p> : null}
        </section>

        {(revisions.length > 0 || arithmetic.length > 0) && (
          <section className={styles.section}>
            <div className={styles.sectionHead}>
              <h2 className={styles.sectionTitle}>דברים שדורשים הכרעה</h2>
            </div>

            {revisions.length > 0 && (
              <div className={styles.flag}>
                <p className={styles.flagTitle}>
                  שתי גרסאות של הצפי לברן 26 — {revisions.length} סעיפים שונים
                </p>
                <p className={styles.flagBody}>
                  הצפי מופיע גם בקובץ {revisionYears[0]} וגם בקובץ {revisionYears[1]}, והמספרים
                  לא זהים. צריך להחליט איזו גרסה קובעת.
                </p>
                <div className={styles.tableWrap} style={{ marginBlockStart: '0.8rem' }}>
                  <table>
                    <thead>
                      <tr>
                        <th>סעיף</th>
                        <th className={styles.num}>גרסה בקובץ {revisionYears[0]}</th>
                        <th className={styles.num}>גרסה בקובץ {revisionYears[1]}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {revisions.map((r) => (
                        <tr key={r.item}>
                          <td>{r.item}</td>
                          <td className={styles.num}>{ils(r.a)}</td>
                          <td className={styles.num}>{ils(r.b)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {arithmetic.map((r) => (
              <div className={styles.flag} key={r.item}>
                <p className={styles.flagTitle}>החשבון בשורה ״{r.item}״ לא מסתדר</p>
                <p className={styles.flagBody}>
                  כמות × עלות ליחידה נותן {ils(r.a)}, אבל בעמודת הסה״כ רשום {ils(r.b)}.
                </p>
              </div>
            ))}
          </section>
        )}

        <section className={styles.section}>
          <div className={styles.sectionHead}>
            <h2 className={styles.sectionTitle}>הגיליונות בקובץ {year}</h2>
            <p className={styles.sectionNote}>
              המערכת מזהה כל טבלה בנפרד, גם כשיש כמה טבלאות באותו גיליון.
            </p>
          </div>

          {active?.sheets.map((sheet) => {
            const key = `${active.year}/${sheet.name}`;
            const isOpen = open[key] ?? false;
            return (
              <div className={styles.sheet} key={key}>
                <button
                  type="button"
                  className={styles.sheetHead}
                  aria-expanded={isOpen}
                  onClick={() => setOpen((o) => ({ ...o, [key]: !isOpen }))}
                >
                  <span className={`${styles.chev} ${isOpen ? styles.chevOpen : ''}`} aria-hidden="true">›</span>
                  <span className={styles.sheetName}>{sheet.name}</span>
                  <span className={styles.sheetMeta}>
                    {sheet.blocks.length} טבלאות · {sheet.rowCount}×{sheet.colCount}
                  </span>
                </button>
                {isOpen && (
                  <div className={styles.sheetBody}>
                    {sheet.blocks.map((block) => (
                      <div key={block.label}>
                        <p className={styles.blockLabel}>{block.label} · {block.totalRows} שורות</p>
                        <div className={styles.tableWrap}>
                          <table className={styles.grid}>
                            <tbody>
                              {block.rows.map((row, i) => (
                                <tr key={i}>{row.map((cell, j) => <td key={j}>{cell}</td>)}</tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        {block.totalRows > block.rows.length ? (
                          <p className={styles.more}>ועוד {block.totalRows - block.rows.length} שורות</p>
                        ) : null}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </section>
      </div>
    </div>
  );
}

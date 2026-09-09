import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { extractWorkbook } from '@/lib/xlsx/extract';
import { detectBlocks } from '@/lib/blocks/detect';
import type { SheetGrid } from '@/lib/xlsx/types';
import type { CellRange } from '@/lib/blocks/types';

export const dynamic = 'force-dynamic';

const DIR = join(process.cwd(), 'docs', 'reference-data');
const FILES = [
  "קופת קאמפ 23'-24'.xlsx",
  'קופת קאמפ 25’.xlsx',
  'קופת קאמפ 2026.xlsx',
];

function colLabel(index: number): string {
  let n = index;
  let label = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    label = String.fromCharCode(65 + rem) + label;
    n = Math.floor((n - 1) / 26);
  }
  return label;
}

function slice(grid: SheetGrid, range: CellRange, maxRows: number): string[][] {
  const rows: string[][] = [];
  const last = Math.min(range.bottom, range.top + maxRows - 1);
  for (let r = range.top; r <= last; r += 1) {
    const cells: string[] = [];
    for (let c = range.left; c <= range.right; c += 1) {
      const raw = grid.cells[r - 1]?.[c - 1]?.text ?? '';
      cells.push(raw.length > 40 ? `${raw.slice(0, 40)}…` : raw);
    }
    rows.push(cells);
  }
  return rows;
}

/** Compares the two revisions of תקציב קאמפ ברן 26 that exist in different files. */
function budgetConflict(workbooks: { file: string; sheets: SheetGrid[] }[]) {
  const revisions = workbooks
    .map((w) => ({ file: w.file, sheet: w.sheets.find((s) => s.name === 'תקציב קאמפ ברן 26') }))
    .filter((r): r is { file: string; sheet: SheetGrid } => Boolean(r.sheet));
  if (revisions.length < 2) return null;

  const read = (grid: SheetGrid) => {
    const map = new Map<string, string>();
    for (let r = 3; r <= Math.min(grid.rowCount, 31); r += 1) {
      const item = grid.cells[r - 1]?.[0]?.text ?? '';
      if (!item) continue;
      const qty = grid.cells[r - 1]?.[1]?.text ?? '';
      const unit = grid.cells[r - 1]?.[2]?.text ?? '';
      const total = grid.cells[r - 1]?.[3]?.text ?? '';
      map.set(item, `${qty} × ${unit} = ${total}`);
    }
    return map;
  };

  const a = read(revisions[0].sheet);
  const b = read(revisions[1].sheet);
  const rows: { item: string; a: string; b: string }[] = [];
  for (const [item, va] of a) {
    const vb = b.get(item);
    if (vb !== undefined && vb !== va) rows.push({ item, a: va, b: vb });
  }
  return { fileA: revisions[0].file, fileB: revisions[1].file, rows };
}

export default async function DataPage() {
  const workbooks = await Promise.all(
    FILES.map(async (file) => ({
      file,
      sheets: await extractWorkbook(readFileSync(join(DIR, file))),
    })),
  );

  const totalSheets = workbooks.reduce((n, w) => n + w.sheets.length, 0);
  const analysed = workbooks.map((w) => ({
    ...w,
    sheets: w.sheets.map((grid) => ({ grid, blocks: detectBlocks(grid) })),
  }));
  const totalBlocks = analysed.reduce(
    (n, w) => n + w.sheets.reduce((m, s) => m + s.blocks.length, 0),
    0,
  );
  const conflict = budgetConflict(workbooks);

  return (
    <main>
      <h1>הנתונים שזוהו בקבצים</h1>
      <p className="muted">
        {workbooks.length} קבצים · {totalSheets} גיליונות · {totalBlocks} טבלאות זוהו
      </p>

      {conflict && conflict.rows.length > 0 ? (
        <section className="card">
          <h2>⚠️ שתי גרסאות לאותו תקציב — תקציב קאמפ ברן 26</h2>
          <p className="muted">
            אותו גיליון קיים בשני קבצים, ו־{conflict.rows.length} שורות אינן זהות.
            צריך להחליט איזו גרסה קובעת.
          </p>
          <div className="scroll-x">
            <table>
              <thead>
                <tr>
                  <th>סעיף</th>
                  <th>{conflict.fileA}</th>
                  <th>{conflict.fileB}</th>
                </tr>
              </thead>
              <tbody>
                {conflict.rows.map((row) => (
                  <tr key={row.item}>
                    <td>{row.item}</td>
                    <td className="badge-warn">{row.a}</td>
                    <td className="badge-warn">{row.b}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {analysed.map((workbook) => (
        <section key={workbook.file}>
          <h2>{workbook.file}</h2>
          {workbook.sheets.map(({ grid, blocks }) => (
            <div key={grid.name} className="card">
              <h3>
                {grid.name}{' '}
                <span className="muted">
                  — {blocks.length} טבלאות · {grid.rowCount}×{grid.colCount} תאים
                </span>
              </h3>
              {blocks.map((range) => (
                <div key={`${range.top}-${range.left}`} style={{ marginBlockEnd: '1rem' }}>
                  <p className="muted">
                    טווח {colLabel(range.left)}
                    {range.top}:{colLabel(range.right)}
                    {range.bottom}
                  </p>
                  <div className="scroll-x">
                    <table>
                      <tbody>
                        {slice(grid, range, 8).map((row, i) => (
                          <tr key={i}>
                            {row.map((cell, j) => (
                              <td key={j}>{cell}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {range.bottom - range.top + 1 > 8 ? (
                    <p className="muted">…ועוד {range.bottom - range.top + 1 - 8} שורות</p>
                  ) : null}
                </div>
              ))}
            </div>
          ))}
        </section>
      ))}
    </main>
  );
}

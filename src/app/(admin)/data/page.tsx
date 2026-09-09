import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { extractWorkbook } from '@/lib/xlsx/extract';
import { detectBlocks } from '@/lib/blocks/detect';
import { parseNumber } from '@/lib/coerce/number';
import { normalizeHebrew } from '@/lib/text/normalize';
import type { SheetGrid } from '@/lib/xlsx/types';
import { colLabel } from '@/lib/xlsx/col-label';
import { DataExplorer, type Workbook, type DerivationRow, type RevisionRow } from './data-explorer';

export const dynamic = 'force-dynamic';

const DIR = join(process.cwd(), 'docs', 'reference-data');
const FILES = [
  { file: "קופת קאמפ 23'-24'.xlsx", year: "23׳–24׳" },
  { file: 'קופת קאמפ 25’.xlsx', year: '25׳' },
  { file: 'קופת קאמפ 2026.xlsx', year: '26׳' },
];

const MAX_PREVIEW_ROWS = 10;
const MAX_CELL_CHARS = 34;

interface BudgetLine {
  item: string;
  qty: number | null;
  unit: number | null;
  total: number | null;
  why: string;
}

/**
 * Reads the line items of a budget sheet.
 *
 * Stops at the sheet's own סה״כ row: everything below it is summary and
 * fundraising blocks, and including those would double-count the budget.
 */
function budgetLines(grid: SheetGrid): BudgetLine[] {
  const lines: BudgetLine[] = [];
  for (let r = 3; r <= grid.rowCount; r += 1) {
    const cells = [0, 1, 2, 3].map((c) => grid.cells[r - 1]?.[c]?.text ?? '');
    if (cells.some((text) => normalizeHebrew(text).includes('סה"כ'))) break;
    const item = cells[0];
    if (!item) continue;
    lines.push({
      item,
      qty: parseNumber(grid.cells[r - 1]?.[1]?.value ?? null),
      unit: parseNumber(grid.cells[r - 1]?.[2]?.value ?? null),
      total: parseNumber(grid.cells[r - 1]?.[3]?.value ?? null),
      why: grid.cells[r - 1]?.[4]?.text ?? '',
    });
  }
  return lines;
}

function totalsByItem(lines: BudgetLine[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const line of lines) {
    if (line.total !== null) out.set(normalizeHebrew(line.item), line.total);
  }
  return out;
}

export default async function DataPage() {
  const raw = await Promise.all(
    FILES.map(async ({ file, year }) => ({
      file,
      year,
      sheets: await extractWorkbook(readFileSync(join(DIR, file))),
    })),
  );

  const findSheet = (name: string): SheetGrid | undefined => {
    for (const w of raw) {
      const found = w.sheets.find((s) => s.name === name);
      if (found) return found;
    }
    return undefined;
  };

  // ברן 26 is a forecast derived from ברן 25 actuals plus buffers learned that year.
  // Column E of the 26 sheet records why each line moved, so the derivation is data.
  const actualSheet = findSheet('תקציב קאמפ ברן 25');
  const forecastSheet = raw
    .find((w) => w.year === '26׳')
    ?.sheets.find((s) => s.name === 'תקציב קאמפ ברן 26');

  const actualLines = actualSheet ? budgetLines(actualSheet) : [];
  const actuals = totalsByItem(actualLines);
  const forecastLines = forecastSheet ? budgetLines(forecastSheet) : [];

  const derivation: DerivationRow[] = forecastLines
    .filter((line) => line.total !== null)
    .map((line) => {
      const actual = actuals.get(normalizeHebrew(line.item)) ?? null;
      return {
        item: line.item,
        actual,
        forecast: line.total,
        buffer: actual === null || line.total === null ? null : line.total - actual,
        why: line.why,
      };
    });

  // Items that existed in 25 but were not carried into the 26 forecast. Without
  // these the two totals cannot be reconciled against each other.
  const carried = new Set(forecastLines.map((l) => normalizeHebrew(l.item)));
  for (const line of actualLines) {
    if (line.total === null || carried.has(normalizeHebrew(line.item))) continue;
    derivation.push({
      item: line.item,
      actual: line.total,
      forecast: null,
      buffer: -line.total,
      why: 'לא נכלל בתקציב 26׳',
    });
  }

  // The same forecast exists in two files. Compare them line by line.
  const revisionSheets = raw
    .map((w) => ({ year: w.year, sheet: w.sheets.find((s) => s.name === 'תקציב קאמפ ברן 26') }))
    .filter((r): r is { year: string; sheet: SheetGrid } => Boolean(r.sheet));

  const revisions: RevisionRow[] = [];
  let revisionYears: [string, string] = ['', ''];
  if (revisionSheets.length >= 2) {
    const [first, second] = revisionSheets;
    revisionYears = [first.year, second.year];
    const a = totalsByItem(budgetLines(first.sheet));
    for (const line of budgetLines(second.sheet)) {
      const va = a.get(normalizeHebrew(line.item));
      if (va !== undefined && line.total !== null && va !== line.total) {
        revisions.push({ item: line.item, a: va, b: line.total });
      }
    }
  }

  // Rows where quantity × unit cost does not equal the stated total.
  const arithmetic: RevisionRow[] = forecastLines
    .filter((l) => l.qty !== null && l.unit !== null && l.total !== null
      && Math.abs(l.qty * l.unit - l.total) > 0.5)
    .map((l) => ({ item: l.item, a: l.qty! * l.unit!, b: l.total! }));

  const workbooks: Workbook[] = raw.map((w) => ({
    file: w.file,
    year: w.year,
    sheets: w.sheets.map((grid) => {
      const blocks = detectBlocks(grid);
      return {
        name: grid.name,
        rowCount: grid.rowCount,
        colCount: grid.colCount,
        blocks: blocks.map((range) => {
          const rows: string[][] = [];
          const last = Math.min(range.bottom, range.top + MAX_PREVIEW_ROWS - 1);
          for (let r = range.top; r <= last; r += 1) {
            const line: string[] = [];
            for (let c = range.left; c <= range.right; c += 1) {
              const text = grid.cells[r - 1]?.[c - 1]?.text ?? '';
              line.push(text.length > MAX_CELL_CHARS ? `${text.slice(0, MAX_CELL_CHARS)}…` : text);
            }
            rows.push(line);
          }
          return {
            label: `${colLabel(range.left)}${range.top}:${colLabel(range.right)}${range.bottom}`,
            totalRows: range.bottom - range.top + 1,
            rows,
          };
        }),
      };
    }),
  }));

  const actualTotal = actualLines.reduce((n, l) => n + (l.total ?? 0), 0);
  const forecastTotal = forecastLines.reduce((n, l) => n + (l.total ?? 0), 0);

  return (
    <DataExplorer
      workbooks={workbooks}
      derivation={derivation}
      revisions={revisions}
      revisionYears={revisionYears}
      arithmetic={arithmetic}
      actualTotal={actualTotal}
      forecastTotal={forecastTotal}
    />
  );
}

import ExcelJS from 'exceljs';
import type { Cell, CellValue, SheetGrid } from './types';

interface RichTextRun {
  text: string;
}

function unwrap(raw: unknown): CellValue {
  if (raw === null || raw === undefined) return null;
  if (raw instanceof Date) return raw;
  if (typeof raw === 'number' || typeof raw === 'boolean') return raw;
  if (typeof raw === 'string') return raw.trim();

  const obj = raw as Record<string, unknown>;
  // Formula cell: use the cached result, never the formula text.
  if ('result' in obj) return unwrap(obj.result);
  if ('richText' in obj) {
    return (obj.richText as RichTextRun[]).map((run) => run.text).join('').trim();
  }
  // Hyperlink cell.
  if ('text' in obj) return unwrap(obj.text);
  // Error cell (#REF!, #DIV/0!) — treated as blank.
  return null;
}

function toText(value: CellValue): string {
  if (value === null) return '';
  if (value instanceof Date) return value.toISOString();
  return String(value).trim();
}

/**
 * Reads an .xlsx buffer into a dense, 1-indexed grid per sheet.
 *
 * Every sheet is materialized in full, including blank cells, because block
 * detection operates on the occupancy pattern of the whole grid.
 */
export async function extractWorkbook(buffer: Buffer): Promise<SheetGrid[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);

  return workbook.worksheets.map((worksheet, index) => {
    const rowCount = worksheet.rowCount;
    const colCount = worksheet.columnCount;
    const cells: Cell[][] = [];

    for (let row = 1; row <= rowCount; row += 1) {
      const rowCells: Cell[] = [];
      for (let col = 1; col <= colCount; col += 1) {
        const source = worksheet.getCell(row, col);
        const value = unwrap(source.value);
        rowCells.push({
          row,
          col,
          value,
          text: toText(value),
          isMerged: source.isMerged,
        });
      }
      cells.push(rowCells);
    }

    return { name: worksheet.name, index, rowCount, colCount, cells };
  });
}

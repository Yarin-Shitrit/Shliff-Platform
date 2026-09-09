export type CellValue = string | number | boolean | Date | null;

export interface Cell {
  /** 1-indexed row. */
  row: number;
  /** 1-indexed column. */
  col: number;
  /** Typed value, with formulas resolved to their computed result. */
  value: CellValue;
  /** Trimmed string form; empty string when the cell is blank. */
  text: string;
  isMerged: boolean;
}

export interface SheetGrid {
  name: string;
  /** Position of the sheet within the workbook, 0-indexed. */
  index: number;
  rowCount: number;
  colCount: number;
  /** Addressed as cells[row - 1][col - 1]. */
  cells: Cell[][];
}

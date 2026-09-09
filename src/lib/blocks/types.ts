/** Inclusive, 1-indexed rectangle of cells. */
export interface CellRange {
  top: number;
  left: number;
  bottom: number;
  right: number;
}

export interface DetectOptions {
  /** Consecutive empty columns required to cut vertically. */
  minGapCols?: number;
  /** Consecutive empty rows required to cut horizontally. */
  minGapRows?: number;
}

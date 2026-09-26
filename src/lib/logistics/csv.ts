import { fromAgorot } from '@/lib/money';
import { placeOf, type WarehouseRow } from './warehouse';
import type { AcquisitionRow } from './acquisitions';
import {
  CAMP_WIDE_LABEL, CATEGORY_LABELS, CONDITION_LABELS, SOURCE_LABELS, STATUS_LABELS,
} from './labels';

/**
 * The two ייצוא buttons, as pure functions over rows.
 *
 * The rows are built here rather than in the route handlers so that what a
 * lead downloads can be tested without mocking a database, a session and a
 * `Request` — the part worth testing is the shape of the file and the
 * escaping, and neither needs any of those.
 *
 * `csvCell` is deliberately a second copy of the one inside
 * `members/export/route.ts`. That one is not exported, and its file belongs to
 * another area — extracting it into a shared module is that area's call, not
 * something to do from here. If this grows a third copy, that is the moment
 * to ask for the extraction rather than to write it again.
 */

/**
 * Quotes a field, and neutralises spreadsheet formula injection.
 *
 * A cell beginning `=`, `+`, `-` or `@` is executed as a formula by Excel and
 * by Sheets when the file is opened, so an item somebody named `=cmd|...`
 * would run on the machine of whoever opened the export. The leading
 * apostrophe makes it text; it is visible in the cell and that is the right
 * trade.
 */
export function csvCell(value: string): string {
  const text = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return `"${text.replace(/"/g, '""')}"`;
}

/**
 * Rows to a file. CRLF because that is what Excel expects, and a BOM because
 * without one Excel reads a UTF-8 Hebrew file as mojibake — which is the
 * entire file rendered unreadable, not a cosmetic issue.
 */
export function csvDocument(rows: readonly (readonly string[])[]): string {
  return `﻿${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}`;
}

/** An empty cell, for a value that is genuinely absent. */
const NONE = '';

export function warehouseCsvRows(items: readonly WarehouseRow[]): string[][] {
  return [
    ['שם הפריט', 'קטגוריה', 'כמות', 'ארגז', 'מיקום במחסן', 'מצב', 'הערות', 'מקור הנתון', 'עודכן בידי'],
    ...items.map((item) => [
      item.name,
      CATEGORY_LABELS[item.category],
      String(item.quantity),
      /* The box by name, and the place as the screen says it — box, the
         box's place, the item's own detail — so a lead reading the file in
         the container looks for the same thing the table told them to. */
      item.box?.name ?? NONE,
      placeOf(item) ?? NONE,
      CONDITION_LABELS[item.condition],
      item.notes ?? NONE,
      /* R11 travels with the file. A spreadsheet that has left the app is
         exactly where a number loses its provenance, and this column is the
         one thing that stops the export being read as an import. */
      'נרשם ידנית',
      item.updatedBy ?? NONE,
    ]),
  ];
}

/**
 * `seasonName` is the season the file was exported for. A camp-wide row is in
 * that file because it belongs to every season, and the column says which
 * rows those are — otherwise a generator needed every year reads as one more
 * thing this year's list asked for.
 */
export function acquisitionsCsvRows(rows: readonly AcquisitionRow[], seasonName: string): string[][] {
  return [
    ['שם הפריט', 'שייך ל', 'קטגוריה', 'כמות דרושה', 'דרך ההשגה', 'אומדן', 'בפועל', 'אחראי', 'משאיל', 'סטטוס', 'מקור הנתון'],
    ...rows.map((row) => [
      row.name,
      row.seasonId === null ? CAMP_WIDE_LABEL : seasonName,
      CATEGORY_LABELS[row.category],
      String(row.quantityNeeded),
      SOURCE_LABELS[row.source],
      /* `fromAgorot`, not a formatted amount: a spreadsheet column has to be
         a number a reader can sum, and `4,850 ₪` is text. Null stays empty —
         "nobody has priced it" is not zero, and a zero here would be a figure
         somebody could total. */
      row.estimatedAgorot === null ? NONE : fromAgorot(row.estimatedAgorot),
      row.actualAgorot === null ? NONE : fromAgorot(row.actualAgorot),
      row.assignee?.name ?? NONE,
      row.lender?.name ?? NONE,
      STATUS_LABELS[row.status],
      'נרשם ידנית',
    ]),
  ];
}

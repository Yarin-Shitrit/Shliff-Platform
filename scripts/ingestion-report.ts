import { createTestDb } from '@/test/db';
import { uploads, sheets, blocks } from '@/db/schema/source';
import { runImport } from '@/lib/import/run-import';
import { FIXTURES, fixtureBuffer } from '@/test/fixtures';
import { colLabel } from '@/lib/xlsx/col-label';
import { eq } from 'drizzle-orm';
import { writeFileSync } from 'node:fs';

function a1Range(top: number, left: number, bottom: number, right: number): string {
  return `${colLabel(left)}${top}:${colLabel(right)}${bottom}`;
}

const PREAMBLE = [
  '## איך לקרוא את הדוח',
  '',
  'דוח זה נוצר אוטומטית מתהליך קליטת קובצי האקסל, ומיועד לבדיקה מול הקבצים המקוריים.',
  '',
  '- **unknown (לא מזוהה)** — קטע טבלה ללא שורת כותרת. המערכת נמנעת במכוון מלנחש '
    + 'סיווג כשאין לה על סמך מה, ולא מדובר בתקלה. ברוב המקרים אלה שורות סיכום/סה״כ '
    + 'בודדות שנשארו מבודדות אחרי זיהוי גבולות הטבלאות בגיליון.',
  '- **רמת ביטחון (confidence) מתחת ל-0.50** — הסיווג אינו ודאי מספיק, והבלוק '
    + 'מסומן אוטומטית לבדיקה ידנית לפני שהוא נחשב מאושר; הוא לא נקלט כעובדה בלי בדיקה.',
  '- כל שורה מפרטת את הגיליון, טווח התאים (בסימון A1 הרגיל, לחיפוש ישיר בקובץ '
    + 'המקורי), הסיווג שזוהה ורמת הביטחון.',
  '',
].join('\n');

/**
 * Wrapped in an async function rather than using top-level await: this repo's
 * package.json has no `"type": "module"`, so tsx transforms a bare `.ts`
 * file as CommonJS, where top-level await is not legal syntax. The body is
 * otherwise unchanged from a top-level-await version of the same script.
 */
async function main(): Promise<void> {
  const db = await createTestDb();
  const lines: string[] = ['# Ingestion report', '', PREAMBLE];

  let n = 0;
  for (const filename of [FIXTURES.y2324, FIXTURES.y25, FIXTURES.y26]) {
    n += 1;
    const [row] = await db.insert(uploads).values({
      filename, sha256: String(n).repeat(64).slice(0, 64),
      storageKey: `k${n}`, sizeBytes: 1, uploadedBy: 'report',
    }).returning();
    const report = await runImport(db, row.id, fixtureBuffer(filename));

    lines.push(`## ${filename}`, '');
    lines.push(`- sheets: ${report.sheetCount}`);
    lines.push(`- blocks: ${report.blockCount}`);
    lines.push(`- needs review: ${report.needsReview}`, '');
    lines.push('| sheet | range | archetype | confidence |');
    lines.push('| --- | --- | --- | --- |');

    const rows = await db.select({ b: blocks, s: sheets })
      .from(blocks).innerJoin(sheets, eq(blocks.sheetId, sheets.id))
      .where(eq(sheets.uploadId, row.id));

    for (const { b, s } of rows.sort((x, y) => x.s.index - y.s.index || x.b.top - y.b.top)) {
      lines.push(
        `| ${s.name} | ${a1Range(b.top, b.left, b.bottom, b.right)} | ${b.archetype} | ${Number(b.confidence).toFixed(2)} |`,
      );
    }
    lines.push('');
  }

  writeFileSync('docs/ingestion-report.md', lines.join('\n'), 'utf8');
  console.log('wrote docs/ingestion-report.md');
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

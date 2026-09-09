# Shliff Platform — Plan 01: Ingestion Pipeline & Import Review

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upload any of the camp's real Excel workbooks, have every table inside every sheet detected, classified and column-mapped automatically, and let an admin confirm or correct that mapping in a Hebrew RTL review screen — with corrections remembered as reusable layout signatures.

**Architecture:** A pure-function library pipeline (`extract → detect → coerce → classify → map`) with no database or framework dependencies, wrapped by a thin persistence and UI layer. Block *geometry* is found by recursive XY-cut; block *meaning* by a weighted Hebrew/English keyword lexicon. Every stage is tested against the three real workbooks in `docs/reference-data/`.

**Tech Stack:** Next.js 15 (App Router) · TypeScript 5 · Drizzle ORM · Postgres (Neon in production, PGlite in tests) · ExcelJS · Auth.js · Vitest

**Spec:** `docs/superpowers/specs/2026-09-09-camp-data-platform-design.md`

## Scope

This plan implements spec delivery steps **1a** and the deterministic half of **1b**. It deliberately **excludes**:

- **LLM classification fallback** (spec §3). The rule-based classifier plus the human review screen covers every block; the model fallback is an optimization that belongs with Plan 02, where the Anthropic SDK bindings will be taken from the `claude-api` skill rather than from memory.
- **The canonical model** (`transaction`, `budget`, `event`, …) and the commit pipeline — spec step 1c, Plan 02.
- **Conflict resolution, revisions, validation rules** — spec steps 1d and §6, Plan 03.
- **The general audit log** (spec requirement 32). This plan records `confirmedBy`/`confirmedAt` on blocks and signatures, which covers every mutation it introduces; the append-only log over canonical records arrives with those records in Plan 02.

What this plan delivers on its own: a working, authenticated admin tool that proves the hardest part of the system — that these specific messy workbooks can be parsed correctly.

## Global Constraints

Copied verbatim from the spec; every task's requirements implicitly include these.

- **Correctness over performance.** Scale is ~19 sheets, ~50 blocks, ~700 rows. No design decision may trade clarity for speed.
- **Never guess.** Ambiguous values are stored raw and flagged, never coerced by assumption. Dates that cannot be parsed unambiguously (`01/052024`) are stored as raw text and flagged.
- **`?` and equivalent placeholders coerce to null with an `is_unknown` flag, never to zero.**
- **Original text is always preserved** alongside any coerced value.
- **Sign convention is detected per column, not per file.**
- **Column order must not affect classification.**
- **All routes require authentication.** No page is public. UI hiding is never the enforcement mechanism.
- **Interface is Hebrew, right-to-left**, using CSS logical properties (`margin-inline-start`, not `margin-left`).
- **Uploaded files are stored privately.** Never a public bucket.
- **Validation failures are warnings, never hard blocks.**
- **The reference workbooks in `docs/reference-data/` are read-only test fixtures.** Never modify them.

## File Structure

```
src/
  lib/
    text/normalize.ts          Hebrew punctuation normalization (Task 2)
    xlsx/types.ts              Cell, SheetGrid types (Task 3)
    xlsx/extract.ts            xlsx buffer → SheetGrid[] (Task 3)
    coerce/number.ts           parseNumber, detectSignConvention (Task 4)
    coerce/quantity.ts         parseQuantity (Task 4)
    coerce/date.ts             parseDate (Task 4)
    blocks/types.ts            CellRange (Task 5)
    blocks/detect.ts           recursive XY-cut (Task 5)
    classify/types.ts          BlockArchetype, Classification (Task 6)
    classify/lexicon.ts        weighted keyword tables (Task 6)
    classify/rules.ts          classifyBlock (Task 6)
    classify/header.ts         findHeaderRow (Task 7)
    classify/map-columns.ts    mapColumns (Task 7)
    classify/signature.ts      layoutFingerprint (Task 8)
    import/run-import.ts       pipeline orchestration (Task 10)
    storage/index.ts           blob storage interface (Task 11)
  db/
    schema/source.ts           upload, sheet, block, blockMapping, layoutSignature (Task 9)
    schema/auth.ts             user (Task 12)
    index.ts                   drizzle client (Task 9)
  test/fixtures.ts             real workbook loaders (Task 3)
  app/
    layout.tsx                 RTL shell (Task 13)
    (admin)/upload/page.tsx    upload screen (Task 13)
    (admin)/imports/[id]/page.tsx  review screen (Task 14)
    api/uploads/route.ts       upload endpoint (Task 11)
```

Every module under `src/lib/` is a pure function library with no database, network or framework imports. This is what makes the pipeline testable against the real workbooks without infrastructure.

---

### Task 1: Project scaffold and test harness

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.env.example`, `.gitignore` (already exists — extend)
- Create: `src/lib/version.ts`
- Test: `src/lib/version.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: a working `npm test` command running Vitest; TypeScript path alias `@/*` → `src/*`

- [ ] **Step 1: Scaffold the Next.js app**

Run from the repository root. Answer the prompts as shown, or pass the flags:

```bash
npx create-next-app@latest . --typescript --app --eslint --no-tailwind --no-src-dir --import-alias "@/*" --use-npm --skip-install
```

This will refuse to run in a non-empty directory; if so, scaffold into a temp dir and copy in:

```bash
npx create-next-app@latest /tmp/shliff-scaffold --typescript --app --eslint --no-tailwind --no-src-dir --import-alias "@/*" --use-npm --skip-install
cp -r /tmp/shliff-scaffold/{app,public,next.config.ts,tsconfig.json,next-env.d.ts,eslint.config.mjs,package.json} .
rm -rf /tmp/shliff-scaffold
mkdir -p src/lib && git mv app src/app 2>/dev/null || mv app src/app
```

- [ ] **Step 2: Install dependencies**

```bash
npm install exceljs drizzle-orm postgres next-auth@beta @auth/drizzle-adapter argon2
npm install -D vitest @vitest/coverage-v8 drizzle-kit @electric-sql/pglite @types/node tsx
```

- [ ] **Step 3: Configure TypeScript paths and Vitest**

Edit `tsconfig.json` so `compilerOptions.paths` contains:

```json
{
  "baseUrl": ".",
  "paths": { "@/*": ["./src/*"] }
}
```

Create `vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    testTimeout: 20_000,
  },
  resolve: {
    alias: { '@': resolve(__dirname, './src') },
  },
});
```

Add to `package.json` scripts:

```json
{
  "test": "vitest run",
  "test:watch": "vitest",
  "typecheck": "tsc --noEmit"
}
```

- [ ] **Step 4: Write the failing smoke test**

Create `src/lib/version.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { PIPELINE_VERSION } from '@/lib/version';

describe('pipeline version', () => {
  it('is a positive integer', () => {
    expect(Number.isInteger(PIPELINE_VERSION)).toBe(true);
    expect(PIPELINE_VERSION).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 5: Run it and confirm it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '@/lib/version'`

- [ ] **Step 6: Implement**

Create `src/lib/version.ts`:

```ts
/**
 * Incremented whenever parsing, detection, or classification logic changes in a
 * way that could reinterpret previously committed data. Stored on every block so
 * a re-parse is an explicit, reviewable action rather than a silent rewrite.
 */
export const PIPELINE_VERSION = 1;
```

- [ ] **Step 7: Run tests and confirm they pass**

Run: `npm test`
Expected: PASS — 1 test

- [ ] **Step 8: Create `.env.example`**

```bash
DATABASE_URL="postgres://user:password@localhost:5432/shliff"
AUTH_SECRET="generate-with-openssl-rand-base64-32"
BLOB_READ_WRITE_TOKEN=""
STORAGE_DRIVER="local"
LOCAL_STORAGE_DIR="./.uploads"
```

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "chore: scaffold Next.js app with Vitest test harness"
```

---

### Task 2: Hebrew text normalization

Hebrew in these workbooks uses inconsistent punctuation: `סה״כ` appears with the Hebrew gershayim (U+05F4) and with an ASCII double quote; `ברן 25׳` uses geresh (U+05F3) where another sheet uses an apostrophe. Classification compares header strings, so this must be normalized first or every lexicon match becomes unreliable.

**Files:**
- Create: `src/lib/text/normalize.ts`
- Test: `src/lib/text/normalize.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `normalizeHebrew(input: string): string`

- [ ] **Step 1: Write the failing test**

Create `src/lib/text/normalize.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { normalizeHebrew } from '@/lib/text/normalize';

describe('normalizeHebrew', () => {
  it('unifies gershayim variants', () => {
    expect(normalizeHebrew('סה״כ')).toBe(normalizeHebrew('סה"כ'));
    expect(normalizeHebrew('עו״ש')).toBe(normalizeHebrew('עו"ש'));
  });

  it('unifies geresh and apostrophe variants', () => {
    expect(normalizeHebrew('ברן 25׳')).toBe(normalizeHebrew("ברן 25'"));
    expect(normalizeHebrew('קופת קאמפ 25’')).toBe(normalizeHebrew("קופת קאמפ 25'"));
  });

  it('collapses whitespace and non-breaking spaces', () => {
    expect(normalizeHebrew('  סוג   הוצאה  ')).toBe('סוג הוצאה');
  });

  it('returns empty string for empty input', () => {
    expect(normalizeHebrew('')).toBe('');
    expect(normalizeHebrew('   ')).toBe('');
  });

  it('leaves plain text unchanged', () => {
    expect(normalizeHebrew('SuperNature 18.7')).toBe('SuperNature 18.7');
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run src/lib/text/normalize.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement**

Create `src/lib/text/normalize.ts`:

```ts
/** U+05F4 gershayim, U+201C/U+201D curly double quotes → ASCII `"`. */
const DOUBLE_QUOTES = /[״“”]/g;
/** U+05F3 geresh, U+2018/U+2019 curly single quotes, U+02BC → ASCII `'`. */
const SINGLE_QUOTES = /[׳‘’ʼ]/g;
/** Any run of whitespace including NBSP. */
const WHITESPACE = /[\s ]+/g;

/**
 * Normalizes Hebrew punctuation and whitespace so header strings from different
 * sheets compare equal. Applied before every lexicon lookup and before computing
 * a layout fingerprint.
 */
export function normalizeHebrew(input: string): string {
  return input
    .replace(DOUBLE_QUOTES, '"')
    .replace(SINGLE_QUOTES, "'")
    .replace(WHITESPACE, ' ')
    .trim();
}
```

- [ ] **Step 4: Run tests and confirm they pass**

Run: `npx vitest run src/lib/text/normalize.test.ts`
Expected: PASS — 5 tests

- [ ] **Step 5: Commit**

```bash
git add src/lib/text/
git commit -m "feat: add Hebrew punctuation normalization"
```

---

### Task 3: XLSX extraction

**Files:**
- Create: `src/lib/xlsx/types.ts`, `src/lib/xlsx/extract.ts`, `src/test/fixtures.ts`
- Test: `src/lib/xlsx/extract.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `type CellValue = string | number | boolean | Date | null`
  - `interface Cell { row: number; col: number; value: CellValue; text: string; isMerged: boolean }`
  - `interface SheetGrid { name: string; index: number; rowCount: number; colCount: number; cells: Cell[][] }` — `cells[row-1][col-1]`, 1-indexed coordinates
  - `extractWorkbook(buffer: Buffer): Promise<SheetGrid[]>`
  - `FIXTURES` and `fixtureBuffer(name: string): Buffer` from `@/test/fixtures`

- [ ] **Step 1: Create the fixture loader**

The 23'-24' filename uses ASCII apostrophes (U+0027); the 25' filename uses a **right single quotation mark (U+2019)**. These are different characters — use the escapes below verbatim.

Create `src/test/fixtures.ts`:

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const DIR = join(process.cwd(), 'docs', 'reference-data');

export const FIXTURES = {
  /** Straight ASCII apostrophes (U+0027). */
  y2324: "קופת קאמפ 23'-24'.xlsx",
  /** Right single quotation mark (U+2019), not an apostrophe. */
  y25: 'קופת קאמפ 25’.xlsx',
  y26: 'קופת קאמפ 2026.xlsx',
} as const;

export function fixtureBuffer(name: string): Buffer {
  return readFileSync(join(DIR, name));
}
```

- [ ] **Step 2: Write the failing test**

Create `src/lib/xlsx/extract.test.ts`:

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { extractWorkbook } from '@/lib/xlsx/extract';
import type { SheetGrid } from '@/lib/xlsx/types';
import { FIXTURES, fixtureBuffer } from '@/test/fixtures';

describe('extractWorkbook', () => {
  let sheets2026: SheetGrid[];

  beforeAll(async () => {
    sheets2026 = await extractWorkbook(fixtureBuffer(FIXTURES.y26));
  });

  it('extracts every sheet in order', () => {
    expect(sheets2026.map((s) => s.name)).toEqual([
      'סיכום כללי',
      'תקציב קאמפ ברן 26',
      'תקציב קאמפ ברן 25',
      'SuperNature 18.7',
      'SuperNature 3.10',
    ]);
  });

  it('uses 1-indexed coordinates addressable as cells[row-1][col-1]', () => {
    const summary = sheets2026[0];
    const a1 = summary.cells[0][0];
    expect(a1.row).toBe(1);
    expect(a1.col).toBe(1);
    expect(a1.text).toBe('תאריך');
  });

  it('reads Hebrew headers across the row', () => {
    const summary = sheets2026[0];
    expect(summary.cells[0][1].text).toBe('הוצאות');
    expect(summary.cells[0][2].text).toBe('הכנסות');
  });

  it('preserves dates as Date objects', () => {
    const summary = sheets2026[0];
    expect(summary.cells[1][0].value).toBeInstanceOf(Date);
  });

  it('yields empty string text for blank cells', () => {
    const summary = sheets2026[0];
    expect(summary.cells[0][4].text).toBe('');
  });

  it('resolves formula cells to their computed result, not the formula text', () => {
    const budget = sheets2026.find((s) => s.name === 'תקציב קאמפ ברן 26')!;
    // D3 = עלות כוללת for שירותים נסורת = 1625
    const d3 = budget.cells[2][3];
    expect(d3.text).not.toContain('=');
    expect(Number(d3.value)).toBe(1625);
  });

  it('extracts all three reference workbooks without throwing', async () => {
    const all = await Promise.all(
      [FIXTURES.y2324, FIXTURES.y25, FIXTURES.y26].map((f) =>
        extractWorkbook(fixtureBuffer(f)),
      ),
    );
    expect(all.flat().length).toBe(19);
  });
});
```

- [ ] **Step 3: Run it and confirm it fails**

Run: `npx vitest run src/lib/xlsx/extract.test.ts`
Expected: FAIL — module not found

- [ ] **Step 4: Implement the types**

Create `src/lib/xlsx/types.ts`:

```ts
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
```

- [ ] **Step 5: Implement the extractor**

ExcelJS returns objects rather than scalars for formulas (`{ formula, result }`), hyperlinks (`{ text, hyperlink }`) and rich text (`{ richText: [...] }`). Both helpers below unwrap these recursively.

Create `src/lib/xlsx/extract.ts`:

```ts
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
```

- [ ] **Step 6: Run tests and confirm they pass**

Run: `npx vitest run src/lib/xlsx/extract.test.ts`
Expected: PASS — 7 tests

If the formula test fails because ExcelJS returns no cached result, the workbook was written without cached values; in that case relax that single assertion to `expect(d3.value).not.toBeNull()` and note it in the commit message.

- [ ] **Step 7: Commit**

```bash
git add src/lib/xlsx/ src/test/
git commit -m "feat: extract xlsx workbooks into 1-indexed cell grids"
```

---

### Task 4: Value coercion

Every dirty value in this task's tests is real, taken from the reference workbooks.

**Files:**
- Create: `src/lib/coerce/number.ts`, `src/lib/coerce/quantity.ts`, `src/lib/coerce/date.ts`
- Test: `src/lib/coerce/coerce.test.ts`

**Interfaces:**
- Consumes: `CellValue` from `@/lib/xlsx/types`
- Produces:
  - `parseNumber(value: CellValue): number | null`
  - `detectSignConvention(values: Array<number | null>): 'negative-is-outflow' | 'positive'`
  - `interface Quantity { value: number | null; unit: string | null; text: string; isUnknown: boolean }`
  - `parseQuantity(value: CellValue): Quantity`
  - `interface ParsedDate { date: Date | null; raw: string; ok: boolean }`
  - `parseDate(value: CellValue): ParsedDate`

- [ ] **Step 1: Write the failing test**

Create `src/lib/coerce/coerce.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseNumber, detectSignConvention } from '@/lib/coerce/number';
import { parseQuantity } from '@/lib/coerce/quantity';
import { parseDate } from '@/lib/coerce/date';

describe('parseNumber', () => {
  it('passes through real numbers', () => {
    expect(parseNumber(1625)).toBe(1625);
    expect(parseNumber(-1170)).toBe(-1170);
    expect(parseNumber(231.875)).toBe(231.875);
  });

  it('strips thousands separators', () => {
    expect(parseNumber('12,000')).toBe(12000);
    expect(parseNumber('1,234.5')).toBe(1234.5);
  });

  it('strips the shekel sign and surrounding whitespace', () => {
    expect(parseNumber(' ₪500 ')).toBe(500);
  });

  it('returns null for placeholders and non-numeric text', () => {
    expect(parseNumber('?')).toBeNull();
    expect(parseNumber('??')).toBeNull();
    expect(parseNumber('מכולה')).toBeNull();
    expect(parseNumber('')).toBeNull();
    expect(parseNumber(null)).toBeNull();
  });

  it('never coerces a placeholder to zero', () => {
    expect(parseNumber('?')).not.toBe(0);
  });
});

describe('detectSignConvention', () => {
  it('detects the 23-24 ledger convention where outflows are negative', () => {
    expect(detectSignConvention([-1170, -488, -153, -1170])).toBe('negative-is-outflow');
  });

  it('detects the 2026 ledger convention where outflows are positive', () => {
    expect(detectSignConvention([14000, 7350, 3000, 8820])).toBe('positive');
  });

  it('ignores nulls and zeroes when deciding', () => {
    expect(detectSignConvention([null, 0, -1170, -488])).toBe('negative-is-outflow');
  });

  it('defaults to positive for mixed or empty input', () => {
    expect(detectSignConvention([])).toBe('positive');
    expect(detectSignConvention([-100, 200])).toBe('positive');
  });
});

describe('parseQuantity', () => {
  it('extracts a number and unit from text like 12,000kw', () => {
    expect(parseQuantity('12,000kw')).toEqual({
      value: 12000, unit: 'kw', text: '12,000kw', isUnknown: false,
    });
    expect(parseQuantity('9,000kw')).toEqual({
      value: 9000, unit: 'kw', text: '9,000kw', isUnknown: false,
    });
    expect(parseQuantity('21kwh')).toEqual({
      value: 21, unit: 'kwh', text: '21kwh', isUnknown: false,
    });
  });

  it('preserves descriptive quantities with no numeric part', () => {
    expect(parseQuantity('מכולה')).toEqual({
      value: null, unit: null, text: 'מכולה', isUnknown: false,
    });
    expect(parseQuantity('תפריט שלם לשבוע')).toEqual({
      value: null, unit: null, text: 'תפריט שלם לשבוע', isUnknown: false,
    });
    expect(parseQuantity('משאית הלוך חזור')).toEqual({
      value: null, unit: null, text: 'משאית הלוך חזור', isUnknown: false,
    });
  });

  it('flags placeholders as unknown rather than zero', () => {
    const q = parseQuantity('?');
    expect(q.isUnknown).toBe(true);
    expect(q.value).toBeNull();
  });

  it('handles plain numbers', () => {
    expect(parseQuantity(38)).toEqual({
      value: 38, unit: null, text: '38', isUnknown: false,
    });
  });

  it('always preserves the original text', () => {
    expect(parseQuantity('10% תקציב').text).toBe('10% תקציב');
  });
});

describe('parseDate', () => {
  it('passes through real dates', () => {
    const d = new Date(Date.UTC(2025, 4, 20));
    const parsed = parseDate(d);
    expect(parsed.ok).toBe(true);
    expect(parsed.date).toEqual(d);
  });

  it('flags the malformed 01/052024 value rather than guessing', () => {
    const parsed = parseDate('01/052024');
    expect(parsed.ok).toBe(false);
    expect(parsed.date).toBeNull();
    expect(parsed.raw).toBe('01/052024');
  });

  it('flags empty values as not-ok', () => {
    expect(parseDate('').ok).toBe(false);
    expect(parseDate(null).ok).toBe(false);
  });

  it('parses unambiguous ISO dates', () => {
    const parsed = parseDate('2025-10-30');
    expect(parsed.ok).toBe(true);
    expect(parsed.date?.getUTCFullYear()).toBe(2025);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run src/lib/coerce/coerce.test.ts`
Expected: FAIL — modules not found

- [ ] **Step 3: Implement `number.ts`**

```ts
import type { CellValue } from '@/lib/xlsx/types';

/** Values that mean "we do not know", never zero. */
const PLACEHOLDERS = new Set(['?', '??', '???', '-', '—', 'n/a']);

export function isPlaceholder(value: CellValue): boolean {
  if (typeof value !== 'string') return false;
  return PLACEHOLDERS.has(value.trim().toLowerCase());
}

/**
 * Coerces a cell to a number, or null when it does not represent one.
 * Placeholders and descriptive text return null — never 0.
 */
export function parseNumber(value: CellValue): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'boolean' || value instanceof Date) return null;
  if (isPlaceholder(value)) return null;

  const cleaned = value.replace(/[,\s ₪]/g, '');
  if (cleaned === '') return null;
  if (!/^[-+]?\d*\.?\d+$/.test(cleaned)) return null;

  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

export type SignConvention = 'negative-is-outflow' | 'positive';

/**
 * Determines how a column encodes outflows. The 23-24 ledger writes expenses as
 * negative numbers; the 2026 ledger writes them positive in a dedicated column.
 * Decided per column, never per file.
 */
export function detectSignConvention(values: Array<number | null>): SignConvention {
  const meaningful = values.filter(
    (v): v is number => v !== null && Number.isFinite(v) && v !== 0,
  );
  if (meaningful.length === 0) return 'positive';
  return meaningful.every((v) => v < 0) ? 'negative-is-outflow' : 'positive';
}
```

- [ ] **Step 4: Implement `quantity.ts`**

```ts
import type { CellValue } from '@/lib/xlsx/types';
import { isPlaceholder, parseNumber } from './number';

export interface Quantity {
  /** Numeric part, when one exists. */
  value: number | null;
  /** Trailing unit such as "kw" or "kwh", when one exists. */
  unit: string | null;
  /** The original cell text, always preserved. */
  text: string;
  /** True when the cell held a placeholder like "?". */
  isUnknown: boolean;
}

/** Leading number (with separators) followed by an alphabetic unit, e.g. "12,000kw". */
const NUMBER_WITH_UNIT = /^([-+]?[\d, \s]*\.?\d+)\s*([A-Za-z]+)$/;

/**
 * Quantity columns in these workbooks hold three different kinds of value:
 * plain numbers (38), numbers with units ("12,000kw"), and prose
 * ("תפריט שלם לשבוע"). All three are preserved; only the first two yield a number.
 */
export function parseQuantity(value: CellValue): Quantity {
  if (value === null || value === undefined) {
    return { value: null, unit: null, text: '', isUnknown: false };
  }

  const text = value instanceof Date ? value.toISOString() : String(value).trim();

  if (isPlaceholder(value)) {
    return { value: null, unit: null, text, isUnknown: true };
  }

  const direct = parseNumber(value);
  if (direct !== null) {
    return { value: direct, unit: null, text, isUnknown: false };
  }

  const match = NUMBER_WITH_UNIT.exec(text);
  if (match) {
    const numeric = parseNumber(match[1]);
    if (numeric !== null) {
      return { value: numeric, unit: match[2], text, isUnknown: false };
    }
  }

  return { value: null, unit: null, text, isUnknown: false };
}
```

- [ ] **Step 5: Implement `date.ts`**

```ts
import type { CellValue } from '@/lib/xlsx/types';

export interface ParsedDate {
  date: Date | null;
  /** Original text, kept whenever parsing fails. */
  raw: string;
  ok: boolean;
}

/** Only strictly unambiguous forms are accepted: ISO, or slash/dot dates with a 4-digit year. */
const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
const DMY = /^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/;

/**
 * Parses a date, or reports failure. Never guesses: `01/052024` in the 23-24
 * ledger is malformed and is returned as raw text with ok=false so an admin
 * can correct it.
 */
export function parseDate(value: CellValue): ParsedDate {
  if (value instanceof Date) {
    return { date: value, raw: value.toISOString(), ok: true };
  }
  if (value === null || value === undefined) {
    return { date: null, raw: '', ok: false };
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return { date: null, raw: String(value), ok: false };
  }

  const raw = value.trim();
  if (raw === '') return { date: null, raw: '', ok: false };

  const iso = ISO.exec(raw);
  if (iso) {
    const date = new Date(Date.UTC(+iso[1], +iso[2] - 1, +iso[3]));
    return Number.isNaN(date.getTime())
      ? { date: null, raw, ok: false }
      : { date, raw, ok: true };
  }

  const dmy = DMY.exec(raw);
  if (dmy) {
    const date = new Date(Date.UTC(+dmy[3], +dmy[2] - 1, +dmy[1]));
    return Number.isNaN(date.getTime())
      ? { date: null, raw, ok: false }
      : { date, raw, ok: true };
  }

  return { date: null, raw, ok: false };
}
```

- [ ] **Step 6: Run tests and confirm they pass**

Run: `npx vitest run src/lib/coerce/coerce.test.ts`
Expected: PASS — 17 tests

- [ ] **Step 7: Commit**

```bash
git add src/lib/coerce/
git commit -m "feat: coerce dirty spreadsheet values without guessing"
```

---

### Task 5: Block detection by recursive XY-cut

The core algorithm. Recursively cut a region on fully-empty column runs, then fully-empty row runs, alternating axes until no cut is possible. Each leaf is a block.

**Files:**
- Create: `src/lib/blocks/types.ts`, `src/lib/blocks/detect.ts`
- Test: `src/lib/blocks/detect.test.ts`

**Interfaces:**
- Consumes: `SheetGrid` from `@/lib/xlsx/types`
- Produces:
  - `interface CellRange { top: number; left: number; bottom: number; right: number }` — all 1-indexed, inclusive
  - `detectBlocks(grid: SheetGrid, options?: DetectOptions): CellRange[]`
  - `interface DetectOptions { minGapCols?: number; minGapRows?: number }`

- [ ] **Step 1: Write the failing test**

`minGapRows` defaults to 2 because a single blank row inside a table is common in these workbooks (row 27 of `תקציב קאמפ ברן 26`), whereas a single blank column reliably separates side-by-side tables.

Create `src/lib/blocks/detect.test.ts`:

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { extractWorkbook } from '@/lib/xlsx/extract';
import { detectBlocks } from '@/lib/blocks/detect';
import type { CellRange } from '@/lib/blocks/types';
import type { SheetGrid } from '@/lib/xlsx/types';
import { FIXTURES, fixtureBuffer } from '@/test/fixtures';

function contains(range: CellRange, row: number, col: number): boolean {
  return row >= range.top && row <= range.bottom
    && col >= range.left && col <= range.right;
}

function blockAt(blocks: CellRange[], row: number, col: number): CellRange | undefined {
  return blocks.find((b) => contains(b, row, col));
}

describe('detectBlocks', () => {
  let y26: SheetGrid[];
  let y25: SheetGrid[];

  beforeAll(async () => {
    y26 = await extractWorkbook(fixtureBuffer(FIXTURES.y26));
    y25 = await extractWorkbook(fixtureBuffer(FIXTURES.y25));
  });

  it('assigns every non-empty cell to exactly one block', () => {
    for (const grid of y26) {
      const blocks = detectBlocks(grid);
      for (let r = 1; r <= grid.rowCount; r += 1) {
        for (let c = 1; c <= grid.colCount; c += 1) {
          if (grid.cells[r - 1][c - 1].text === '') continue;
          const owners = blocks.filter((b) => contains(b, r, c));
          expect(owners.length, `cell r${r}c${c} in ${grid.name}`).toBe(1);
        }
      }
    }
  });

  it('produces no overlapping blocks', () => {
    for (const grid of [...y26, ...y25]) {
      const blocks = detectBlocks(grid);
      for (let i = 0; i < blocks.length; i += 1) {
        for (let j = i + 1; j < blocks.length; j += 1) {
          const a = blocks[i];
          const b = blocks[j];
          const overlaps = a.left <= b.right && b.left <= a.right
            && a.top <= b.bottom && b.top <= a.bottom;
          expect(overlaps, `${grid.name} blocks ${i}/${j}`).toBe(false);
        }
      }
    }
  });

  it('separates the ledger from the debt block in the 2026 סיכום כללי', () => {
    const summary = y26.find((s) => s.name === 'סיכום כללי')!;
    const blocks = detectBlocks(summary);

    const ledger = blockAt(blocks, 1, 1);      // A1 = תאריך
    const debt = blockAt(blocks, 1, 7);        // G1 = חוב יוסף

    expect(ledger).toBeDefined();
    expect(debt).toBeDefined();
    expect(ledger).not.toBe(debt);
    expect(ledger!.right).toBeLessThan(debt!.left);
  });

  it('separates the ledger from the account-balance block in the 25 סיכום כללי', () => {
    const summary = y25.find((s) => s.name === 'סיכום כללי')!;
    const blocks = detectBlocks(summary);

    const ledger = blockAt(blocks, 1, 1);      // A1 = תאריך
    const balances = blockAt(blocks, 1, 8);    // H1 = מיקום

    expect(ledger).toBeDefined();
    expect(balances).toBeDefined();
    expect(ledger).not.toBe(balances);
  });

  it('splits SuperNature 18.7 into several side-by-side blocks', () => {
    const sheet = y26.find((s) => s.name === 'SuperNature 18.7')!;
    const blocks = detectBlocks(sheet);

    const expenses = blockAt(blocks, 1, 1);    // A1 = הוצאות
    const income = blockAt(blocks, 1, 5);      // E1 = הכנסות בפועל

    expect(expenses).not.toBe(income);
    expect(blocks.length).toBeGreaterThanOrEqual(4);
  });

  it('keeps the budget line items together despite a single blank row', () => {
    const budget = y26.find((s) => s.name === 'תקציב קאמפ ברן 26')!;
    const blocks = detectBlocks(budget);

    const firstItem = blockAt(blocks, 3, 1);   // A3 = שירותים נסורת
    const lastItem = blockAt(blocks, 26, 1);   // A26 = 30 מ׳ לייקרה...

    expect(firstItem).toBeDefined();
    expect(firstItem).toBe(lastItem);
  });

  it('returns no blocks for an entirely empty grid', () => {
    const empty: SheetGrid = {
      name: 'empty', index: 0, rowCount: 3, colCount: 3,
      cells: Array.from({ length: 3 }, (_, r) =>
        Array.from({ length: 3 }, (_, c) => ({
          row: r + 1, col: c + 1, value: null, text: '', isMerged: false,
        })),
      ),
    };
    expect(detectBlocks(empty)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run src/lib/blocks/detect.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the types**

Create `src/lib/blocks/types.ts`:

```ts
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
```

- [ ] **Step 4: Implement the detector**

Termination is guaranteed: `trim` removes empty edges, so any gap run found inside a trimmed range is strictly interior and therefore splits it into at least two strictly smaller ranges. The `flipped` flag prevents infinite axis alternation when neither axis can cut.

Create `src/lib/blocks/detect.ts`:

```ts
import type { SheetGrid } from '@/lib/xlsx/types';
import type { CellRange, DetectOptions } from './types';

type Axis = 'vertical' | 'horizontal';

const other = (axis: Axis): Axis => (axis === 'vertical' ? 'horizontal' : 'vertical');

/**
 * Recursive XY-cut. Finds rectangular islands of data in a sheet that may hold
 * several unrelated tables side by side.
 *
 * A sheet is cut on runs of fully-empty columns, then fully-empty rows,
 * alternating until no cut is possible. Each remaining region is a block.
 */
export function detectBlocks(grid: SheetGrid, options: DetectOptions = {}): CellRange[] {
  const minGapCols = options.minGapCols ?? 1;
  const minGapRows = options.minGapRows ?? 2;
  const blocks: CellRange[] = [];

  const filled = (row: number, col: number): boolean =>
    (grid.cells[row - 1]?.[col - 1]?.text ?? '') !== '';

  const columnEmpty = (col: number, range: CellRange): boolean => {
    for (let row = range.top; row <= range.bottom; row += 1) {
      if (filled(row, col)) return false;
    }
    return true;
  };

  const rowEmpty = (row: number, range: CellRange): boolean => {
    for (let col = range.left; col <= range.right; col += 1) {
      if (filled(row, col)) return false;
    }
    return true;
  };

  /** Shrinks a range inward past empty edges. Returns null if fully empty. */
  function trim(range: CellRange): CellRange | null {
    let { top, left, bottom, right } = range;
    while (top <= bottom && rowEmpty(top, { top, left, bottom, right })) top += 1;
    while (bottom >= top && rowEmpty(bottom, { top, left, bottom, right })) bottom -= 1;
    if (top > bottom) return null;
    while (left <= right && columnEmpty(left, { top, left, bottom, right })) left += 1;
    while (right >= left && columnEmpty(right, { top, left, bottom, right })) right -= 1;
    if (left > right) return null;
    return { top, left, bottom, right };
  }

  /** Runs of consecutive empty lines strictly inside the range, along one axis. */
  function gaps(range: CellRange, axis: Axis): Array<[number, number]> {
    const start = axis === 'vertical' ? range.left : range.top;
    const end = axis === 'vertical' ? range.right : range.bottom;
    const isEmpty = axis === 'vertical'
      ? (i: number) => columnEmpty(i, range)
      : (i: number) => rowEmpty(i, range);
    const minRun = axis === 'vertical' ? minGapCols : minGapRows;

    const runs: Array<[number, number]> = [];
    let runStart: number | null = null;

    for (let i = start; i <= end; i += 1) {
      if (isEmpty(i)) {
        if (runStart === null) runStart = i;
      } else if (runStart !== null) {
        if (i - runStart >= minRun) runs.push([runStart, i - 1]);
        runStart = null;
      }
    }
    return runs;
  }

  function splitOn(range: CellRange, axis: Axis, runs: Array<[number, number]>): void {
    const end = axis === 'vertical' ? range.right : range.bottom;
    let cursor = axis === 'vertical' ? range.left : range.top;

    const segments: Array<[number, number]> = [];
    for (const [runStart, runEnd] of runs) {
      if (runStart > cursor) segments.push([cursor, runStart - 1]);
      cursor = runEnd + 1;
    }
    if (cursor <= end) segments.push([cursor, end]);

    for (const [segStart, segEnd] of segments) {
      const sub: CellRange = axis === 'vertical'
        ? { ...range, left: segStart, right: segEnd }
        : { ...range, top: segStart, bottom: segEnd };
      cut(sub, other(axis), false);
    }
  }

  function cut(range: CellRange, axis: Axis, flipped: boolean): void {
    const trimmed = trim(range);
    if (!trimmed) return;

    const runs = gaps(trimmed, axis);
    if (runs.length > 0) {
      splitOn(trimmed, axis, runs);
      return;
    }
    if (!flipped) {
      cut(trimmed, other(axis), true);
      return;
    }
    blocks.push(trimmed);
  }

  if (grid.rowCount > 0 && grid.colCount > 0) {
    cut({ top: 1, left: 1, bottom: grid.rowCount, right: grid.colCount }, 'vertical', false);
  }
  return blocks;
}
```

- [ ] **Step 5: Run tests and confirm they pass**

Run: `npx vitest run src/lib/blocks/detect.test.ts`
Expected: PASS — 7 tests

If the "keeps the budget line items together" test fails, `minGapRows` is too low for that sheet — raise the default to 3 and re-run the whole file, confirming the separation tests still pass. Do not special-case a sheet.

- [ ] **Step 6: Commit**

```bash
git add src/lib/blocks/
git commit -m "feat: detect data blocks with recursive XY-cut"
```

---

### Task 6: Block archetype classification

**Files:**
- Create: `src/lib/classify/types.ts`, `src/lib/classify/lexicon.ts`, `src/lib/classify/rules.ts`
- Test: `src/lib/classify/rules.test.ts`

**Interfaces:**
- Consumes: `SheetGrid`, `CellRange`, `normalizeHebrew`
- Produces:
  - `type BlockArchetype = 'ledger' | 'budget_lines' | 'event_lines' | 'ticket_rounds' | 'income_channels' | 'member_dues' | 'obligations' | 'account_balances' | 'unknown'`
  - `interface Classification { archetype: BlockArchetype; confidence: number; scores: Record<BlockArchetype, number> }`
  - `classifyBlock(grid: SheetGrid, range: CellRange): Classification`

- [ ] **Step 1: Write the failing test**

Create `src/lib/classify/rules.test.ts`:

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { extractWorkbook } from '@/lib/xlsx/extract';
import { detectBlocks } from '@/lib/blocks/detect';
import { classifyBlock } from '@/lib/classify/rules';
import type { CellRange } from '@/lib/blocks/types';
import type { SheetGrid } from '@/lib/xlsx/types';
import { FIXTURES, fixtureBuffer } from '@/test/fixtures';

function blockAt(blocks: CellRange[], row: number, col: number): CellRange {
  const found = blocks.find(
    (b) => row >= b.top && row <= b.bottom && col >= b.left && col <= b.right,
  );
  if (!found) throw new Error(`no block at r${row}c${col}`);
  return found;
}

function archetypeAt(grid: SheetGrid, row: number, col: number): string {
  const range = blockAt(detectBlocks(grid), row, col);
  return classifyBlock(grid, range).archetype;
}

describe('classifyBlock', () => {
  let y26: SheetGrid[];
  let y25: SheetGrid[];
  let y2324: SheetGrid[];

  const sheet = (sheets: SheetGrid[], name: string): SheetGrid => {
    const found = sheets.find((s) => s.name === name);
    if (!found) throw new Error(`missing sheet ${name}`);
    return found;
  };

  beforeAll(async () => {
    y26 = await extractWorkbook(fixtureBuffer(FIXTURES.y26));
    y25 = await extractWorkbook(fixtureBuffer(FIXTURES.y25));
    y2324 = await extractWorkbook(fixtureBuffer(FIXTURES.y2324));
  });

  it('classifies the 2026 cashbox ledger', () => {
    expect(archetypeAt(sheet(y26, 'סיכום כללי'), 1, 1)).toBe('ledger');
  });

  it('classifies the 23-24 day2day ledger despite English sheet naming', () => {
    expect(archetypeAt(sheet(y2324, 'Shliff day2day spending'), 1, 1)).toBe('ledger');
  });

  it('classifies the camp budget line items', () => {
    expect(archetypeAt(sheet(y26, 'תקציב קאמפ ברן 26'), 2, 1)).toBe('budget_lines');
    expect(archetypeAt(sheet(y25, 'תקציב קאמפ ברן 25'), 2, 1)).toBe('budget_lines');
  });

  it('classifies ticket rounds regardless of column order', () => {
    // Gagarin: qty then price. Collabo: price then qty.
    expect(archetypeAt(sheet(y2324, 'Shliff Gagarin 20.01'), 2, 1)).toBe('ticket_rounds');
    expect(archetypeAt(sheet(y2324, 'Shliff Collabo #3'), 2, 1)).toBe('ticket_rounds');
  });

  it('classifies the account-balance block in the 25 summary', () => {
    expect(archetypeAt(sheet(y25, 'סיכום כללי'), 1, 8)).toBe('account_balances');
  });

  it('classifies an income-channel block', () => {
    expect(archetypeAt(sheet(y25, 'House of trance 270925'), 2, 4)).toBe('income_channels');
  });

  it('reports low confidence rather than a wrong archetype for unlabelled blocks', () => {
    const deco = sheet(y2324, 'Shliff Deco 24');
    const range = blockAt(detectBlocks(deco), 2, 1);
    const result = classifyBlock(deco, range);
    if (result.archetype === 'unknown') {
      expect(result.confidence).toBeLessThan(0.5);
    } else {
      expect(result.confidence).toBeGreaterThan(0);
    }
  });

  it('returns a confidence between 0 and 1', () => {
    const summary = sheet(y26, 'סיכום כללי');
    const result = classifyBlock(summary, blockAt(detectBlocks(summary), 1, 1));
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run src/lib/classify/rules.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the types**

Create `src/lib/classify/types.ts`:

```ts
export const BLOCK_ARCHETYPES = [
  'ledger',
  'budget_lines',
  'event_lines',
  'ticket_rounds',
  'income_channels',
  'member_dues',
  'obligations',
  'account_balances',
  'unknown',
] as const;

export type BlockArchetype = (typeof BLOCK_ARCHETYPES)[number];

export interface Classification {
  archetype: BlockArchetype;
  /** 0..1. Below CONFIDENCE_THRESHOLD the block needs human confirmation. */
  confidence: number;
  scores: Record<BlockArchetype, number>;
}

/** Classifications at or above this are presented pre-confirmed in the review UI. */
export const CONFIDENCE_THRESHOLD = 0.5;
```

- [ ] **Step 4: Implement the lexicon**

Create `src/lib/classify/lexicon.ts`:

```ts
import type { BlockArchetype } from './types';

export interface Signal {
  /** Normalized term to look for, matched case-insensitively as a substring. */
  term: string;
  weight: number;
}

/**
 * Weighted keyword signals per archetype. Terms are matched against normalized
 * cell text from the block's first three rows and first column, so both header
 * rows and header columns contribute.
 *
 * Weights are tuning parameters: raise a weight when a real block from
 * docs/reference-data/ is misclassified, and re-run the whole classify suite.
 */
export const LEXICON: Record<Exclude<BlockArchetype, 'unknown'>, Signal[]> = {
  ledger: [
    { term: 'תיאור תנועה', weight: 4 },
    { term: 'תאריך', weight: 3 },
    { term: 'הוצאות', weight: 2 },
    { term: 'הכנסות', weight: 2 },
    { term: 'הוצאה', weight: 2 },
    { term: 'הכנסה', weight: 2 },
    { term: 'spending', weight: 3 },
    { term: 'פירוט', weight: 1 },
  ],
  budget_lines: [
    { term: 'כמות יחידות', weight: 5 },
    { term: 'עלות ליחידה', weight: 5 },
    { term: 'עלות כוללת', weight: 4 },
    { term: 'סוג הוצאה', weight: 4 },
    { term: 'פירוט הוצאה', weight: 4 },
    { term: 'תקציב', weight: 1 },
  ],
  event_lines: [
    { term: 'קטגוריה', weight: 4 },
    { term: 'ספק', weight: 3 },
    { term: 'לוגיסטיקה', weight: 3 },
    { term: 'תפאורה', weight: 2 },
    { term: 'מוסיקה', weight: 2 },
    { term: 'ליינאפ', weight: 2 },
    { term: 'הגברה', weight: 2 },
    { term: 'אבטחה', weight: 2 },
    { term: 'עלויות', weight: 2 },
    { term: 'שולם', weight: 1 },
  ],
  ticket_rounds: [
    { term: 'סוג כרטיס', weight: 5 },
    { term: 'מחיר כרטיס', weight: 5 },
    { term: 'כמות כרטיס', weight: 5 },
    { term: 'סבב', weight: 4 },
    { term: 'מוקדמות', weight: 2 },
    { term: 'אחרי עמלה', weight: 2 },
  ],
  income_channels: [
    { term: 'איבנטבאז', weight: 4 },
    { term: 'פייבוקס', weight: 4 },
    { term: 'וייבז', weight: 4 },
    { term: 'vibez', weight: 4 },
    { term: 'ביט', weight: 3 },
    { term: 'מזומן', weight: 2 },
    { term: 'הכנסות', weight: 2 },
    { term: 'בר', weight: 1 },
  ],
  member_dues: [
    { term: 'דמי קאמפ', weight: 5 },
    { term: 'חברי מחנה', weight: 4 },
    { term: 'חריגים', weight: 4 },
    { term: 'רגילים', weight: 3 },
  ],
  obligations: [
    { term: 'קיזוז', weight: 5 },
    { term: 'חוב', weight: 4 },
    { term: 'להחזיר', weight: 3 },
    { term: 'להכין מזומן', weight: 4 },
    { term: 'יתרה', weight: 2 },
  ],
  account_balances: [
    { term: 'איפה נרשם', weight: 5 },
    { term: 'אצל מי', weight: 5 },
    { term: 'מיקום', weight: 4 },
    { term: 'קופת מזומן', weight: 4 },
    { term: 'עו"ש', weight: 4 },
  ],
};
```

- [ ] **Step 5: Implement the classifier**

Create `src/lib/classify/rules.ts`:

```ts
import type { SheetGrid } from '@/lib/xlsx/types';
import type { CellRange } from '@/lib/blocks/types';
import { normalizeHebrew } from '@/lib/text/normalize';
import { LEXICON } from './lexicon';
import { BLOCK_ARCHETYPES, type BlockArchetype, type Classification } from './types';

/** How many leading rows of a block count as potential headers. */
const HEADER_ROWS = 3;

/**
 * Collects the text a classifier should look at: the block's first rows (for
 * header rows) and its first column (for header columns, as in בצרה where the
 * category label sits on the right and the labels run down column A).
 */
function candidateText(grid: SheetGrid, range: CellRange): string[] {
  const out: string[] = [];

  const lastHeaderRow = Math.min(range.bottom, range.top + HEADER_ROWS - 1);
  for (let row = range.top; row <= lastHeaderRow; row += 1) {
    for (let col = range.left; col <= range.right; col += 1) {
      const text = grid.cells[row - 1]?.[col - 1]?.text ?? '';
      if (text !== '') out.push(normalizeHebrew(text).toLowerCase());
    }
  }

  for (let row = range.top; row <= range.bottom; row += 1) {
    const text = grid.cells[row - 1]?.[range.left - 1]?.text ?? '';
    if (text !== '') out.push(normalizeHebrew(text).toLowerCase());
  }

  return out;
}

function emptyScores(): Record<BlockArchetype, number> {
  return Object.fromEntries(
    BLOCK_ARCHETYPES.map((a) => [a, 0]),
  ) as Record<BlockArchetype, number>;
}

/**
 * Scores a block against every archetype's keyword signals and returns the best
 * match with a confidence derived from its margin over the runner-up.
 *
 * Column order is irrelevant: every candidate cell is scored independently, so
 * Gagarin (qty, price) and Collabo (price, qty) score identically.
 */
export function classifyBlock(grid: SheetGrid, range: CellRange): Classification {
  const haystack = candidateText(grid, range);
  const scores = emptyScores();

  for (const [archetype, signals] of Object.entries(LEXICON)) {
    let score = 0;
    for (const signal of signals) {
      const needle = normalizeHebrew(signal.term).toLowerCase();
      // Count each signal at most once, so a repeated word cannot dominate.
      if (haystack.some((text) => text.includes(needle))) score += signal.weight;
    }
    scores[archetype as BlockArchetype] = score;
  }

  const ranked = BLOCK_ARCHETYPES
    .filter((a) => a !== 'unknown')
    .map((a) => ({ archetype: a, score: scores[a] }))
    .sort((x, y) => y.score - x.score);

  const best = ranked[0];
  const runnerUp = ranked[1];

  if (!best || best.score === 0) {
    return { archetype: 'unknown', confidence: 0, scores };
  }

  const margin = (best.score - (runnerUp?.score ?? 0)) / best.score;
  // Absolute evidence matters as much as margin: one weak signal is not enough.
  const evidence = Math.min(best.score / 6, 1);
  const confidence = Math.max(0, Math.min(1, margin * 0.5 + evidence * 0.5));

  return { archetype: best.archetype, confidence, scores };
}
```

- [ ] **Step 6: Run tests and confirm they pass**

Run: `npx vitest run src/lib/classify/rules.test.ts`
Expected: PASS — 8 tests

Expect to tune. If a real block is misclassified, adjust weights in `lexicon.ts` — never add a sheet-name special case — and re-run the full file so a fix for one block does not break another.

- [ ] **Step 7: Commit**

```bash
git add src/lib/classify/
git commit -m "feat: classify blocks by weighted Hebrew keyword lexicon"
```

---

### Task 7: Header detection and column mapping

**Files:**
- Create: `src/lib/classify/header.ts`, `src/lib/classify/map-columns.ts`
- Test: `src/lib/classify/map-columns.test.ts`

**Interfaces:**
- Consumes: `SheetGrid`, `CellRange`, `BlockArchetype`, `normalizeHebrew`, `parseNumber`
- Produces:
  - `findHeaderRow(grid: SheetGrid, range: CellRange): number | null` — 1-indexed row, or null
  - `interface ColumnMapping { column: number; field: string; confidence: number }`
  - `mapColumns(grid, range, archetype): { headerRow: number | null; mappings: ColumnMapping[] }`

- [ ] **Step 1: Write the failing test**

Create `src/lib/classify/map-columns.test.ts`:

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { extractWorkbook } from '@/lib/xlsx/extract';
import { detectBlocks } from '@/lib/blocks/detect';
import { mapColumns, findHeaderRow } from '@/lib/classify/map-columns';
import type { CellRange } from '@/lib/blocks/types';
import type { SheetGrid } from '@/lib/xlsx/types';
import { FIXTURES, fixtureBuffer } from '@/test/fixtures';

function blockAt(blocks: CellRange[], row: number, col: number): CellRange {
  const found = blocks.find(
    (b) => row >= b.top && row <= b.bottom && col >= b.left && col <= b.right,
  );
  if (!found) throw new Error(`no block at r${row}c${col}`);
  return found;
}

describe('mapColumns', () => {
  let y26: SheetGrid[];
  let y2324: SheetGrid[];

  const sheet = (sheets: SheetGrid[], name: string): SheetGrid => {
    const found = sheets.find((s) => s.name === name);
    if (!found) throw new Error(`missing sheet ${name}`);
    return found;
  };

  beforeAll(async () => {
    y26 = await extractWorkbook(fixtureBuffer(FIXTURES.y26));
    y2324 = await extractWorkbook(fixtureBuffer(FIXTURES.y2324));
  });

  it('finds the header row of the 2026 ledger', () => {
    const summary = sheet(y26, 'סיכום כללי');
    const range = blockAt(detectBlocks(summary), 1, 1);
    expect(findHeaderRow(summary, range)).toBe(1);
  });

  it('maps the ledger columns to canonical fields', () => {
    const summary = sheet(y26, 'סיכום כללי');
    const range = blockAt(detectBlocks(summary), 1, 1);
    const { mappings } = mapColumns(summary, range, 'ledger');
    const field = (col: number) => mappings.find((m) => m.column === col)?.field;

    expect(field(1)).toBe('date');
    expect(field(2)).toBe('outflow');
    expect(field(3)).toBe('inflow');
    expect(field(4)).toBe('description');
  });

  it('maps budget columns to canonical fields', () => {
    const budget = sheet(y26, 'תקציב קאמפ ברן 26');
    const range = blockAt(detectBlocks(budget), 2, 1);
    const { mappings } = mapColumns(budget, range, 'budget_lines');
    const field = (col: number) => mappings.find((m) => m.column === col)?.field;

    expect(field(1)).toBe('item');
    expect(field(2)).toBe('quantity');
    expect(field(3)).toBe('unit_cost');
    expect(field(4)).toBe('total');
  });

  it('maps ticket rounds correctly when quantity precedes price (Gagarin)', () => {
    const gagarin = sheet(y2324, 'Shliff Gagarin 20.01');
    const range = blockAt(detectBlocks(gagarin), 2, 1);
    const { mappings } = mapColumns(gagarin, range, 'ticket_rounds');
    const col = (f: string) => mappings.find((m) => m.field === f)?.column;

    expect(col('quantity')).toBeLessThan(col('price')!);
  });

  it('maps ticket rounds correctly when price precedes quantity (Collabo)', () => {
    const collabo = sheet(y2324, 'Shliff Collabo #3');
    const range = blockAt(detectBlocks(collabo), 2, 1);
    const { mappings } = mapColumns(collabo, range, 'ticket_rounds');
    const col = (f: string) => mappings.find((m) => m.field === f)?.column;

    expect(col('price')).toBeLessThan(col('quantity')!);
  });

  it('returns a null header row for a block with no header', () => {
    const grid: SheetGrid = {
      name: 'bare', index: 0, rowCount: 2, colCount: 2,
      cells: [
        [
          { row: 1, col: 1, value: 100, text: '100', isMerged: false },
          { row: 1, col: 2, value: 200, text: '200', isMerged: false },
        ],
        [
          { row: 2, col: 1, value: 300, text: '300', isMerged: false },
          { row: 2, col: 2, value: 400, text: '400', isMerged: false },
        ],
      ],
    };
    expect(findHeaderRow(grid, { top: 1, left: 1, bottom: 2, right: 2 })).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run src/lib/classify/map-columns.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement header detection**

Create `src/lib/classify/header.ts`:

```ts
import type { SheetGrid } from '@/lib/xlsx/types';
import type { CellRange } from '@/lib/blocks/types';
import { parseNumber } from '@/lib/coerce/number';

/** How many leading rows may be considered as the header. */
const MAX_HEADER_SCAN = 3;

/**
 * A header row is a leading row that is mostly non-numeric text and is followed
 * by at least one row containing a number. Blocks whose data starts immediately
 * (the חוב יוסף label/amount pairs) correctly return null.
 */
export function findHeaderRow(grid: SheetGrid, range: CellRange): number | null {
  const lastScan = Math.min(range.bottom - 1, range.top + MAX_HEADER_SCAN - 1);

  for (let row = range.top; row <= lastScan; row += 1) {
    let textCells = 0;
    let numericCells = 0;

    for (let col = range.left; col <= range.right; col += 1) {
      const cell = grid.cells[row - 1]?.[col - 1];
      if (!cell || cell.text === '') continue;
      if (parseNumber(cell.value) === null) textCells += 1;
      else numericCells += 1;
    }

    if (textCells < 2 || numericCells > textCells) continue;

    // Require at least one numeric cell somewhere below, or this is not a header.
    for (let below = row + 1; below <= range.bottom; below += 1) {
      for (let col = range.left; col <= range.right; col += 1) {
        if (parseNumber(grid.cells[below - 1]?.[col - 1]?.value ?? null) !== null) {
          return row;
        }
      }
    }
  }

  return null;
}
```

- [ ] **Step 4: Implement column mapping**

Create `src/lib/classify/map-columns.ts`:

```ts
import type { SheetGrid } from '@/lib/xlsx/types';
import type { CellRange } from '@/lib/blocks/types';
import type { BlockArchetype } from './types';
import { normalizeHebrew } from '@/lib/text/normalize';
import { findHeaderRow } from './header';

export { findHeaderRow };

export interface ColumnMapping {
  /** 1-indexed sheet column. */
  column: number;
  /** Canonical field name for this archetype. */
  field: string;
  confidence: number;
}

export interface MappingResult {
  headerRow: number | null;
  mappings: ColumnMapping[];
}

/** Header terms that identify a canonical field, per archetype. */
const FIELD_TERMS: Partial<Record<BlockArchetype, Record<string, string[]>>> = {
  ledger: {
    date: ['תאריך'],
    outflow: ['הוצאות', 'הוצאה'],
    inflow: ['הכנסות', 'הכנסה'],
    description: ['פירוט/תיאור תנועה', 'תיאור תנועה', 'פירוט', 'תיאור'],
  },
  budget_lines: {
    item: ['סוג הוצאה', 'פירוט הוצאה', 'תיאור'],
    quantity: ['כמות יחידות', 'כמות'],
    unit_cost: ['עלות ליחידה', 'מחיר'],
    total: ['עלות כוללת', 'סה"כ תשלום', 'סה"כ', 'סכום'],
    paid: ['שולם'],
    payment_method: ['מזומן/אשראי', 'אמצעי תשלום'],
    note: ['הערה', 'הערות'],
  },
  ticket_rounds: {
    round: ['סוג כרטיס', 'סבב', 'פירוט'],
    quantity: ['כמות כרטיס', 'כמות'],
    price: ['מחיר כרטיס', 'מחיר'],
    total: ['סה"כ'],
  },
  event_lines: {
    category: ['קטגוריה'],
    description: ['תיאור', 'פירוט'],
    amount: ['סכום', 'סה"כ'],
    supplier: ['ספק', 'אחראי'],
    paid: ['שולם', 'שולם/ לא שולם'],
  },
  income_channels: {
    channel: ['מקור', 'אתר ווייבז', 'ערוץ'],
    amount: ['סכום', 'כמות'],
    holder: ['אצל מי', 'איפה נרשם'],
  },
  account_balances: {
    date: ['תאריך'],
    account: ['מיקום'],
    balance: ['סכום', 'יתרה'],
  },
  member_dues: {
    person: ['שם', 'חבר'],
    amount: ['סכום'],
    paid: ['שולם'],
  },
  obligations: {
    description: ['פירוט', 'תיאור'],
    amount: ['סכום', 'סה"כ'],
    party: ['שם', 'אצל מי'],
  },
};

/**
 * Maps each column of a block onto a canonical field for its archetype by
 * matching the header cell text.
 *
 * Matching is per column and order-independent, so the same archetype maps
 * correctly whether quantity precedes price (Gagarin) or follows it (Collabo).
 * A longer matching term wins over a shorter one, so "מחיר כרטיס" beats "מחיר".
 */
export function mapColumns(
  grid: SheetGrid,
  range: CellRange,
  archetype: BlockArchetype,
): MappingResult {
  const headerRow = findHeaderRow(grid, range);
  const terms = FIELD_TERMS[archetype];
  if (headerRow === null || !terms) return { headerRow, mappings: [] };

  const mappings: ColumnMapping[] = [];
  const claimed = new Set<string>();

  for (let col = range.left; col <= range.right; col += 1) {
    const raw = grid.cells[headerRow - 1]?.[col - 1]?.text ?? '';
    if (raw === '') continue;
    const header = normalizeHebrew(raw).toLowerCase();

    let bestField: string | null = null;
    let bestLength = 0;

    for (const [field, candidates] of Object.entries(terms)) {
      if (claimed.has(field)) continue;
      for (const candidate of candidates) {
        const needle = normalizeHebrew(candidate).toLowerCase();
        if (header.includes(needle) && needle.length > bestLength) {
          bestField = field;
          bestLength = needle.length;
        }
      }
    }

    if (bestField) {
      claimed.add(bestField);
      mappings.push({
        column: col,
        field: bestField,
        confidence: header === normalizeHebrew(bestField).toLowerCase() ? 1 : 0.8,
      });
    }
  }

  return { headerRow, mappings };
}
```

- [ ] **Step 5: Run tests and confirm they pass**

Run: `npx vitest run src/lib/classify/map-columns.test.ts`
Expected: PASS — 6 tests

The ticket-round tests assert only relative column order, so they hold regardless of where each block starts. If a field maps to the wrong column, add the missing header phrase to `FIELD_TERMS` rather than reordering.

- [ ] **Step 6: Commit**

```bash
git add src/lib/classify/
git commit -m "feat: detect header rows and map columns to canonical fields"
```

---

### Task 8: Layout signatures

**Files:**
- Create: `src/lib/classify/signature.ts`
- Test: `src/lib/classify/signature.test.ts`

**Interfaces:**
- Consumes: `SheetGrid`, `CellRange`, `normalizeHebrew`
- Produces: `layoutFingerprint(grid: SheetGrid, range: CellRange, headerRow: number | null): string` — 32-char hex

- [ ] **Step 1: Write the failing test**

Create `src/lib/classify/signature.test.ts`:

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { extractWorkbook } from '@/lib/xlsx/extract';
import { detectBlocks } from '@/lib/blocks/detect';
import { findHeaderRow } from '@/lib/classify/header';
import { layoutFingerprint } from '@/lib/classify/signature';
import type { CellRange } from '@/lib/blocks/types';
import type { SheetGrid } from '@/lib/xlsx/types';
import { FIXTURES, fixtureBuffer } from '@/test/fixtures';

function blockAt(blocks: CellRange[], row: number, col: number): CellRange {
  const found = blocks.find(
    (b) => row >= b.top && row <= b.bottom && col >= b.left && col <= b.right,
  );
  if (!found) throw new Error(`no block at r${row}c${col}`);
  return found;
}

function fingerprintOf(grid: SheetGrid, row: number, col: number): string {
  const range = blockAt(detectBlocks(grid), row, col);
  return layoutFingerprint(grid, range, findHeaderRow(grid, range));
}

describe('layoutFingerprint', () => {
  let y26: SheetGrid[];
  let y25: SheetGrid[];

  const sheet = (sheets: SheetGrid[], name: string): SheetGrid => {
    const found = sheets.find((s) => s.name === name);
    if (!found) throw new Error(`missing sheet ${name}`);
    return found;
  };

  beforeAll(async () => {
    y26 = await extractWorkbook(fixtureBuffer(FIXTURES.y26));
    y25 = await extractWorkbook(fixtureBuffer(FIXTURES.y25));
  });

  it('returns a stable 32-character hex string', () => {
    const fp = fingerprintOf(sheet(y26, 'סיכום כללי'), 1, 1);
    expect(fp).toMatch(/^[0-9a-f]{32}$/);
    expect(fingerprintOf(sheet(y26, 'סיכום כללי'), 1, 1)).toBe(fp);
  });

  it('matches the same layout across two different workbooks', () => {
    // תקציב קאמפ ברן 26 appears in both the 25 and 2026 files with identical headers.
    const fromY26 = fingerprintOf(sheet(y26, 'תקציב קאמפ ברן 26'), 2, 1);
    const fromY25 = fingerprintOf(sheet(y25, 'תקציב קאמפ ברן 26'), 2, 1);
    expect(fromY26).toBe(fromY25);
  });

  it('differs between different layouts', () => {
    const ledger = fingerprintOf(sheet(y26, 'סיכום כללי'), 1, 1);
    const budget = fingerprintOf(sheet(y26, 'תקציב קאמפ ברן 26'), 2, 1);
    expect(ledger).not.toBe(budget);
  });

  it('is insensitive to Hebrew punctuation variants', () => {
    const grid = (header: string): SheetGrid => ({
      name: 't', index: 0, rowCount: 2, colCount: 1,
      cells: [
        [{ row: 1, col: 1, value: header, text: header, isMerged: false }],
        [{ row: 2, col: 1, value: 1, text: '1', isMerged: false }],
      ],
    });
    const range: CellRange = { top: 1, left: 1, bottom: 2, right: 1 };
    expect(layoutFingerprint(grid('סה״כ'), range, 1))
      .toBe(layoutFingerprint(grid('סה"כ'), range, 1));
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run src/lib/classify/signature.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement**

Create `src/lib/classify/signature.ts`:

```ts
import { createHash } from 'node:crypto';
import type { SheetGrid } from '@/lib/xlsx/types';
import type { CellRange } from '@/lib/blocks/types';
import { normalizeHebrew } from '@/lib/text/normalize';
import { PIPELINE_VERSION } from '@/lib/version';

/**
 * Fingerprints a block's layout from its normalized header texts and width.
 *
 * Two blocks with the same fingerprint have the same shape and headers, so a
 * mapping confirmed for one can be reused for the other — this is how a
 * correction made once is applied automatically next year.
 *
 * The fingerprint is order-sensitive by design: Gagarin (qty, price) and
 * Collabo (price, qty) are genuinely different layouts needing different
 * mappings, and must not share a signature.
 *
 * PIPELINE_VERSION is included so that changing parsing logic invalidates old
 * signatures rather than silently reusing a mapping derived under different rules.
 */
export function layoutFingerprint(
  grid: SheetGrid,
  range: CellRange,
  headerRow: number | null,
): string {
  const width = range.right - range.left + 1;

  const headers: string[] = [];
  if (headerRow !== null) {
    for (let col = range.left; col <= range.right; col += 1) {
      const text = grid.cells[headerRow - 1]?.[col - 1]?.text ?? '';
      headers.push(normalizeHebrew(text).toLowerCase());
    }
  }

  const payload = JSON.stringify({ v: PIPELINE_VERSION, width, headers });
  return createHash('sha256').update(payload, 'utf8').digest('hex').slice(0, 32);
}
```

- [ ] **Step 4: Run tests and confirm they pass**

Run: `npx vitest run src/lib/classify/signature.test.ts`
Expected: PASS — 4 tests

The cross-workbook test is the important one: it proves that confirming the ברן 26 budget mapping once will auto-apply it to the other file.

- [ ] **Step 5: Run the whole library suite**

Run: `npm test`
Expected: PASS — all tests from Tasks 1–8

- [ ] **Step 6: Commit**

```bash
git add src/lib/classify/
git commit -m "feat: fingerprint block layouts for mapping reuse"
```

---

### Task 9: Source-layer database schema

**Files:**
- Create: `src/db/schema/source.ts`, `src/db/index.ts`, `drizzle.config.ts`, `src/test/db.ts`
- Test: `src/db/schema/source.test.ts`

**Interfaces:**
- Consumes: `BlockArchetype`
- Produces: Drizzle tables `uploads`, `sheets`, `blocks`, `blockMappings`, `layoutSignatures`; `createTestDb(): Promise<TestDb>` from `@/test/db`

- [ ] **Step 1: Write the failing test**

Create `src/db/schema/source.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDb, type TestDb } from '@/test/db';
import { uploads, sheets, blocks, layoutSignatures } from '@/db/schema/source';

describe('source schema', () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await createTestDb();
  });

  it('stores an upload and reads it back', async () => {
    const [row] = await db.insert(uploads).values({
      filename: 'קופת קאמפ 2026.xlsx',
      sha256: 'a'.repeat(64),
      storageKey: 'uploads/test.xlsx',
      sizeBytes: 22002,
      uploadedBy: 'admin@example.com',
    }).returning();

    expect(row.id).toBeDefined();
    expect(row.status).toBe('pending');
    expect(row.filename).toBe('קופת קאמפ 2026.xlsx');
  });

  it('rejects a duplicate sha256', async () => {
    const values = {
      filename: 'x.xlsx',
      sha256: 'b'.repeat(64),
      storageKey: 'uploads/x.xlsx',
      sizeBytes: 10,
      uploadedBy: 'admin@example.com',
    };
    await db.insert(uploads).values(values);
    await expect(db.insert(uploads).values(values)).rejects.toThrow();
  });

  it('cascades sheet and block deletion when an upload is removed', async () => {
    const [upload] = await db.insert(uploads).values({
      filename: 'y.xlsx',
      sha256: 'c'.repeat(64),
      storageKey: 'uploads/y.xlsx',
      sizeBytes: 10,
      uploadedBy: 'admin@example.com',
    }).returning();

    const [sheet] = await db.insert(sheets).values({
      uploadId: upload.id, name: 'סיכום כללי', index: 0, rowCount: 44, colCount: 14,
    }).returning();

    await db.insert(blocks).values({
      sheetId: sheet.id,
      top: 1, left: 1, bottom: 13, right: 4,
      archetype: 'ledger',
      confidence: '0.87',
      pipelineVersion: 1,
      rawGrid: [['תאריך', 'הוצאות']],
    });

    await db.delete(uploads).where(eq(uploads.id, upload.id));

    expect(await db.select().from(sheets)).toHaveLength(0);
    expect(await db.select().from(blocks)).toHaveLength(0);
  });

  it('stores a layout signature keyed by fingerprint', async () => {
    const [row] = await db.insert(layoutSignatures).values({
      fingerprint: 'd'.repeat(32),
      archetype: 'budget_lines',
      columnMap: [{ column: 1, field: 'item', confidence: 1 }],
      pipelineVersion: 1,
      confirmedBy: 'admin@example.com',
    }).returning();

    expect(row.fingerprint).toHaveLength(32);
    expect(row.columnMap).toEqual([{ column: 1, field: 'item', confidence: 1 }]);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run src/db/schema/source.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the schema**

`confidence` is `numeric` rather than a float so stored values are exact and comparable.

Create `src/db/schema/source.ts`:

```ts
import {
  pgTable, uuid, text, integer, timestamp, jsonb, numeric, unique,
} from 'drizzle-orm/pg-core';
import type { ColumnMapping } from '@/lib/classify/map-columns';
import type { BlockArchetype } from '@/lib/classify/types';

export const uploads = pgTable('uploads', {
  id: uuid('id').defaultRandom().primaryKey(),
  filename: text('filename').notNull(),
  /** Hex SHA-256 of the file bytes; makes re-uploading the same file a no-op. */
  sha256: text('sha256').notNull().unique(),
  /** Key in the private blob store. */
  storageKey: text('storage_key').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  uploadedBy: text('uploaded_by').notNull(),
  /** pending → parsed → committed, or failed. */
  status: text('status').notNull().default('pending'),
  error: text('error'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const sheets = pgTable('sheets', {
  id: uuid('id').defaultRandom().primaryKey(),
  uploadId: uuid('upload_id').notNull()
    .references(() => uploads.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  index: integer('index').notNull(),
  rowCount: integer('row_count').notNull(),
  colCount: integer('col_count').notNull(),
});

export const blocks = pgTable('blocks', {
  id: uuid('id').defaultRandom().primaryKey(),
  sheetId: uuid('sheet_id').notNull()
    .references(() => sheets.id, { onDelete: 'cascade' }),
  /** Inclusive 1-indexed bounds within the sheet. */
  top: integer('top').notNull(),
  left: integer('left').notNull(),
  bottom: integer('bottom').notNull(),
  right: integer('right').notNull(),
  archetype: text('archetype').$type<BlockArchetype>().notNull(),
  confidence: numeric('confidence').notNull(),
  headerRow: integer('header_row'),
  /** Layout fingerprint, when a header row was found. */
  fingerprint: text('fingerprint'),
  pipelineVersion: integer('pipeline_version').notNull(),
  /** The block's cells exactly as they appeared, for review and re-parsing. */
  rawGrid: jsonb('raw_grid').$type<string[][]>().notNull(),
  confirmedBy: text('confirmed_by'),
  confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
});

export const blockMappings = pgTable('block_mappings', {
  id: uuid('id').defaultRandom().primaryKey(),
  blockId: uuid('block_id').notNull()
    .references(() => blocks.id, { onDelete: 'cascade' }),
  columnMap: jsonb('column_map').$type<ColumnMapping[]>().notNull(),
  /** rules | signature | admin — where this mapping came from. */
  source: text('source').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  oneMappingPerBlock: unique('block_mappings_block_id_key').on(table.blockId),
}));

export const layoutSignatures = pgTable('layout_signatures', {
  id: uuid('id').defaultRandom().primaryKey(),
  /** 32-char hex from layoutFingerprint. */
  fingerprint: text('fingerprint').notNull().unique(),
  archetype: text('archetype').$type<BlockArchetype>().notNull(),
  columnMap: jsonb('column_map').$type<ColumnMapping[]>().notNull(),
  pipelineVersion: integer('pipeline_version').notNull(),
  confirmedBy: text('confirmed_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
```

- [ ] **Step 4: Implement the database clients**

Create `src/db/index.ts`:

```ts
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as source from './schema/source';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is not set');

const client = postgres(connectionString);
export const db = drizzle(client, { schema: { ...source } });
export type Db = typeof db;
```

Create `drizzle.config.ts`:

```ts
import type { Config } from 'drizzle-kit';

export default {
  schema: './src/db/schema/*.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: { url: process.env.DATABASE_URL ?? '' },
} satisfies Config;
```

Create `src/test/db.ts` — an in-process Postgres so tests need no running server:

```ts
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import * as source from '@/db/schema/source';

export type TestDb = ReturnType<typeof drizzle<typeof source>>;

/**
 * Creates a fresh in-memory Postgres with the current migrations applied.
 * Each test gets its own instance, so tests never share state.
 */
export async function createTestDb(): Promise<TestDb> {
  const client = new PGlite();
  const dir = join(process.cwd(), 'drizzle');
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();

  for (const file of files) {
    const sql = readFileSync(join(dir, file), 'utf8');
    for (const statement of sql.split('--> statement-breakpoint')) {
      const trimmed = statement.trim();
      if (trimmed) await client.exec(trimmed);
    }
  }

  return drizzle(client, { schema: { ...source } });
}
```

- [ ] **Step 5: Generate the migration**

```bash
npx drizzle-kit generate
```

Expected: a new `drizzle/0000_*.sql` plus `drizzle/meta/`. Commit these — `src/test/db.ts` reads them.

- [ ] **Step 6: Run tests and confirm they pass**

Run: `npx vitest run src/db/schema/source.test.ts`
Expected: PASS — 4 tests

- [ ] **Step 7: Commit**

```bash
git add src/db/ src/test/db.ts drizzle/ drizzle.config.ts
git commit -m "feat: add source-layer schema with PGlite test harness"
```

---

### Task 10: Import pipeline orchestration

**Files:**
- Create: `src/lib/import/run-import.ts`
- Test: `src/lib/import/run-import.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 3–9
- Produces:
  - `interface ImportReport { uploadId: string; sheetCount: number; blockCount: number; autoRecognized: number; needsReview: number; blocks: ImportedBlockSummary[] }`
  - `runImport(db: Db | TestDb, uploadId: string, buffer: Buffer): Promise<ImportReport>`

- [ ] **Step 1: Write the failing test**

Create `src/lib/import/run-import.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb, type TestDb } from '@/test/db';
import { uploads, sheets, blocks, layoutSignatures } from '@/db/schema/source';
import { runImport } from '@/lib/import/run-import';
import { FIXTURES, fixtureBuffer } from '@/test/fixtures';

async function seedUpload(db: TestDb, sha: string): Promise<string> {
  const [row] = await db.insert(uploads).values({
    filename: FIXTURES.y26,
    sha256: sha,
    storageKey: `uploads/${sha}.xlsx`,
    sizeBytes: 22002,
    uploadedBy: 'admin@example.com',
  }).returning();
  return row.id;
}

describe('runImport', () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await createTestDb();
  });

  it('persists every sheet and block of the 2026 workbook', async () => {
    const uploadId = await seedUpload(db, 'a'.repeat(64));
    const report = await runImport(db, uploadId, fixtureBuffer(FIXTURES.y26));

    expect(report.sheetCount).toBe(5);
    expect(report.blockCount).toBeGreaterThan(5);
    expect(await db.select().from(sheets)).toHaveLength(5);
    expect(await db.select().from(blocks)).toHaveLength(report.blockCount);
  });

  it('marks the upload parsed', async () => {
    const uploadId = await seedUpload(db, 'b'.repeat(64));
    await runImport(db, uploadId, fixtureBuffer(FIXTURES.y26));

    const [row] = await db.select().from(uploads);
    expect(row.status).toBe('parsed');
  });

  it('stores the raw grid of every block', async () => {
    const uploadId = await seedUpload(db, 'c'.repeat(64));
    await runImport(db, uploadId, fixtureBuffer(FIXTURES.y26));

    const stored = await db.select().from(blocks);
    for (const block of stored) {
      expect(Array.isArray(block.rawGrid)).toBe(true);
      expect(block.rawGrid.length).toBe(block.bottom - block.top + 1);
    }
  });

  it('classifies at least one block as a ledger', async () => {
    const uploadId = await seedUpload(db, 'd'.repeat(64));
    await runImport(db, uploadId, fixtureBuffer(FIXTURES.y26));

    const stored = await db.select().from(blocks);
    expect(stored.some((b) => b.archetype === 'ledger')).toBe(true);
  });

  it('reuses a stored layout signature and counts it as auto-recognized', async () => {
    // Import the 25 file first, confirm one of its signatures by hand,
    // then import the 2026 file which shares the ברן 26 budget layout.
    const firstId = await seedUpload(db, 'e'.repeat(64));
    await runImport(db, firstId, fixtureBuffer(FIXTURES.y25));

    const budgetBlock = (await db.select().from(blocks))
      .find((b) => b.archetype === 'budget_lines' && b.fingerprint !== null);
    expect(budgetBlock).toBeDefined();

    await db.insert(layoutSignatures).values({
      fingerprint: budgetBlock!.fingerprint!,
      archetype: 'budget_lines',
      columnMap: [{ column: 1, field: 'item', confidence: 1 }],
      pipelineVersion: budgetBlock!.pipelineVersion,
      confirmedBy: 'admin@example.com',
    });

    const [second] = await db.insert(uploads).values({
      filename: FIXTURES.y26,
      sha256: 'f'.repeat(64),
      storageKey: 'uploads/second.xlsx',
      sizeBytes: 22002,
      uploadedBy: 'admin@example.com',
    }).returning();

    const report = await runImport(db, second.id, fixtureBuffer(FIXTURES.y26));
    expect(report.autoRecognized).toBeGreaterThan(0);
  });

  it('records the failure and rethrows when the file is not a workbook', async () => {
    const uploadId = await seedUpload(db, '0'.repeat(64));
    await expect(
      runImport(db, uploadId, Buffer.from('not a workbook')),
    ).rejects.toThrow();

    const [row] = await db.select().from(uploads);
    expect(row.status).toBe('failed');
    expect(row.error).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run src/lib/import/run-import.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement**

Create `src/lib/import/run-import.ts`:

```ts
import { eq } from 'drizzle-orm';
import type { Db } from '@/db';
import type { TestDb } from '@/test/db';
import { uploads, sheets, blocks, blockMappings, layoutSignatures } from '@/db/schema/source';
import { extractWorkbook } from '@/lib/xlsx/extract';
import { detectBlocks } from '@/lib/blocks/detect';
import { classifyBlock } from '@/lib/classify/rules';
import { mapColumns, findHeaderRow, type ColumnMapping } from '@/lib/classify/map-columns';
import { layoutFingerprint } from '@/lib/classify/signature';
import { CONFIDENCE_THRESHOLD, type BlockArchetype } from '@/lib/classify/types';
import { PIPELINE_VERSION } from '@/lib/version';
import type { SheetGrid } from '@/lib/xlsx/types';
import type { CellRange } from '@/lib/blocks/types';

type AnyDb = Db | TestDb;

export interface ImportedBlockSummary {
  blockId: string;
  sheetName: string;
  range: CellRange;
  archetype: BlockArchetype;
  confidence: number;
  mappingSource: 'rules' | 'signature';
  needsReview: boolean;
}

export interface ImportReport {
  uploadId: string;
  sheetCount: number;
  blockCount: number;
  /** Blocks whose layout matched a previously confirmed signature. */
  autoRecognized: number;
  needsReview: number;
  blocks: ImportedBlockSummary[];
}

function sliceGrid(grid: SheetGrid, range: CellRange): string[][] {
  const rows: string[][] = [];
  for (let row = range.top; row <= range.bottom; row += 1) {
    const cells: string[] = [];
    for (let col = range.left; col <= range.right; col += 1) {
      cells.push(grid.cells[row - 1]?.[col - 1]?.text ?? '');
    }
    rows.push(cells);
  }
  return rows;
}

/**
 * Runs the full read-side pipeline for one uploaded workbook: extract every
 * sheet, detect its blocks, classify and map each one, reuse any confirmed
 * layout signature, and persist all of it for review.
 *
 * Nothing here writes canonical financial records — that is the commit step,
 * which happens only after an admin confirms the mappings.
 */
export async function runImport(
  db: AnyDb,
  uploadId: string,
  buffer: Buffer,
): Promise<ImportReport> {
  try {
    const grids = await extractWorkbook(buffer);
    const summaries: ImportedBlockSummary[] = [];
    let autoRecognized = 0;

    for (const grid of grids) {
      const [sheetRow] = await db.insert(sheets).values({
        uploadId,
        name: grid.name,
        index: grid.index,
        rowCount: grid.rowCount,
        colCount: grid.colCount,
      }).returning();

      for (const range of detectBlocks(grid)) {
        const classification = classifyBlock(grid, range);
        const headerRow = findHeaderRow(grid, range);
        const fingerprint = headerRow === null
          ? null
          : layoutFingerprint(grid, range, headerRow);

        let archetype = classification.archetype;
        let confidence = classification.confidence;
        let columnMap: ColumnMapping[] = [];
        let mappingSource: 'rules' | 'signature' = 'rules';

        const known = fingerprint
          ? await db.select().from(layoutSignatures)
              .where(eq(layoutSignatures.fingerprint, fingerprint))
          : [];

        if (known.length > 0 && known[0].pipelineVersion === PIPELINE_VERSION) {
          archetype = known[0].archetype;
          columnMap = known[0].columnMap;
          confidence = 1;
          mappingSource = 'signature';
          autoRecognized += 1;
        } else {
          columnMap = mapColumns(grid, range, archetype).mappings;
        }

        const [blockRow] = await db.insert(blocks).values({
          sheetId: sheetRow.id,
          top: range.top,
          left: range.left,
          bottom: range.bottom,
          right: range.right,
          archetype,
          confidence: confidence.toFixed(4),
          headerRow,
          fingerprint,
          pipelineVersion: PIPELINE_VERSION,
          rawGrid: sliceGrid(grid, range),
        }).returning();

        await db.insert(blockMappings).values({
          blockId: blockRow.id,
          columnMap,
          source: mappingSource,
        });

        summaries.push({
          blockId: blockRow.id,
          sheetName: grid.name,
          range,
          archetype,
          confidence,
          mappingSource,
          needsReview: mappingSource === 'rules'
            && (confidence < CONFIDENCE_THRESHOLD || columnMap.length === 0),
        });
      }
    }

    await db.update(uploads)
      .set({ status: 'parsed' })
      .where(eq(uploads.id, uploadId));

    return {
      uploadId,
      sheetCount: grids.length,
      blockCount: summaries.length,
      autoRecognized,
      needsReview: summaries.filter((s) => s.needsReview).length,
      blocks: summaries,
    };
  } catch (error) {
    await db.update(uploads)
      .set({ status: 'failed', error: error instanceof Error ? error.message : String(error) })
      .where(eq(uploads.id, uploadId));
    throw error;
  }
}
```

- [ ] **Step 4: Run tests and confirm they pass**

Run: `npx vitest run src/lib/import/run-import.test.ts`
Expected: PASS — 6 tests

- [ ] **Step 5: Commit**

```bash
git add src/lib/import/
git commit -m "feat: orchestrate the workbook import pipeline"
```

---

### Task 11: Private file storage

**Files:**
- Create: `src/lib/storage/index.ts`, `src/app/api/uploads/route.ts`
- Test: `src/lib/storage/storage.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `interface Storage { put(key: string, data: Buffer): Promise<string>; get(key: string): Promise<Buffer> }`
  - `getStorage(): Storage`
  - `sha256Hex(data: Buffer): string`

The `POST /api/uploads` route that consumes this driver is built in Task 12, because it depends on the admin guard defined there.

- [ ] **Step 1: Write the failing test**

Create `src/lib/storage/storage.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getStorage, sha256Hex } from '@/lib/storage';

describe('local storage driver', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'shliff-'));
    process.env.STORAGE_DRIVER = 'local';
    process.env.LOCAL_STORAGE_DIR = dir;
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('round-trips a buffer', async () => {
    const storage = getStorage();
    const payload = Buffer.from('קופת קאמפ', 'utf8');
    await storage.put('uploads/test.xlsx', payload);
    expect(await storage.get('uploads/test.xlsx')).toEqual(payload);
  });

  it('rejects keys that escape the storage directory', async () => {
    const storage = getStorage();
    await expect(storage.put('../escape.xlsx', Buffer.from('x'))).rejects.toThrow();
  });
});

describe('sha256Hex', () => {
  it('produces a stable 64-character hex digest', () => {
    const digest = sha256Hex(Buffer.from('abc'));
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(sha256Hex(Buffer.from('abc'))).toBe(digest);
  });

  it('differs for different content', () => {
    expect(sha256Hex(Buffer.from('a'))).not.toBe(sha256Hex(Buffer.from('b')));
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run src/lib/storage/storage.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement storage**

Create `src/lib/storage/index.ts`:

```ts
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';

export interface Storage {
  put(key: string, data: Buffer): Promise<string>;
  get(key: string): Promise<Buffer>;
}

export function sha256Hex(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

/**
 * Local-disk driver for development and tests. Uploaded workbooks contain
 * personal financial data, so the directory must never be served publicly.
 */
function localStorage(): Storage {
  const root = resolve(process.env.LOCAL_STORAGE_DIR ?? './.uploads');

  const safePath = (key: string): string => {
    const full = resolve(join(root, key));
    if (full !== root && !full.startsWith(root + sep)) {
      throw new Error(`storage key escapes the storage directory: ${key}`);
    }
    return full;
  };

  return {
    async put(key, data) {
      const path = safePath(key);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, data);
      return key;
    },
    async get(key) {
      return readFile(safePath(key));
    },
  };
}

/**
 * Vercel Blob driver. `access: 'private'` is required — these files must never
 * be publicly readable.
 */
function blobStorage(): Storage {
  return {
    async put(key, data) {
      const { put } = await import('@vercel/blob');
      const result = await put(key, data, { access: 'private' });
      return result.url;
    },
    async get(key) {
      const { head } = await import('@vercel/blob');
      const meta = await head(key);
      const response = await fetch(meta.url);
      return Buffer.from(await response.arrayBuffer());
    },
  };
}

export function getStorage(): Storage {
  return process.env.STORAGE_DRIVER === 'blob' ? blobStorage() : localStorage();
}
```

If `@vercel/blob` is not installed yet, run `npm install @vercel/blob`.

- [ ] **Step 4: Run tests and confirm they pass**

Run: `npx vitest run src/lib/storage/storage.test.ts`
Expected: PASS — 4 tests

- [ ] **Step 5: Commit**

```bash
git add src/lib/storage/
git commit -m "feat: add private file storage driver"
```

---

### Task 12: Authentication and admin guard

**Files:**
- Create: `src/db/schema/auth.ts`, `src/lib/auth/password.ts`, `src/lib/auth/config.ts`, `src/lib/auth/guard.ts`, `src/middleware.ts`, `scripts/create-admin.ts`
- Create: `src/app/api/uploads/route.ts`
- Test: `src/lib/auth/guard.test.ts`

**Interfaces:**
- Consumes: `db`
- Produces:
  - table `users` with `email`, `passwordHash`, `role`
  - `hashPassword(plain: string): Promise<string>`, `verifyPassword(hash: string, plain: string): Promise<boolean>` — from `@/lib/auth/password`, which imports nothing else
  - `requireAdmin(): Promise<{ ok: true; email: string } | { ok: false }>` — from `@/lib/auth/guard`
  - `POST /api/uploads`

- [ ] **Step 1: Write the failing test**

Create `src/lib/auth/guard.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword } from '@/lib/auth/password';

describe('password hashing', () => {
  it('verifies a correct password', async () => {
    const hash = await hashPassword('correct horse battery staple');
    expect(await verifyPassword(hash, 'correct horse battery staple')).toBe(true);
  });

  it('rejects an incorrect password', async () => {
    const hash = await hashPassword('correct horse battery staple');
    expect(await verifyPassword(hash, 'wrong password')).toBe(false);
  });

  it('produces a different hash each time for the same password', async () => {
    const a = await hashPassword('same');
    const b = await hashPassword('same');
    expect(a).not.toBe(b);
  });

  it('never stores the plaintext in the hash', async () => {
    const hash = await hashPassword('sekrit-value');
    expect(hash).not.toContain('sekrit-value');
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run src/lib/auth/guard.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the user schema**

Create `src/db/schema/auth.ts`:

```ts
import { pgTable, uuid, text, timestamp } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  /** admin | editor | viewer. Phase 1 onboards admins only. */
  role: text('role').notNull().default('viewer'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
```

- [ ] **Step 4: Implement password hashing and the guard**

Password helpers live in their own module with **no other imports**. This keeps
them testable without a database: `src/db/index.ts` throws at import time when
`DATABASE_URL` is unset, so a test importing the guard would fail before running.
It also breaks what would otherwise be an import cycle between `config.ts` and
`guard.ts`.

Create `src/lib/auth/password.ts`:

```ts
import argon2 from 'argon2';

export async function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, { type: argon2.argon2id });
}

export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    return false;
  }
}
```

Create `src/lib/auth/guard.ts`:

```ts
import { auth } from './config';

export type AdminCheck = { ok: true; email: string } | { ok: false };

/**
 * Server-side authorization gate. Every mutating route and server action calls
 * this. UI hiding is never the enforcement mechanism.
 */
export async function requireAdmin(): Promise<AdminCheck> {
  const session = await auth();
  const email = session?.user?.email;
  const role = (session?.user as { role?: string } | undefined)?.role;
  if (!email || role !== 'admin') return { ok: false };
  return { ok: true, email };
}
```

- [ ] **Step 5: Implement the Auth.js config**

Create `src/lib/auth/config.ts`:

```ts
import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { users } from '@/db/schema/auth';
import { verifyPassword } from './password';

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: 'jwt' },
  providers: [
    Credentials({
      credentials: { email: {}, password: {} },
      async authorize(raw) {
        const email = typeof raw?.email === 'string' ? raw.email : '';
        const password = typeof raw?.password === 'string' ? raw.password : '';
        if (!email || !password) return null;

        const [user] = await db.select().from(users).where(eq(users.email, email));
        if (!user) return null;
        if (!(await verifyPassword(user.passwordHash, password))) return null;

        return { id: user.id, email: user.email, role: user.role };
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) token.role = (user as { role?: string }).role;
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        (session.user as { role?: string }).role = token.role as string | undefined;
      }
      return session;
    },
  },
});
```

- [ ] **Step 6: Protect every route with middleware**

Create `src/middleware.ts`:

```ts
export { auth as middleware } from '@/lib/auth/config';

export const config = {
  /** Everything except Next internals, static assets, and the sign-in flow. */
  matcher: ['/((?!api/auth|_next/static|_next/image|favicon.ico|signin).*)'],
};
```

- [ ] **Step 7: Add the admin creation script**

Create `scripts/create-admin.ts`:

```ts
import { db } from '@/db';
import { users } from '@/db/schema/auth';
import { hashPassword } from '@/lib/auth/password';

const [email, password] = process.argv.slice(2);
if (!email || !password) {
  console.error('usage: npx tsx scripts/create-admin.ts <email> <password>');
  process.exit(1);
}

const passwordHash = await hashPassword(password);
const [row] = await db.insert(users)
  .values({ email, passwordHash, role: 'admin' })
  .returning();

console.log(`created admin ${row.email}`);
process.exit(0);
```

- [ ] **Step 8: Implement the upload route**

Create `src/app/api/uploads/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { uploads } from '@/db/schema/source';
import { getStorage, sha256Hex } from '@/lib/storage';
import { runImport } from '@/lib/import/run-import';
import { requireAdmin } from '@/lib/auth/guard';

const MAX_BYTES = 25 * 1024 * 1024;

export async function POST(request: Request): Promise<NextResponse> {
  const admin = await requireAdmin();
  if (!admin.ok) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const form = await request.formData();
  const file = form.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'missing file' }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: 'file too large' }, { status: 413 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const sha256 = sha256Hex(buffer);

  const existing = await db.select().from(uploads).where(eq(uploads.sha256, sha256));
  if (existing.length > 0) {
    return NextResponse.json(
      { uploadId: existing[0].id, duplicate: true },
      { status: 200 },
    );
  }

  const storageKey = `uploads/${sha256}.xlsx`;
  await getStorage().put(storageKey, buffer);

  const [row] = await db.insert(uploads).values({
    filename: file.name,
    sha256,
    storageKey,
    sizeBytes: buffer.byteLength,
    uploadedBy: admin.email,
  }).returning();

  const report = await runImport(db, row.id, buffer);
  return NextResponse.json({ uploadId: row.id, report }, { status: 201 });
}
```

- [ ] **Step 9: Regenerate migrations and run tests**

```bash
npx drizzle-kit generate
npm test
```

Expected: PASS — all tests including the 4 new password tests

- [ ] **Step 10: Commit**

```bash
git add src/db/schema/auth.ts src/lib/auth/ src/middleware.ts src/app/api/ scripts/ drizzle/
git commit -m "feat: add credential auth, admin guard, and upload endpoint"
```

---

### Task 13: RTL app shell and upload screen

**Files:**
- Modify: `src/app/layout.tsx`
- Create: `src/app/globals.css`, `src/app/(admin)/upload/page.tsx`, `src/app/(admin)/upload/upload-form.tsx`
- Test: `src/app/layout.test.tsx`

**Interfaces:**
- Consumes: `POST /api/uploads`
- Produces: `/upload` screen

- [ ] **Step 1: Install the test environment for components**

```bash
npm install -D @testing-library/react @testing-library/dom jsdom
```

Widen the test glob in `vitest.config.ts` so `.tsx` tests are picked up:

```ts
include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
```

Component tests opt into a DOM per file with a docblock rather than a config
glob — `environmentMatchGlobs` was removed in Vitest 3, whereas the docblock
works across versions.

- [ ] **Step 2: Write the failing test**

Create `src/app/layout.test.tsx`:

```tsx
/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import RootLayout from '@/app/layout';

describe('RootLayout', () => {
  it('renders the document right-to-left in Hebrew', () => {
    const element = RootLayout({ children: null }) as React.ReactElement<{
      lang: string; dir: string;
    }>;
    expect(element.props.lang).toBe('he');
    expect(element.props.dir).toBe('rtl');
  });
});
```

- [ ] **Step 3: Run it and confirm it fails**

Run: `npx vitest run src/app/layout.test.tsx`
Expected: FAIL — `dir` is undefined

- [ ] **Step 4: Implement the RTL shell**

Replace `src/app/layout.tsx`:

```tsx
import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'פלטפורמת שליף',
  description: 'ניהול נתוני הקאמפ',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="he" dir="rtl">
      <body>{children}</body>
    </html>
  );
}
```

Create `src/app/globals.css` — note the exclusive use of logical properties:

```css
:root {
  --bg: #faf9f7;
  --fg: #1c1b19;
  --muted: #6b6862;
  --border: #e2ded7;
  --accent: #b45309;
  --ok: #15803d;
  --warn: #b45309;
}

* { box-sizing: border-box; }

body {
  margin: 0;
  background: var(--bg);
  color: var(--fg);
  font-family: system-ui, 'Segoe UI', Arial, sans-serif;
  line-height: 1.6;
}

main {
  max-inline-size: 60rem;
  margin-inline: auto;
  padding-block: 2rem;
  padding-inline: 1.5rem;
}

h1 { font-size: 1.5rem; margin-block-end: 1rem; }

.card {
  border: 1px solid var(--border);
  border-radius: 0.5rem;
  padding: 1rem;
  margin-block-end: 1rem;
  background: #fff;
}

.muted { color: var(--muted); }
.badge-ok { color: var(--ok); }
.badge-warn { color: var(--warn); }

table { border-collapse: collapse; inline-size: 100%; }
th, td {
  border: 1px solid var(--border);
  padding: 0.375rem 0.5rem;
  text-align: start;
  font-size: 0.875rem;
}
th { background: #f5f2ec; font-weight: 600; }

.scroll-x { overflow-x: auto; }
```

- [ ] **Step 5: Implement the upload screen**

Create `src/app/(admin)/upload/upload-form.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function UploadForm() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    const form = new FormData(event.currentTarget);
    const response = await fetch('/api/uploads', { method: 'POST', body: form });
    const body = await response.json();

    setBusy(false);
    if (!response.ok) {
      setError(body.error ?? 'שגיאה בהעלאה');
      return;
    }
    router.push(`/imports/${body.uploadId}`);
  }

  return (
    <form onSubmit={onSubmit} className="card">
      <label htmlFor="file">קובץ אקסל של הקאמפ</label>
      <input id="file" name="file" type="file" accept=".xlsx" required />
      <button type="submit" disabled={busy}>
        {busy ? 'מעבד…' : 'העלה וסרוק'}
      </button>
      {error ? <p className="badge-warn">{error}</p> : null}
    </form>
  );
}
```

Create `src/app/(admin)/upload/page.tsx`:

```tsx
import { UploadForm } from './upload-form';

export default function UploadPage() {
  return (
    <main>
      <h1>העלאת קובץ</h1>
      <p className="muted">
        המערכת תזהה את הטבלאות בכל גיליון, תסווג אותן ותציג אותן לאישור.
      </p>
      <UploadForm />
    </main>
  );
}
```

- [ ] **Step 6: Run tests and confirm they pass**

Run: `npm test`
Expected: PASS — all tests including the layout test

- [ ] **Step 7: Commit**

```bash
git add src/app/
git commit -m "feat: add Hebrew RTL shell and workbook upload screen"
```

---

### Task 14: Import review screen

The screen that makes the pipeline's work visible and correctable.

**Files:**
- Create: `src/app/(admin)/imports/[id]/page.tsx`, `src/app/(admin)/imports/[id]/block-card.tsx`, `src/app/(admin)/imports/[id]/actions.ts`
- Test: `src/app/(admin)/imports/actions.test.ts`

**Interfaces:**
- Consumes: `blocks`, `blockMappings`, `layoutSignatures`, `requireAdmin`
- Produces: `confirmBlock(blockId: string, archetype: BlockArchetype, columnMap: ColumnMapping[]): Promise<void>` server action

- [ ] **Step 1: Write the failing test**

Create `src/app/(admin)/imports/actions.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDb, type TestDb } from '@/test/db';
import { uploads, sheets, blocks, blockMappings, layoutSignatures } from '@/db/schema/source';
import { applyConfirmation } from '@/app/(admin)/imports/[id]/actions';

async function seedBlock(db: TestDb, fingerprint: string | null) {
  const [upload] = await db.insert(uploads).values({
    filename: 'x.xlsx', sha256: 'a'.repeat(64), storageKey: 'k',
    sizeBytes: 1, uploadedBy: 'admin@example.com',
  }).returning();
  const [sheet] = await db.insert(sheets).values({
    uploadId: upload.id, name: 'סיכום כללי', index: 0, rowCount: 10, colCount: 4,
  }).returning();
  const [block] = await db.insert(blocks).values({
    sheetId: sheet.id, top: 1, left: 1, bottom: 5, right: 4,
    archetype: 'unknown', confidence: '0.1', headerRow: 1,
    fingerprint, pipelineVersion: 1, rawGrid: [['תאריך']],
  }).returning();
  await db.insert(blockMappings).values({
    blockId: block.id, columnMap: [], source: 'rules',
  });
  return block.id;
}

describe('applyConfirmation', () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await createTestDb();
  });

  it('updates the block archetype and records who confirmed it', async () => {
    const blockId = await seedBlock(db, 'f'.repeat(32));
    await applyConfirmation(db, 'admin@example.com', blockId, 'ledger', [
      { column: 1, field: 'date', confidence: 1 },
    ]);

    const [row] = await db.select().from(blocks).where(eq(blocks.id, blockId));
    expect(row.archetype).toBe('ledger');
    expect(row.confirmedBy).toBe('admin@example.com');
    expect(row.confirmedAt).toBeInstanceOf(Date);
  });

  it('replaces the block mapping and marks its source as admin', async () => {
    const blockId = await seedBlock(db, 'f'.repeat(32));
    await applyConfirmation(db, 'admin@example.com', blockId, 'ledger', [
      { column: 1, field: 'date', confidence: 1 },
    ]);

    const [mapping] = await db.select().from(blockMappings)
      .where(eq(blockMappings.blockId, blockId));
    expect(mapping.source).toBe('admin');
    expect(mapping.columnMap).toEqual([{ column: 1, field: 'date', confidence: 1 }]);
  });

  it('stores a reusable layout signature', async () => {
    const blockId = await seedBlock(db, 'f'.repeat(32));
    await applyConfirmation(db, 'admin@example.com', blockId, 'ledger', [
      { column: 1, field: 'date', confidence: 1 },
    ]);

    const stored = await db.select().from(layoutSignatures);
    expect(stored).toHaveLength(1);
    expect(stored[0].fingerprint).toBe('f'.repeat(32));
    expect(stored[0].archetype).toBe('ledger');
  });

  it('overwrites an existing signature for the same fingerprint', async () => {
    const first = await seedBlock(db, 'f'.repeat(32));
    await applyConfirmation(db, 'admin@example.com', first, 'ledger', []);
    await applyConfirmation(db, 'admin@example.com', first, 'budget_lines', []);

    const stored = await db.select().from(layoutSignatures);
    expect(stored).toHaveLength(1);
    expect(stored[0].archetype).toBe('budget_lines');
  });

  it('skips signature storage when the block has no fingerprint', async () => {
    const blockId = await seedBlock(db, null);
    await applyConfirmation(db, 'admin@example.com', blockId, 'obligations', []);
    expect(await db.select().from(layoutSignatures)).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run "src/app/(admin)/imports/actions.test.ts"`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the actions**

`applyConfirmation` takes the database as its first argument so it is testable without a request context; the exported server action wraps it.

Create `src/app/(admin)/imports/[id]/actions.ts`:

```ts
'use server';

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { db as productionDb } from '@/db';
import type { TestDb } from '@/test/db';
import { blocks, blockMappings, layoutSignatures } from '@/db/schema/source';
import type { ColumnMapping } from '@/lib/classify/map-columns';
import type { BlockArchetype } from '@/lib/classify/types';
import { requireAdmin } from '@/lib/auth/guard';

type AnyDb = typeof productionDb | TestDb;

/**
 * Records an admin's confirmation of one block: updates the block, replaces its
 * mapping, and stores the mapping as a reusable layout signature so the same
 * layout is recognized automatically in future uploads.
 */
export async function applyConfirmation(
  db: AnyDb,
  email: string,
  blockId: string,
  archetype: BlockArchetype,
  columnMap: ColumnMapping[],
): Promise<void> {
  const [block] = await db.select().from(blocks).where(eq(blocks.id, blockId));
  if (!block) throw new Error(`unknown block ${blockId}`);

  await db.update(blocks)
    .set({ archetype, confidence: '1.0000', confirmedBy: email, confirmedAt: new Date() })
    .where(eq(blocks.id, blockId));

  await db.update(blockMappings)
    .set({ columnMap, source: 'admin' })
    .where(eq(blockMappings.blockId, blockId));

  if (!block.fingerprint) return;

  await db.insert(layoutSignatures).values({
    fingerprint: block.fingerprint,
    archetype,
    columnMap,
    pipelineVersion: block.pipelineVersion,
    confirmedBy: email,
  }).onConflictDoUpdate({
    target: layoutSignatures.fingerprint,
    set: { archetype, columnMap, confirmedBy: email },
  });
}

export async function confirmBlock(
  blockId: string,
  archetype: BlockArchetype,
  columnMap: ColumnMapping[],
): Promise<void> {
  const admin = await requireAdmin();
  if (!admin.ok) throw new Error('unauthorized');

  await applyConfirmation(productionDb, admin.email, blockId, archetype, columnMap);
  revalidatePath('/imports');
}
```

- [ ] **Step 4: Run tests and confirm they pass**

Run: `npx vitest run "src/app/(admin)/imports/actions.test.ts"`
Expected: PASS — 5 tests

- [ ] **Step 5: Implement the block card**

Create `src/app/(admin)/imports/[id]/block-card.tsx`:

```tsx
import type { BlockArchetype } from '@/lib/classify/types';
import type { ColumnMapping } from '@/lib/classify/map-columns';

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

export interface BlockCardProps {
  sheetName: string;
  top: number;
  left: number;
  bottom: number;
  right: number;
  archetype: BlockArchetype;
  confidence: number;
  mappingSource: string;
  columnMap: ColumnMapping[];
  rawGrid: string[][];
}

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

export function BlockCard(props: BlockCardProps) {
  const { top, left, bottom, right, confidence, mappingSource } = props;
  const range = `${columnLabel(left)}${top}:${columnLabel(right)}${bottom}`;
  const auto = mappingSource === 'signature';

  return (
    <section className="card">
      <h2>
        {props.sheetName} <span className="muted">{range}</span>
      </h2>
      <p>
        סוג: <strong>{ARCHETYPE_LABELS[props.archetype]}</strong>{' '}
        <span className={confidence >= 0.5 ? 'badge-ok' : 'badge-warn'}>
          ביטחון {Math.round(confidence * 100)}%
        </span>{' '}
        {auto ? <span className="badge-ok">זוהה אוטומטית מפריסה מוכרת</span> : null}
      </p>

      <div className="scroll-x">
        <table>
          <tbody>
            {props.rawGrid.slice(0, 8).map((row, rowIndex) => (
              <tr key={rowIndex}>
                {row.map((cell, colIndex) => (
                  <td key={colIndex}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {props.columnMap.length > 0 ? (
        <p className="muted">
          עמודות:{' '}
          {props.columnMap
            .map((m) => `${columnLabel(m.column)} → ${m.field}`)
            .join(' · ')}
        </p>
      ) : (
        <p className="badge-warn">לא זוהו עמודות — נדרשת התאמה ידנית</p>
      )}
    </section>
  );
}
```

- [ ] **Step 6: Implement the review page**

Create `src/app/(admin)/imports/[id]/page.tsx`:

```tsx
import { eq } from 'drizzle-orm';
import { notFound } from 'next/navigation';
import { db } from '@/db';
import { uploads, sheets, blocks, blockMappings } from '@/db/schema/source';
import { requireAdmin } from '@/lib/auth/guard';
import { BlockCard } from './block-card';

export default async function ImportReviewPage(
  { params }: { params: Promise<{ id: string }> },
) {
  const admin = await requireAdmin();
  if (!admin.ok) notFound();

  const { id } = await params;
  const [upload] = await db.select().from(uploads).where(eq(uploads.id, id));
  if (!upload) notFound();

  const rows = await db
    .select({ block: blocks, sheet: sheets, mapping: blockMappings })
    .from(blocks)
    .innerJoin(sheets, eq(blocks.sheetId, sheets.id))
    .leftJoin(blockMappings, eq(blockMappings.blockId, blocks.id))
    .where(eq(sheets.uploadId, id));

  const needsReview = rows.filter(
    (r) => Number(r.block.confidence) < 0.5 || (r.mapping?.columnMap.length ?? 0) === 0,
  ).length;

  return (
    <main>
      <h1>סקירת ייבוא — {upload.filename}</h1>
      <p className="muted">
        {rows.length} טבלאות זוהו · {needsReview} דורשות בדיקה
      </p>

      {rows
        .sort((a, b) => a.sheet.index - b.sheet.index || a.block.top - b.block.top)
        .map(({ block, sheet, mapping }) => (
          <BlockCard
            key={block.id}
            sheetName={sheet.name}
            top={block.top}
            left={block.left}
            bottom={block.bottom}
            right={block.right}
            archetype={block.archetype}
            confidence={Number(block.confidence)}
            mappingSource={mapping?.source ?? 'rules'}
            columnMap={mapping?.columnMap ?? []}
            rawGrid={block.rawGrid}
          />
        ))}
    </main>
  );
}
```

- [ ] **Step 7: Run the full suite and typecheck**

```bash
npm test
npm run typecheck
```

Expected: PASS on both

- [ ] **Step 8: Commit**

```bash
git add src/app/
git commit -m "feat: add import review screen with per-block confirmation"
```

---

### Task 15: End-to-end verification against all three workbooks

Proves the whole plan's claim: these specific files parse correctly.

**Files:**
- Create: `src/lib/import/end-to-end.test.ts`
- Create: `docs/ingestion-report.md` (generated output, committed for review)

**Interfaces:**
- Consumes: everything above
- Produces: a committed report of what the pipeline found in each workbook

- [ ] **Step 1: Write the verification test**

Create `src/lib/import/end-to-end.test.ts`:

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { createTestDb, type TestDb } from '@/test/db';
import { uploads, blocks, sheets } from '@/db/schema/source';
import { runImport } from '@/lib/import/run-import';
import { FIXTURES, fixtureBuffer } from '@/test/fixtures';

describe('end-to-end ingestion of all reference workbooks', () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await createTestDb();
    let n = 0;
    for (const filename of [FIXTURES.y2324, FIXTURES.y25, FIXTURES.y26]) {
      n += 1;
      const [row] = await db.insert(uploads).values({
        filename,
        sha256: String(n).repeat(64).slice(0, 64),
        storageKey: `uploads/${n}.xlsx`,
        sizeBytes: 1,
        uploadedBy: 'admin@example.com',
      }).returning();
      await runImport(db, row.id, fixtureBuffer(filename));
    }
  });

  it('imports all 19 sheets across the three workbooks', async () => {
    expect(await db.select().from(sheets)).toHaveLength(19);
  });

  it('marks every upload as parsed', async () => {
    const rows = await db.select().from(uploads);
    expect(rows.every((r) => r.status === 'parsed')).toBe(true);
  });

  it('classifies the large majority of blocks', async () => {
    const rows = await db.select().from(blocks);
    const identified = rows.filter((b) => b.archetype !== 'unknown');
    expect(identified.length / rows.length).toBeGreaterThan(0.6);
  });

  it('finds every archetype that the reference data actually contains', async () => {
    const rows = await db.select().from(blocks);
    const found = new Set(rows.map((b) => b.archetype));
    for (const expected of ['ledger', 'budget_lines', 'ticket_rounds']) {
      expect(found.has(expected as never), `missing ${expected}`).toBe(true);
    }
  });

  it('stores a fingerprint for every block that has a header row', async () => {
    const rows = await db.select().from(blocks);
    for (const block of rows) {
      if (block.headerRow !== null) expect(block.fingerprint).toMatch(/^[0-9a-f]{32}$/);
    }
  });
});
```

- [ ] **Step 2: Run it**

Run: `npx vitest run src/lib/import/end-to-end.test.ts`
Expected: PASS — 5 tests

The 60% classification threshold is a floor, not a target. If it fails, tune `lexicon.ts` weights and re-run the full suite. Report the actual figure in the commit message.

- [ ] **Step 3: Generate the ingestion report**

Create `scripts/ingestion-report.ts`:

```ts
import { createTestDb } from '@/test/db';
import { uploads, sheets, blocks } from '@/db/schema/source';
import { runImport } from '@/lib/import/run-import';
import { FIXTURES, fixtureBuffer } from '@/test/fixtures';
import { eq } from 'drizzle-orm';
import { writeFileSync } from 'node:fs';

const db = await createTestDb();
const lines: string[] = ['# Ingestion report', ''];

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
      `| ${s.name} | r${b.top}c${b.left}:r${b.bottom}c${b.right} | ${b.archetype} | ${Number(b.confidence).toFixed(2)} |`,
    );
  }
  lines.push('');
}

writeFileSync('docs/ingestion-report.md', lines.join('\n'), 'utf8');
console.log('wrote docs/ingestion-report.md');
process.exit(0);
```

Run it:

```bash
npx tsx scripts/ingestion-report.ts
```

- [ ] **Step 4: Review the report by hand**

Open `docs/ingestion-report.md` and check each row against the source workbook. Every misclassification is a lexicon tuning task, not a code change. Fix, re-run, regenerate.

- [ ] **Step 5: Commit**

```bash
git add src/lib/import/end-to-end.test.ts scripts/ingestion-report.ts docs/ingestion-report.md
git commit -m "test: verify ingestion end to end across all reference workbooks"
```

---

---

### Task 16: Management shell and navigation

The product is a management site for running a camp, not a parser with a page bolted on. Data exploration is one section; member management and camp-fee tracking are coming. The shell has to make that shape legible from the first screen.

**Files:**
- Create: `src/app/(admin)/layout.tsx`, `src/app/(admin)/nav.tsx`, `src/app/(admin)/nav.module.css`, `src/app/(admin)/page.tsx`
- Modify: `src/app/(admin)/data/page.tsx` (drop its own `<header>`; the shell owns navigation now)
- Test: `src/app/(admin)/nav.test.tsx`

**Interfaces:**
- Consumes: nothing beyond React and `next/link` / `next/navigation`
- Produces: `<Nav current={pathname} />`; an `(admin)` layout wrapping every admin route

- [ ] **Step 1: Write the failing test**

Create `src/app/(admin)/nav.test.tsx`:

```tsx
/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Nav } from '@/app/(admin)/nav';

describe('Nav', () => {
  it('links to the sections that are built', () => {
    render(<Nav current="/data" />);
    expect(screen.getByRole('link', { name: 'נתונים' })).toHaveProperty('href');
    expect(screen.getByRole('link', { name: 'ייבוא' })).toHaveProperty('href');
  });

  it('marks the current section for assistive technology', () => {
    render(<Nav current="/data" />);
    expect(screen.getByRole('link', { name: 'נתונים' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('link', { name: 'ייבוא' }).getAttribute('aria-current')).toBeNull();
  });

  it('shows planned sections as disabled rather than hiding them', () => {
    render(<Nav current="/data" />);
    // Planned sections communicate where the product is going; they must be
    // visible but must not be links, so nobody clicks into a dead end.
    const members = screen.getByText('חברי מחנה');
    expect(members.tagName).not.toBe('A');
    expect(members.getAttribute('aria-disabled')).toBe('true');
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `./node_modules/.bin/vitest run "src/app/(admin)/nav.test.tsx"`
Expected: FAIL — cannot find module `nav`

- [ ] **Step 3: Implement the nav**

Create `src/app/(admin)/nav.tsx`. It carries the camp's logo, which lives at
`public/logo-dark.png` — a transparent variant generated from `docs/brand/shliff_logo.jpeg`
with the brand's pure black remapped to the off-white text colour, because the original
artwork's black linework is invisible on a dark surface:

```tsx
import Image from 'next/image';
import Link from 'next/link';
import styles from './nav.module.css';

interface Section {
  href: string;
  label: string;
  /** Planned but not built: shown, never linked. */
  planned?: boolean;
}

const SECTIONS: Section[] = [
  { href: '/', label: 'סקירה' },
  { href: '/data', label: 'נתונים' },
  { href: '/upload', label: 'ייבוא' },
  { href: '/members', label: 'חברי מחנה', planned: true },
  { href: '/fees', label: 'דמי קאמפ', planned: true },
];

export function Nav({ current }: { current: string }) {
  return (
    <nav className={styles.nav} aria-label="ניווט ראשי">
      <span className={styles.brand}>
        <Image src="/logo-dark.png" alt="" width={64} height={64} className={styles.mark} />
        <span className={styles.wordmark}>קופת שליף</span>
      </span>
      <ul className={styles.list}>
        {SECTIONS.map((section) =>
          section.planned ? (
            <li key={section.href}>
              <span className={styles.planned} aria-disabled="true">
                {section.label}
                <span className={styles.soon}>בקרוב</span>
              </span>
            </li>
          ) : (
            <li key={section.href}>
              <Link
                href={section.href}
                className={styles.link}
                aria-current={current === section.href ? 'page' : undefined}
              >
                {section.label}
              </Link>
            </li>
          ),
        )}
      </ul>
    </nav>
  );
}
```

- [ ] **Step 4: Implement the nav styles**

Create `src/app/(admin)/nav.module.css`. Use the **camp brand palette** — pure black `#000000`
and `#EB7837` orange, sampled from the logo — matching `data.module.css` so the shell and the
explorer read as one product. Keep every property logical (`inline`/`block`), never
`left`/`right`. Hold the orange as the only loud colour: it marks the current section and
focus rings, nothing else.

```css
.nav {
  display: flex;
  align-items: center;
  gap: 2rem;
  padding: 0.9rem 2rem;
  background: #000000;
  border-block-end: 1px solid #2b2724;
  color: #f2ede6;
}
.brand { display: flex; align-items: center; gap: 0.6rem; }
.mark { inline-size: 1.9rem; block-size: 1.9rem; }
.wordmark { font-family: var(--font-display), Georgia, serif; font-size: 1.2rem; }
.list { display: flex; gap: 0.35rem; list-style: none; margin: 0; padding: 0; }
.link {
  display: block;
  padding: 0.35rem 0.85rem;
  border-radius: 999px;
  color: #98918a;
  text-decoration: none;
  font-size: 0.92rem;
}
.link:hover { color: #f2ede6; }
.link[aria-current='page'] { background: #eb7837; color: #000000; font-weight: 600; }
.link:focus-visible { outline: 2px solid #eb7837; outline-offset: 2px; }
.planned {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.35rem 0.85rem;
  color: #5c554e;
  font-size: 0.92rem;
  cursor: not-allowed;
}
.soon {
  font-size: 0.7rem;
  border: 1px solid #2b2724;
  border-radius: 999px;
  padding: 0.05rem 0.4rem;
}
```

- [ ] **Step 5: Implement the layout and landing page**

Create `src/app/(admin)/layout.tsx`:

```tsx
import { headers } from 'next/headers';
import { Nav } from './nav';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = (await headers()).get('x-pathname') ?? '/';
  return (
    <>
      <Nav current={pathname} />
      {children}
    </>
  );
}
```

Create `src/app/(admin)/page.tsx` — the landing screen, which names what the platform does and what is not built yet rather than showing an empty dashboard:

```tsx
import Link from 'next/link';

export default function OverviewPage() {
  return (
    <main>
      <h1>קופת שליף</h1>
      <p className="muted">
        ניהול הכספים של הקאמפ — תקציבים, אירועים, חובות וקיזוזים, במקום אחד.
      </p>
      <ul>
        <li>
          <Link href="/data">נתונים</Link> — כל מה שזוהה בקבצי האקסל, לפי שנה
        </li>
        <li>
          <Link href="/upload">ייבוא</Link> — העלאת קובץ חדש וזיהוי הטבלאות שבו
        </li>
      </ul>
      <p className="muted">
        חברי מחנה ודמי קאמפ עדיין לא נבנו. הם השלב הבא אחרי שהנתונים יושבים במסד.
      </p>
    </main>
  );
}
```

Note: `x-pathname` is not a header Next sets by itself. Add it in `src/middleware.ts` (created in Task 12) by setting it on the forwarded request headers. If Task 12 has not run yet, make `AdminLayout` fall back to `'/'` as written above — the test covers `Nav` directly, so the layout's current-section highlight is a progressive enhancement, not a tested behaviour.

- [ ] **Step 6: Remove the duplicated header from the data explorer**

In `src/app/(admin)/data/data-explorer.tsx`, delete the `<header className={styles.bar}>` block and its wordmark, keeping the year tabs. Move the year tabs into the page body above the hero. The shell now owns the top bar; two stacked bars is the bug this step prevents.

- [ ] **Step 7: Run tests and confirm they pass**

Run: `./node_modules/.bin/vitest run "src/app/(admin)/nav.test.tsx"`
Expected: PASS — 3 tests

Then load `http://localhost:3000/` and `http://localhost:3000/data` and confirm one navigation bar appears, the current section is highlighted, and the planned sections are visible but not clickable.

- [ ] **Step 8: Commit**

```bash
git add "src/app/(admin)"
git commit -m "feat: add management shell with section navigation"
```

---

### Task 17: Seed the reference workbooks into the database

Until this task, `/data` reparses three `.xlsx` files on every request. That is fine for a preview and wrong for a product: nothing is stored, nothing can be edited, and no later feature can build on it. Seeding moves the workbooks into the database through the real import pipeline.

**Files:**
- Create: `src/lib/import/seed.ts`, `src/app/(admin)/upload/seed-button.tsx`
- Modify: `src/app/(admin)/upload/page.tsx` (add the seed control)
- Test: `src/lib/import/seed.test.ts`

**Interfaces:**
- Consumes: `runImport` (Task 10), `uploads` schema (Task 9), `sha256Hex` (Task 11), `FIXTURES`/`fixtureBuffer` (Task 3)
- Produces: `seedReferenceWorkbooks(db): Promise<SeedResult>` where `interface SeedResult { imported: string[]; skipped: string[] }`

- [ ] **Step 1: Write the failing test**

Create `src/lib/import/seed.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb, type TestDb } from '@/test/db';
import { uploads, sheets } from '@/db/schema/source';
import { seedReferenceWorkbooks } from '@/lib/import/seed';

describe('seedReferenceWorkbooks', () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await createTestDb();
  });

  it('imports all three reference workbooks', async () => {
    const result = await seedReferenceWorkbooks(db);
    expect(result.imported).toHaveLength(3);
    expect(result.skipped).toHaveLength(0);
    expect(await db.select().from(uploads)).toHaveLength(3);
    expect(await db.select().from(sheets)).toHaveLength(19);
  });

  it('is idempotent — seeding twice does not duplicate anything', async () => {
    await seedReferenceWorkbooks(db);
    const second = await seedReferenceWorkbooks(db);

    expect(second.imported).toHaveLength(0);
    expect(second.skipped).toHaveLength(3);
    expect(await db.select().from(uploads)).toHaveLength(3);
    expect(await db.select().from(sheets)).toHaveLength(19);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `./node_modules/.bin/vitest run src/lib/import/seed.test.ts`
Expected: FAIL — cannot find module `seed`

- [ ] **Step 3: Implement**

Create `src/lib/import/seed.ts`:

```ts
import { eq } from 'drizzle-orm';
import type { Db } from '@/db';
import type { TestDb } from '@/test/db';
import { uploads } from '@/db/schema/source';
import { sha256Hex } from '@/lib/storage';
import { FIXTURES, fixtureBuffer } from '@/test/fixtures';
import { runImport } from './run-import';

export interface SeedResult {
  imported: string[];
  skipped: string[];
}

/**
 * Loads the camp's historical workbooks into the database through the normal
 * import pipeline — the same path an uploaded file takes, so seeded data is
 * indistinguishable from imported data.
 *
 * Idempotent by content hash: re-seeding skips workbooks already present.
 */
export async function seedReferenceWorkbooks(db: Db | TestDb): Promise<SeedResult> {
  const result: SeedResult = { imported: [], skipped: [] };

  for (const filename of [FIXTURES.y2324, FIXTURES.y25, FIXTURES.y26]) {
    const buffer = fixtureBuffer(filename);
    const sha256 = sha256Hex(buffer);

    const existing = await db.select().from(uploads).where(eq(uploads.sha256, sha256));
    if (existing.length > 0) {
      result.skipped.push(filename);
      continue;
    }

    const [row] = await db.insert(uploads).values({
      filename,
      sha256,
      storageKey: `seed/${sha256}.xlsx`,
      sizeBytes: buffer.byteLength,
      uploadedBy: 'seed',
    }).returning();

    await runImport(db, row.id, buffer);
    result.imported.push(filename);
  }

  return result;
}
```

- [ ] **Step 4: Run tests and confirm they pass**

Run: `./node_modules/.bin/vitest run src/lib/import/seed.test.ts`
Expected: PASS — 2 tests

- [ ] **Step 5: Add the seed control to the import screen**

Create `src/app/(admin)/upload/seed-button.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { seedAction } from './actions';

export function SeedButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function onSeed() {
    setBusy(true);
    const result = await seedAction();
    setBusy(false);
    setMessage(
      result.imported.length > 0
        ? `נטענו ${result.imported.length} קבצים`
        : 'כל הקבצים כבר במסד',
    );
    router.refresh();
  }

  return (
    <div>
      <button type="button" onClick={onSeed} disabled={busy}>
        {busy ? 'טוען…' : 'טען את קבצי העבר'}
      </button>
      {message ? <p className="muted">{message}</p> : null}
    </div>
  );
}
```

Create `src/app/(admin)/upload/actions.ts`:

```ts
'use server';

import { db } from '@/db';
import { requireAdmin } from '@/lib/auth/guard';
import { seedReferenceWorkbooks, type SeedResult } from '@/lib/import/seed';

export async function seedAction(): Promise<SeedResult> {
  const admin = await requireAdmin();
  if (!admin.ok) throw new Error('unauthorized');
  return seedReferenceWorkbooks(db);
}
```

Add `<SeedButton />` to `src/app/(admin)/upload/page.tsx` beneath the upload form, under a heading `טעינת נתוני עבר`.

- [ ] **Step 6: Commit**

```bash
git add src/lib/import/seed.ts src/lib/import/seed.test.ts "src/app/(admin)/upload"
git commit -m "feat: seed the historical workbooks into the database"
```

## Definition of Done

- [ ] `npm test` passes with no skipped tests
- [ ] `npm run typecheck` passes
- [ ] All three reference workbooks import without error, producing 19 sheets
- [ ] `docs/ingestion-report.md` is committed and has been reviewed by hand
- [ ] An admin can sign in, upload a workbook, and see every detected block with its classification
- [ ] Confirming a block stores a layout signature, and re-importing a file with that layout marks the block auto-recognized
- [ ] No route is reachable without authentication
- [ ] The reference workbooks in `docs/reference-data/` are unmodified
- [ ] The app reads as a **management site**: a persistent navigation shell where data exploration is one section among several, with member management and camp fees visible as planned sections rather than absent
- [ ] The three historical workbooks can be seeded into the database from the UI, and seeding twice does not duplicate anything

## Follow-up plans

- **Plan 02** — LLM classification fallback (spec §3), canonical model, commit pipeline, append-only audit log (spec step 1c, requirements 15–19 and 32)
- **Plan 03** — Revisions, three-way merge, conflict UI, the six validation rules (spec steps 1d and §6)
- **Plan 04** — Events, ticket rounds, dues, obligations (spec steps 1e–1f)
- **Plan 05** — Camp member management: roster, roles, contact details, per-season membership
- **Plan 06** — Camp fee management and tracking: dues per member per season, payment status,
  exceptions (the `חריגים` block in ברן 25), reminders, and reconciliation against the ledger

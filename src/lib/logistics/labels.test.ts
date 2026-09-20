import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  CATEGORY_LABELS, CONDITION_LABELS, SOURCE_LABELS, STATUS_LABELS,
  MATERIAL_STATE_LABELS,
} from './labels';

/**
 * The library home for logistics enum labels, written the way `work/labels.ts`
 * had to be rewritten: every map is `Record<T, string>`, so `tsc` is the
 * exhaustiveness check. The defect that made that refactor necessary was one
 * copy typed `Record<string, string>` — a fifth member could be added and that
 * screen would silently render the raw enum value on a Hebrew page.
 */
describe('logistics labels', () => {
  const CATEGORIES = ['kitchen', 'sanitation', 'living', 'build', 'general'] as const;
  const CONDITIONS = ['ready', 'needs_testing', 'needs_repair', 'retired'] as const;
  const SOURCES = ['buy_new', 'second_hand', 'borrow_member'] as const;
  const STATUSES = ['to_search', 'in_review', 'ordered', 'arrived'] as const;
  const MATERIAL_STATES = ['in_stock', 'needs_repair', 'obtained', 'missing'] as const;

  it('names every member of every enum', () => {
    for (const k of CATEGORIES) expect(CATEGORY_LABELS[k]).toBeTruthy();
    for (const k of CONDITIONS) expect(CONDITION_LABELS[k]).toBeTruthy();
    for (const k of SOURCES) expect(SOURCE_LABELS[k]).toBeTruthy();
    for (const k of STATUSES) expect(STATUS_LABELS[k]).toBeTruthy();
    for (const k of MATERIAL_STATES) expect(MATERIAL_STATE_LABELS[k]).toBeTruthy();
  });

  it('uses the spellings the design and the artboards already agreed', () => {
    expect(CATEGORY_LABELS.sanitation).toBe('מקלחות ותברואה');
    expect(CATEGORY_LABELS.build).toBe('בנייה, כלים ותשתיות');
    expect(CONDITION_LABELS.ready).toBe('תקין ומוכן');
    expect(SOURCE_LABELS.borrow_member).toBe('השאלה מחבר קאמפ');
    expect(STATUS_LABELS.arrived).toBe('הגיע למחסן');
  });

  it('gives the retired state a word, because the row stays visible', () => {
    // This product does not delete. A pump broken beyond repair becomes a row
    // that says so — an absence would be indistinguishable from "nobody has
    // entered it yet".
    expect(CONDITION_LABELS.retired).toBe('יצא משימוש');
  });

  it('names a material that is owned and broken as both, not as one', () => {
    // `דורש תיקון` alone would send somebody out to buy one when the camp
    // owns one three metres away; `במחסן` alone would have them looking for
    // something that cannot be used.
    expect(MATERIAL_STATE_LABELS.needs_repair).toBe('במחסן · דורש תיקון');
  });

  it('says nothing in English, on any of the twenty', () => {
    const every = [
      ...Object.values(CATEGORY_LABELS),
      ...Object.values(CONDITION_LABELS),
      ...Object.values(SOURCE_LABELS),
      ...Object.values(STATUS_LABELS),
      ...Object.values(MATERIAL_STATE_LABELS),
    ];
    expect(every).toHaveLength(20);
    for (const label of every) {
      expect(label).not.toMatch(/[A-Za-z]/);
      expect(label.trim()).toBe(label);
    }
  });

  /**
   * The net that makes the single home real. `work/labels.ts` earned this: four
   * copies of one idea lived across three files, and the distribution — not the
   * duplication — was the defect.
   */
  it('is the only place these maps are written', () => {
    const root = resolve(process.cwd(), 'src');
    const found: string[] = [];

    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) { walk(path); continue; }
        if (!/\.tsx?$/.test(entry.name)) continue;
        if (path.endsWith(join('logistics', 'labels.ts'))) continue;
        if (path.endsWith(join('logistics', 'labels.test.ts'))) continue;
        const src = readFileSync(path, 'utf8');
        if (/CATEGORY_LABELS\s*(:|=)\s*\{|CONDITION_LABELS\s*(:|=)\s*\{/.test(src)) {
          found.push(path.replace(root, 'src'));
        }
      }
    };
    walk(root);

    expect(found).toEqual([]);
  });
});

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  TASK_KIND_LABELS, TASK_KIND_GROUP_LABELS, TASK_KIND_ROW_LABELS,
} from './labels';

/**
 * A39. This file is the library home for task-kind labels, and the other three
 * maps collapse into it.
 *
 * The three are not duplicates of one another, which is why the fix is three
 * exports rather than one: a group heading is plural (`משמרות`), a row's second
 * line is written in a longer register (`אחריות על סעיף תקציב`), and a
 * person's responsibility list names the kind on its own (`משמרת`). What made
 * them a defect was that they lived in three files, one of them typed
 * `Record<string, string>` so no fifth kind could ever break it.
 */
describe('task-kind labels', () => {
  const KINDS = ['shift', 'event_task', 'deliverable', 'build'] as const;

  it('names every kind in all three registers', () => {
    for (const kind of KINDS) {
      expect(TASK_KIND_LABELS[kind]).toBeTruthy();
      expect(TASK_KIND_GROUP_LABELS[kind]).toBeTruthy();
      expect(TASK_KIND_ROW_LABELS[kind]).toBeTruthy();
    }
  });

  it('keeps the spellings the screens already earned', () => {
    expect(TASK_KIND_LABELS.shift).toBe('משמרת');
    expect(TASK_KIND_LABELS.deliverable).toBe('אחריות תקציבית');
    expect(TASK_KIND_GROUP_LABELS.shift).toBe('משמרות');
    expect(TASK_KIND_GROUP_LABELS.event_task).toBe('משימות באירועים');
    expect(TASK_KIND_ROW_LABELS.build).toBe('משימת הקמה');
    expect(TASK_KIND_ROW_LABELS.deliverable).toBe('אחריות על סעיף תקציב');
  });

  it('says nothing in English, on any of the twelve', () => {
    const every = [
      ...Object.values(TASK_KIND_LABELS),
      ...Object.values(TASK_KIND_GROUP_LABELS),
      ...Object.values(TASK_KIND_ROW_LABELS),
    ];
    expect(every).toHaveLength(12);
    expect(every.filter((label) => /[A-Za-z]/.test(label))).toEqual([]);
  });

  /**
   * The consolidation itself, netted rather than promised. A fifth copy is a
   * fifth vocabulary, and the reason A39 deferred this to one pass is that
   * each copy looked reasonable in the file it was written in.
   *
   * It matches on the map's *shape* — an object literal keyed by all four
   * `TaskKind` members — rather than on a name, so a map called something else
   * does not slip through.
   */
  it('leaves no second map of the kinds anywhere else in src', () => {
    const here = resolve(process.cwd(), 'src/lib/work/labels.ts');
    const files: string[] = [];
    (function walk(dir: string) {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (/\.tsx?$/.test(path) && !/\.test\.tsx?$/.test(path)) files.push(path);
      }
    }(resolve(process.cwd(), 'src')));

    const offenders = files.filter((file) => {
      if (file === here) return false;
      const source = readFileSync(file, 'utf8');
      // All four kinds appearing as object keys in one file is a kind map.
      return /\bshift:\s*'/.test(source)
        && /\bevent_task:\s*'/.test(source)
        && /\bdeliverable:\s*'/.test(source)
        && /\bbuild:\s*'/.test(source);
    });
    expect(offenders).toEqual([]);
  });
});

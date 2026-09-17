import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { basename, join, relative } from 'node:path';

/**
 * B8, as a net rather than a checklist: every page names itself. Before the
 * redesign every tab in the browser read "פלטפורמת שליף", so a lead with the
 * roster and a person open could not tell them apart.
 *
 * Walks the filesystem rather than a route list, so a page added later
 * cannot forget.
 */
function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

const APP_DIR = join(process.cwd(), 'src', 'app');
const pages = walk(APP_DIR).filter((file) => basename(file) === 'page.tsx');

describe('every page names itself', () => {
  it('found pages to check', () => {
    expect(pages.length).toBeGreaterThan(5);
  });

  it.each(pages.map((file) => [relative(process.cwd(), file), file] as const))(
    '%s exports a title',
    (_label, file) => {
      const source = readFileSync(file, 'utf8');
      const named = source.includes('export const metadata')
        || source.includes('export async function generateMetadata');
      expect(named).toBe(true);
    },
  );

  it('the root layout leaves room for a page to fill in its own name', () => {
    const source = readFileSync(join(APP_DIR, 'layout.tsx'), 'utf8');
    expect(source).toContain('template:');
  });
});

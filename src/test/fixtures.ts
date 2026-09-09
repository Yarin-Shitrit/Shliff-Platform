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

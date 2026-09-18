import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { toHebrewError, HEBREW_FALLBACK } from '@/lib/errors/hebrew';
import { FEE_ERRORS } from './error-messages';

/**
 * The old version of this file hand-transcribed `FEE_ERRORS` into a second
 * table and compared the two — which only proves `toHebrewError` (already
 * covered by `hebrew.test.ts`) can look itself up in a map, and stays green
 * no matter how far `dues.ts`/`payments.ts` drift from that map, because it
 * never reads either file.
 *
 * This reads the real throw sites off disk instead — the same pattern as
 * `src/app/admin-guard.test.ts` and `src/app/page-title.test.ts` — and checks
 * each one against `FEE_ERRORS` directly. Reword a throw and there is
 * nothing left hand-transcribed to agree with it: the corresponding case
 * below fails.
 */

/** Hebrew letters, `א`–`ת` and the cantillation block around them. */
const HEBREW_LETTER = /[֐-׿]/;
/** Latin letters — their presence means the message was not written for a lead. */
const LATIN_LETTER = /[A-Za-z]/;

/**
 * A message already in Hebrew with no Latin letters passes `toHebrewError`
 * through unchanged (see `hebrew.ts`'s passthrough rule) and needs no
 * `FEE_ERRORS` entry of its own — the `קיזוז` refusal below is exactly this
 * case, and the "already-Hebrew" test further down covers that path.
 */
function isHebrewPassthrough(literal: string): boolean {
  return HEBREW_LETTER.test(literal) && !LATIN_LETTER.test(literal);
}

/**
 * Pulls every `throw new Error(...)` literal out of a source file, reduced
 * to the static text before any `${...}` interpolation — which is exactly
 * what `toHebrewError`'s prefix match sees at runtime regardless of what a
 * real id interpolates to.
 */
function thrownLiterals(source: string): string[] {
  const pattern = /throw new Error\(\s*(?:`([^`]*)`|'([^']*)'|"([^"]*)")/g;
  const out: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source))) {
    const literal = match[1] ?? match[2] ?? match[3] ?? '';
    out.push(literal.split('${')[0]);
  }
  return out;
}

const DUES_SOURCE = readFileSync(join(process.cwd(), 'src/lib/fees/dues.ts'), 'utf8');
const PAYMENTS_SOURCE = readFileSync(join(process.cwd(), 'src/lib/fees/payments.ts'), 'utf8');

const throwSites = [
  ...thrownLiterals(DUES_SOURCE).map((literal) => [`dues.ts: ${literal}`, literal] as const),
  ...thrownLiterals(PAYMENTS_SOURCE).map((literal) => [`payments.ts: ${literal}`, literal] as const),
].filter(([, literal]) => !isHebrewPassthrough(literal));

describe('FEE_ERRORS covers every throw in dues.ts and payments.ts', () => {
  // A silent empty scan would make every case below vacuously pass — same
  // defence as admin-guard.test.ts and page-title.test.ts.
  it('found throw sites to check', () => {
    expect(throwSites.length).toBeGreaterThan(5);
  });

  it.each(throwSites)('%s is mapped by a FEE_ERRORS prefix', (_label, literal) => {
    const covered = FEE_ERRORS.some(([prefix]) => literal.startsWith(prefix));
    expect(covered).toBe(true);
  });
});

describe('FEE_ERRORS', () => {
  it('lets the already-Hebrew קיזוז refusal through unchanged', () => {
    const hebrew = 'קיזוז אינו מזיז מזומן, ולכן אינו נכנס לחשבון';
    expect(toHebrewError(new Error(hebrew), FEE_ERRORS)).toBe(hebrew);
  });

  it('renders the generic Hebrew fallback for a message nobody mapped', () => {
    expect(toHebrewError(new Error('relation "dues" does not exist'), FEE_ERRORS))
      .toBe(HEBREW_FALLBACK);
  });

  it('contains no Latin letters in any Hebrew message it produces', () => {
    for (const [, hebrew] of FEE_ERRORS) expect(hebrew).not.toMatch(/[A-Za-z]/);
    expect(HEBREW_FALLBACK).not.toMatch(/[A-Za-z]/);
  });
});

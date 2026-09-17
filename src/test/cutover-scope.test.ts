/**
 * Covers `placeInScope` in `scripts/cutover.ts` — the one decision that tells
 * an enumerated row it is another season's business from one this database has
 * never heard of.
 *
 * It lives under `src/` for the same reason `scratch-guard.test.ts` does:
 * `vitest.config.ts` only discovers `src/**`, and the subject is a script, so
 * the import is relative. The subject is a separate module from `cutover.ts`
 * for the same reason `scratch-guard.ts` is: importing `cutover.ts` would run
 * it.
 *
 * The bug this exists to prevent is a silent success, not a crash. `cutover.ts`
 * used to ask `byBlock.get(id)?.seasonId === scope.seasonId`, which is `false`
 * for a block that is not in the map at all — the same answer it gives for a
 * block belonging to another season. If the evidence's ids ever stop matching
 * the target database (a re-import assigns fresh ids, or the clone is not the
 * database the evidence was taken against), a scoped run would file every
 * enumerated row under "left alone", promote, delete nothing, and print
 * `committed`. Nothing would look wrong.
 */
import { describe, it, expect } from 'vitest';
import { placeInScope } from '../../scripts/cutover-scope';

/** The real ids, so a copy-paste slip between the two blocks shows up here. */
const LEDGER_26 = '6f1a7fc4-03ac-4ec3-abe4-0b5a863e133f';
const LEDGER_25 = 'ac5a9d6e-8b52-40a9-bfea-a22771a2e4c6';
/** `Shliff Deco 24` — a real block on one of the eight unlabelled sheets. */
const UNLABELLED = 'f051cd61-0000-0000-0000-000000000000';
const S25 = 'season-25';
const S26 = 'season-26';

const known = new Set([LEDGER_25, LEDGER_26, UNLABELLED]);
const seasonOf = (id: string): string | null => {
  if (id === LEDGER_25) return S25;
  if (id === LEDGER_26) return S26;
  return null;
};

const place = (id: string, scope: string | null) => placeInScope(id, known, seasonOf, scope);

describe('placeInScope — in, out, or not here at all', () => {
  it('puts a block of the scoped season in scope', () => {
    expect(place(LEDGER_26, S26)).toBe('in');
  });

  it('puts a block of another season out of scope', () => {
    expect(place(LEDGER_25, S26)).toBe('out');
  });

  it('puts every known block in scope when there is no scope', () => {
    expect(place(LEDGER_25, null)).toBe('in');
    expect(place(LEDGER_26, null)).toBe('in');
  });

  /** An unlabelled sheet has no season, so it matches no scope — but it is a
   *  block this database really has, which is a different fact from the one
   *  below and has to stay a different answer. */
  it('puts a block with no season out of scope, not unknown', () => {
    expect(place(UNLABELLED, S26)).toBe('out');
  });

  it('puts a block with no season in scope under an unscoped run', () => {
    expect(place(UNLABELLED, null)).toBe('in');
  });

  // -- the regression ------------------------------------------------------

  it('calls an id this database does not have unknown, not out of scope', () => {
    expect(place('11111111-2222-3333-4444-555555555555', S26)).toBe('unknown');
  });

  /**
   * The case a `?.seasonId === scope` check could never have caught, because
   * an unscoped run never compared seasons at all: an unknown id has to refuse
   * on BOTH paths, or the evidence pointing at the wrong database is a silent
   * no-op under exactly the invocation a lead is most likely to use first.
   */
  it('calls an id this database does not have unknown under an unscoped run too', () => {
    expect(place('11111111-2222-3333-4444-555555555555', null)).toBe('unknown');
  });

  it('never confuses "not here" with "another season"', () => {
    const missing = place('11111111-2222-3333-4444-555555555555', S26);
    const otherSeason = place(LEDGER_25, S26);
    expect(missing).not.toBe(otherSeason);
  });
});

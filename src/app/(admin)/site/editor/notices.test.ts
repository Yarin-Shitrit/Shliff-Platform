import { describe, expect, it } from 'vitest';
import { isolate } from './notices';

/*
 * #25 fix round, Important 4: a name inside a Hebrew sentence is isolated
 * with FSI (U+2068), which takes its direction from the name's own first
 * strong letter, as <bdi> does. LRI (U+2066) forced left-to-right on every
 * name: a Hebrew label with a Latin word — "אוהל VIP" — then read "VIP אוהל".
 */
describe('a name inside a sentence', () => {
  it('is isolated first-strong, so a Hebrew name stays right to left and a Latin one left to right', () => {
    expect(isolate('אוהל VIP')).toBe('⁨אוהל VIP⁩');
    expect(isolate('Kitchen 2')).toBe('⁨Kitchen 2⁩');
    expect(isolate('אוהל VIP').startsWith('⁦')).toBe(false);
  });
});

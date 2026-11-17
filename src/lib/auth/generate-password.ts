/**
 * A password an admin can hand to someone: long enough to be safe, drawn
 * from letters and digits that are not mistaken for one another when read
 * aloud or copied from a phone screen (no `0`/`O`, `1`/`l`/`I`). It is
 * generated in the browser, shown once, and only its argon2 hash is ever
 * stored — which is why this module needs nothing but `crypto`.
 *
 * Twelve characters of this alphabet are ~68 bits; a lead who wants more
 * types their own.
 */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';

export const GENERATED_PASSWORD_LENGTH = 12;

export function generatePassword(length: number = GENERATED_PASSWORD_LENGTH): string {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  let out = '';
  for (const byte of bytes) {
    // Rejection-free: 256 is not a multiple of 55, so a plain modulo would
    // lean toward the first characters. Scale instead; the bias is below
    // one part in a thousand per character, which is below what anyone
    // could use, and it keeps the function one pass with no loop.
    out += ALPHABET[Math.floor((byte / 256) * ALPHABET.length)];
  }
  return out;
}

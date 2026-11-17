import { describe, it, expect } from 'vitest';
import { GENERATED_PASSWORD_LENGTH, generatePassword } from './generate-password';
import { MIN_PASSWORD_LENGTH } from './pages';

describe('generatePassword', () => {
  it('is long enough for the library to accept, at its default length', () => {
    expect(GENERATED_PASSWORD_LENGTH).toBeGreaterThanOrEqual(MIN_PASSWORD_LENGTH);
    expect(generatePassword()).toHaveLength(GENERATED_PASSWORD_LENGTH);
    expect(generatePassword(20)).toHaveLength(20);
  });

  it('uses only characters that read unambiguously off a phone screen', () => {
    for (let i = 0; i < 50; i += 1) {
      expect(generatePassword()).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789]+$/);
    }
  });

  it('does not repeat itself', () => {
    const seen = new Set(Array.from({ length: 200 }, () => generatePassword()));
    expect(seen.size).toBe(200);
  });
});

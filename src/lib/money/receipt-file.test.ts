import { describe, it, expect } from 'vitest';
import {
  MAX_RECEIPT_BYTES, newReceiptKey, receiptContentType, sniffReceipt,
} from './receipt-file';

const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46]);
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const WEBP = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50]);

describe('what a receipt file is', () => {
  it('reads the type from the bytes', () => {
    expect(sniffReceipt(JPEG)).toBe('jpg');
    expect(sniffReceipt(PNG)).toBe('png');
    expect(sniffReceipt(WEBP)).toBe('webp');
  });

  it('answers null for anything that is not one of the three', () => {
    expect(sniffReceipt(new TextEncoder().encode('%PDF-1.7 not a picture'))).toBeNull();
    expect(sniffReceipt(new TextEncoder().encode('<svg onload="x()"></svg>'))).toBeNull();
    // RIFF, but a WAV: the container alone does not make it a picture.
    expect(sniffReceipt(Uint8Array.from([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x41, 0x56, 0x45]))).toBeNull();
    expect(sniffReceipt(new Uint8Array())).toBeNull();
    expect(sniffReceipt(Uint8Array.from([0xff, 0xd8]))).toBeNull();
  });

  it('stays under the 4.5 MB a Vercel function can receive or answer with', () => {
    expect(MAX_RECEIPT_BYTES).toBeLessThan(4.5 * 1024 * 1024);
  });
});

describe('a receipt key', () => {
  it('is new each time, under receipts/, and serves as the type it was stored as', () => {
    const first = newReceiptKey('jpg');
    const second = newReceiptKey('jpg');
    expect(first).not.toBe(second);
    expect(first).toMatch(/^receipts\/[0-9a-f-]{36}\.jpg$/);
    expect(receiptContentType(first)).toBe('image/jpeg');
    expect(receiptContentType(newReceiptKey('png'))).toBe('image/png');
    expect(receiptContentType(newReceiptKey('webp'))).toBe('image/webp');
  });

  it('answers null for a key this module did not write', () => {
    for (const key of [
      'uploads/camp-fees.xlsx',
      'receipts/../uploads/camp-fees.xlsx',
      'receipts/0b7c6a52-8f7e-4c1e-9a55-3d2f1e0c9b8a.svg',
      'receipts/0b7c6a52-8f7e-4c1e-9a55-3d2f1e0c9b8a.jpg/..',
      'site-underlays/0b7c6a52-8f7e-4c1e-9a55-3d2f1e0c9b8a/x.jpg',
      '',
    ]) {
      expect(receiptContentType(key), key).toBeNull();
    }
  });
});

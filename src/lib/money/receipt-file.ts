import { randomUUID } from 'node:crypto';

/**
 * A receipt's photo, as the server accepts it.
 *
 * The phone shrinks the picture before it is sent
 * (`src/app/(admin)/money/expenses/compress-receipt.ts`), so what arrives is
 * normally a JPEG of a few hundred KB. The cap below is for the case where
 * shrinking was not possible and the original came through: 4 MB keeps the
 * request under Vercel's 4.5 MB body limit and the response under the same
 * limit on the way back out.
 */
export const MAX_RECEIPT_BYTES = 4 * 1024 * 1024;
/** The whole multipart request: the file, plus room for the form's fields. */
export const MAX_RECEIPT_REQUEST_BYTES = MAX_RECEIPT_BYTES + 64 * 1024;

export type ReceiptExt = 'jpg' | 'png' | 'webp';

const CONTENT_TYPES: Readonly<Record<ReceiptExt, string>> = {
  jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
};

/**
 * What the bytes are, read from the bytes. The browser's declared type and
 * the file's name are whatever the sender typed, so neither is asked.
 */
export function sniffReceipt(bytes: Uint8Array): ReceiptExt | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpg';
  if (bytes.length >= 8
    && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
    && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return 'png';
  if (bytes.length >= 12
    && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
    && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return 'webp';
  return null;
}

/** A new key per photo. Random rather than the content's hash: the same
 *  receipt photographed for two expenses is two records, and Vercel Blob
 *  refuses to write a pathname twice. */
export function newReceiptKey(ext: ReceiptExt): string {
  return `receipts/${randomUUID()}.${ext}`;
}

const RECEIPT_KEY = /^receipts\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$/;

/** The type to serve a stored key as, or null for anything this module did
 *  not write — so a row holding some other string never reaches storage. */
export function receiptContentType(key: string): string | null {
  const match = RECEIPT_KEY.exec(key);
  return match === null ? null : CONTENT_TYPES[match[1] as ReceiptExt];
}

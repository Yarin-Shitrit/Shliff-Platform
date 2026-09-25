/**
 * What kind of picture a file is and how many pixels it holds, read from its
 * first bytes (spec §16, §19), never by decoding it. The upload route refuses
 * a 48-megapixel photo without ever holding its pixels, and the scene knows
 * how far to shrink a picture before the browser decodes it.
 *
 * It also reads the one thing a phone photo needs before it is shown: its
 * EXIF orientation. A photo held upright is usually stored sideways with a
 * tag saying so. The browser turns it (`imageOrientation: 'from-image'`), and
 * the picture as shown is the stored one with its sides swapped
 * (`displaySize`). Only JPEG carries the tag in practice.
 *
 * No imports, no DOM, no Node: the route, the card and the scene each hand it
 * a `Uint8Array`.
 */

export type ImageKind = 'png' | 'jpeg' | 'webp' | 'gif' | 'pdf' | 'heic' | 'svg' | 'unknown';

export interface ImageFacts {
  kind: ImageKind;
  /** As stored, before any EXIF turn. Null when the header does not say. */
  width: number | null;
  height: number | null;
  /** The EXIF orientation, 1 to 8; 1 when the file carries none. */
  orientation: number;
}

/** The brands an iPhone's HEIC/HEIF photo opens with (`ftyp`). AVIF's own brand is not one of them. */
const HEIC_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'hevm', 'hevs', 'mif1', 'msf1']);

/** The JPEG frame markers that carry the picture's size: every SOFn but DHT (C4), JPG (C8) and DAC (CC). */
const JPEG_FRAMES = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function text(bytes: Uint8Array, at: number, length: number): string {
  let out = '';
  for (let i = at; i < at + length && i < bytes.length; i += 1) out += String.fromCharCode(bytes[i]);
  return out;
}

/* Multiplication, not shifts: a shift makes a 32-bit signed number, and a width of 2^31 would read as negative. */
function be16(bytes: Uint8Array, at: number): number {
  return bytes[at] * 0x100 + bytes[at + 1];
}

function be32(bytes: Uint8Array, at: number): number {
  return bytes[at] * 0x1000000 + bytes[at + 1] * 0x10000 + bytes[at + 2] * 0x100 + bytes[at + 3];
}

function le16(bytes: Uint8Array, at: number): number {
  return bytes[at] + bytes[at + 1] * 0x100;
}

function le24(bytes: Uint8Array, at: number): number {
  return bytes[at] + bytes[at + 1] * 0x100 + bytes[at + 2] * 0x10000;
}

function le32(bytes: Uint8Array, at: number): number {
  return le24(bytes, at) + bytes[at + 3] * 0x1000000;
}

function unsized(kind: ImageKind, orientation = 1): ImageFacts {
  return { kind, width: null, height: null, orientation };
}

function sized(kind: ImageKind, width: number, height: number, orientation = 1): ImageFacts {
  return { kind, width, height, orientation };
}

function png(bytes: Uint8Array): ImageFacts {
  // The first chunk is always IHDR, and its data starts with the width and the height.
  if (bytes.length < 24 || text(bytes, 12, 4) !== 'IHDR') return unsized('png');
  return sized('png', be32(bytes, 16), be32(bytes, 20));
}

/** The orientation tag (0x0112) in an APP1 Exif segment's first directory, or null. */
function exifOrientation(bytes: Uint8Array, start: number, end: number): number | null {
  if (text(bytes, start, 6) !== 'Exif\u0000\u0000') return null;
  const tiff = start + 6;
  const order = text(bytes, tiff, 2);
  if (order !== 'II' && order !== 'MM') return null;
  const little = order === 'II';
  const u16 = (at: number) => (little ? le16(bytes, at) : be16(bytes, at));
  const u32 = (at: number) => (little ? le32(bytes, at) : be32(bytes, at));
  if (tiff + 8 > end || u16(tiff + 2) !== 42) return null;
  const directory = tiff + u32(tiff + 4);
  if (directory + 2 > end) return null;
  const entries = u16(directory);
  for (let i = 0; i < entries; i += 1) {
    const entry = directory + 2 + i * 12;
    if (entry + 12 > end) return null;
    if (u16(entry) === 0x0112) {
      // A SHORT sits in the first two bytes of the entry's value field, in the file's byte order.
      const value = u16(entry + 8);
      return value >= 1 && value <= 8 ? value : null;
    }
  }
  return null;
}

/**
 * Walks the segments to the frame header. EXIF, colour profiles and XMP come
 * first and can run to tens of kilobytes, so each segment is skipped by its
 * stated length. Searching for the frame marker's bytes would find one inside
 * a thumbnail or a profile as easily as the real one.
 */
function jpeg(bytes: Uint8Array): ImageFacts {
  let orientation = 1;
  let at = 2;
  while (at + 4 <= bytes.length) {
    if (bytes[at] !== 0xff) break;
    const marker = bytes[at + 1];
    if (marker === 0xff) {
      at += 1; // a fill byte
      continue;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      at += 2; // a marker with no length
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) break; // the image ends, or its data starts: no size ahead
    const length = be16(bytes, at + 2);
    if (length < 2) break;
    if (JPEG_FRAMES.has(marker)) {
      if (at + 9 > bytes.length) break;
      return sized('jpeg', be16(bytes, at + 7), be16(bytes, at + 5), orientation);
    }
    if (marker === 0xe1) {
      orientation = exifOrientation(bytes, at + 4, Math.min(bytes.length, at + 2 + length)) ?? orientation;
    }
    at += 2 + length;
  }
  return unsized('jpeg', orientation);
}

function webp(bytes: Uint8Array): ImageFacts {
  const chunk = text(bytes, 12, 4);
  // Lossy: a three-byte frame tag, the start code 9D 01 2A, then 14-bit width and height.
  if (chunk === 'VP8 ' && bytes.length >= 30 && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
    return sized('webp', le16(bytes, 26) & 0x3fff, le16(bytes, 28) & 0x3fff);
  }
  // Lossless: the signature 0x2F, then width − 1 and height − 1 in 14 bits each.
  if (chunk === 'VP8L' && bytes.length >= 25 && bytes[20] === 0x2f) {
    const bits = le32(bytes, 21);
    return sized('webp', (bits % 0x4000) + 1, (Math.floor(bits / 0x4000) % 0x4000) + 1);
  }
  // Extended: flags and three reserved bytes, then the canvas's width − 1 and height − 1 in 24 bits each.
  if (chunk === 'VP8X' && bytes.length >= 30) {
    return sized('webp', le24(bytes, 24) + 1, le24(bytes, 27) + 1);
  }
  return unsized('webp');
}

export function imageFacts(bytes: Uint8Array): ImageFacts {
  if (PNG_SIGNATURE.every((byte, i) => bytes[i] === byte)) return png(bytes);
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return jpeg(bytes);
  if (text(bytes, 0, 4) === 'RIFF' && text(bytes, 8, 4) === 'WEBP') return webp(bytes);
  const head = text(bytes, 0, 6);
  if (head === 'GIF87a' || head === 'GIF89a') {
    return bytes.length >= 10 ? sized('gif', le16(bytes, 6), le16(bytes, 8)) : unsized('gif');
  }
  if (text(bytes, 0, 5) === '%PDF-') return unsized('pdf');
  if (text(bytes, 4, 4) === 'ftyp' && HEIC_BRANDS.has(text(bytes, 8, 4))) return unsized('heic');
  const start = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 3 : 0;
  if (/^\s*<(\?xml|svg[\s>/])/i.test(text(bytes, start, 256))) return unsized('svg');
  return unsized('unknown');
}

/** The picture's size as the browser shows it, after its EXIF turn: orientations 5 to 8 are a quarter turn. */
export function displaySize(facts: ImageFacts): { width: number; height: number } | null {
  if (facts.width === null || facts.height === null) return null;
  return facts.orientation >= 5
    ? { width: facts.height, height: facts.width }
    : { width: facts.width, height: facts.height };
}

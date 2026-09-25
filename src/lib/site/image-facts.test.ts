import { describe, it, expect } from 'vitest';
import { displaySize, imageFacts } from './image-facts';

type Part = number[] | string | Uint8Array;

function join(...parts: Part[]): Uint8Array {
  const out: number[] = [];
  for (const part of parts) {
    if (typeof part === 'string') for (let i = 0; i < part.length; i += 1) out.push(part.charCodeAt(i));
    else for (const byte of part) out.push(byte);
  }
  return Uint8Array.from(out);
}

const be16 = (n: number) => [(n >> 8) & 0xff, n & 0xff];
const be32 = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
const le16 = (n: number) => [n & 0xff, (n >> 8) & 0xff];
const le24 = (n: number) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff];
const le32 = (n: number) => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];

function png(width: number, height: number): Uint8Array {
  return join([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], be32(13), 'IHDR', be32(width), be32(height), [8, 6, 0, 0, 0]);
}

/** An APP1 Exif segment whose first directory holds one entry: the orientation (tag 0x0112, SHORT). */
function exifSegment(orientation: number, little: boolean): Uint8Array {
  const u16 = little ? le16 : be16;
  const u32 = little ? le32 : be32;
  const tiff = join(little ? 'II' : 'MM', u16(42), u32(8), u16(1), u16(0x0112), u16(3), u32(1), u16(orientation), [0, 0], u32(0));
  const body = join('Exif', [0, 0], tiff);
  return join([0xff, 0xe1], be16(body.length + 2), body);
}

/** SOI, JFIF, an optional EXIF, a 60 kB APP2 with a decoy frame header inside, then the real (progressive) frame header and the scan. */
function jpeg(width: number, height: number, exif?: { orientation: number; little: boolean }): Uint8Array {
  const app0 = join([0xff, 0xe0], be16(16), 'JFIF', [0], [1, 1, 0], be16(72), be16(72), [0, 0]);
  const profile = new Uint8Array(60_000).fill(0xab);
  profile.set([0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x10, 0x00, 0x10], 100);
  const app2 = join([0xff, 0xe2], be16(profile.length + 2), profile);
  const frame = join([0xff, 0xc2], be16(17), [8], be16(height), be16(width), [3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]);
  return join([0xff, 0xd8], app0, exif === undefined ? [] : exifSegment(exif.orientation, exif.little), app2, frame, [0xff, 0xda, 0, 8]);
}

function webpLossy(width: number, height: number): Uint8Array {
  return join('RIFF', le32(22), 'WEBP', 'VP8 ', le32(10), [0x30, 0x01, 0x00], [0x9d, 0x01, 0x2a], le16(width), le16(height));
}

function webpLossless(width: number, height: number): Uint8Array {
  return join('RIFF', le32(13), 'WEBP', 'VP8L', le32(5), [0x2f], le32((width - 1) + (height - 1) * 0x4000));
}

function webpExtended(width: number, height: number): Uint8Array {
  return join('RIFF', le32(18), 'WEBP', 'VP8X', le32(10), [0x08, 0, 0, 0], le24(width - 1), le24(height - 1));
}

describe('what a picture is, from its first bytes', () => {
  it('reads a PNG’s size from its header', () => {
    expect(imageFacts(png(1600, 1200))).toEqual({ kind: 'png', width: 1600, height: 1200, orientation: 1 });
  });

  it('reads a JPEG’s size from its frame header, past the segments before it — skipped by length, never searched', () => {
    expect(imageFacts(jpeg(2048, 1536))).toEqual({ kind: 'jpeg', width: 2048, height: 1536, orientation: 1 });
  });

  it('reads the EXIF orientation of a phone photo stored sideways, in either byte order (Review Focus #1)', () => {
    expect(imageFacts(jpeg(4032, 3024, { orientation: 6, little: false })))
      .toEqual({ kind: 'jpeg', width: 4032, height: 3024, orientation: 6 });
    expect(imageFacts(jpeg(4032, 3024, { orientation: 8, little: true })).orientation).toBe(8);
    expect(imageFacts(jpeg(4032, 3024, { orientation: 3, little: true })).orientation).toBe(3);
  });

  it('shows a picture turned a quarter by its tag with its sides swapped, and any other as stored (Review Focus #1)', () => {
    expect(displaySize(imageFacts(jpeg(4032, 3024, { orientation: 6, little: false })))).toEqual({ width: 3024, height: 4032 });
    expect(displaySize(imageFacts(jpeg(4032, 3024, { orientation: 8, little: true })))).toEqual({ width: 3024, height: 4032 });
    expect(displaySize(imageFacts(jpeg(4032, 3024, { orientation: 3, little: false })))).toEqual({ width: 4032, height: 3024 });
    expect(displaySize(imageFacts(png(10, 20)))).toEqual({ width: 10, height: 20 });
  });

  it('reads the three kinds of WebP', () => {
    expect(imageFacts(webpLossy(800, 600))).toEqual({ kind: 'webp', width: 800, height: 600, orientation: 1 });
    expect(imageFacts(webpLossless(640, 480))).toEqual({ kind: 'webp', width: 640, height: 480, orientation: 1 });
    expect(imageFacts(webpLossless(1, 1))).toMatchObject({ width: 1, height: 1 });
    expect(imageFacts(webpLossless(16384, 16384))).toMatchObject({ width: 16384, height: 16384 });
    expect(imageFacts(webpExtended(5000, 4000))).toEqual({ kind: 'webp', width: 5000, height: 4000, orientation: 1 });
  });

  it('names what the map will not show: a PDF, an iPhone photo, a GIF and an SVG', () => {
    expect(imageFacts(join('%PDF-1.7\n'))).toMatchObject({ kind: 'pdf', width: null });
    expect(imageFacts(join(be32(24), 'ftyp', 'heic', be32(0), 'mif1', 'heic')).kind).toBe('heic');
    expect(imageFacts(join(be32(24), 'ftyp', 'mif1', be32(0), 'mif1', 'heic')).kind).toBe('heic');
    expect(imageFacts(join('GIF89a', le16(320), le16(200)))).toEqual({ kind: 'gif', width: 320, height: 200, orientation: 1 });
    expect(imageFacts(join('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"/>')).kind).toBe('svg');
    expect(imageFacts(join([0xef, 0xbb, 0xbf], '  <svg width="10"/>')).kind).toBe('svg');
  });

  it('does not take an AVIF photo for an iPhone one', () => {
    expect(imageFacts(join(be32(24), 'ftyp', 'avif', be32(0), 'avif', 'mif1')).kind).toBe('unknown');
  });

  it('says no size when a file is cut short, and nothing at all about an unknown one', () => {
    expect(imageFacts(join([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toEqual({ kind: 'png', width: null, height: null, orientation: 1 });
    expect(imageFacts(join([0xff, 0xd8, 0xff, 0xe0], be16(16), 'JFIF'))).toMatchObject({ kind: 'jpeg', width: null });
    expect(imageFacts(join('hello'))).toEqual({ kind: 'unknown', width: null, height: null, orientation: 1 });
    expect(imageFacts(new Uint8Array(0)).kind).toBe('unknown');
    expect(displaySize(imageFacts(join('hello')))).toBeNull();
  });
});

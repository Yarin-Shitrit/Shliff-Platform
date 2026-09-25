import { describe, it, expect } from 'vitest';
import { checkUnderlayFile } from './underlay-file';
import { MAX_UNDERLAY_BYTES } from './underlay-limits';

function bytes(...parts: Array<number[] | string>): number[] {
  const out: number[] = [];
  for (const part of parts) {
    if (typeof part === 'string') for (let i = 0; i < part.length; i += 1) out.push(part.charCodeAt(i));
    else out.push(...part);
  }
  return out;
}
const be16 = (n: number) => [(n >> 8) & 0xff, n & 0xff];
const be32 = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
const le32 = (n: number) => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];

/** A PNG header, zero-padded to `padTo` bytes: the checks read the header, not the pixels. */
function png(width: number, height: number, padTo = 0): Uint8Array {
  const header = bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], be32(13), 'IHDR', be32(width), be32(height), [8, 6, 0, 0, 0]);
  const out = new Uint8Array(Math.max(padTo, header.length));
  out.set(header);
  return out;
}
const jpeg = (width: number, height: number) =>
  Uint8Array.from(bytes([0xff, 0xd8], [0xff, 0xc0], be16(17), [8], be16(height), be16(width), [3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]));
const webp = (width: number, height: number) =>
  Uint8Array.from(bytes('RIFF', le32(13), 'WEBP', 'VP8L', le32(5), [0x2f], le32((width - 1) + (height - 1) * 0x4000)));
const PDF = Uint8Array.from(bytes('%PDF-1.7\n'));
const HEIC = Uint8Array.from(bytes(be32(24), 'ftyp', 'heic', be32(0), 'mif1', 'heic'));
const GIF = Uint8Array.from(bytes('GIF89a', [0x40, 0x01, 0xc8, 0x00]));
const SVG = Uint8Array.from(bytes('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"/>'));

describe('an image to trace, checked the same way in the browser and on the server', () => {
  it('takes a PNG, a JPEG and a WebP, whatever the case of the name', () => {
    expect(checkUnderlayFile('sketch.png', png(1600, 1200)))
      .toEqual({ ok: true, ext: 'png', contentType: 'image/png', width: 1600, height: 1200 });
    expect(checkUnderlayFile('IMG_2231.JPG', jpeg(4032, 3024))).toMatchObject({ ok: true, ext: 'jpg', contentType: 'image/jpeg' });
    expect(checkUnderlayFile('scan.jpeg', jpeg(800, 600))).toMatchObject({ ok: true, ext: 'jpg' });
    expect(checkUnderlayFile('מגרש.webp', webp(900, 700))).toMatchObject({ ok: true, ext: 'webp', contentType: 'image/webp' });
  });

  it('takes exactly 4 MB and refuses one byte more, before anything else about it', () => {
    expect(checkUnderlayFile('big.png', png(1600, 1200, MAX_UNDERLAY_BYTES)).ok).toBe(true);
    expect(checkUnderlayFile('big.png', png(1600, 1200, MAX_UNDERLAY_BYTES + 1)))
      .toEqual({ ok: false, code: 'file too large', status: 413 });
    const bigPdf = new Uint8Array(MAX_UNDERLAY_BYTES + 1);
    bigPdf.set(PDF);
    expect(checkUnderlayFile('plan.pdf', bigPdf)).toMatchObject({ code: 'file too large' });
  });

  it('says what to do with a PDF or an iPhone photo, found by its bytes or by its name', () => {
    expect(checkUnderlayFile('plan.pdf', PDF)).toEqual({ ok: false, code: 'pdf', status: 415 });
    expect(checkUnderlayFile('plan.png', PDF)).toMatchObject({ code: 'pdf' });
    expect(checkUnderlayFile('plan.pdf', png(400, 300))).toMatchObject({ code: 'pdf' });
    expect(checkUnderlayFile('IMG_0001.HEIC', HEIC)).toEqual({ ok: false, code: 'heic', status: 415 });
    expect(checkUnderlayFile('IMG_0001.jpg', HEIC)).toMatchObject({ code: 'heic' });
    expect(checkUnderlayFile('IMG_0001.heif', jpeg(400, 300))).toMatchObject({ code: 'heic' });
  });

  it('refuses any other kind, and a name that disagrees with the bytes', () => {
    const unsupported = { ok: false, code: 'unsupported file type', status: 415 };
    expect(checkUnderlayFile('anim.gif', GIF)).toEqual(unsupported);
    expect(checkUnderlayFile('plan.svg', SVG)).toEqual(unsupported);
    expect(checkUnderlayFile('sketch.jpg', png(400, 300))).toEqual(unsupported);
    expect(checkUnderlayFile('sketch', png(400, 300))).toEqual(unsupported);
    expect(checkUnderlayFile('notes.png', Uint8Array.from(bytes('hello')))).toEqual(unsupported);
    // A PNG cut off after its signature states no size, so nothing can be checked against the limits.
    expect(checkUnderlayFile('cut.png', png(400, 300).slice(0, 8))).toEqual(unsupported);
  });

  it('refuses under 100 or over 8192 pixels on a side, and takes both edges', () => {
    expect(checkUnderlayFile('a.png', png(99, 500))).toEqual({ ok: false, code: 'image too small', status: 422 });
    expect(checkUnderlayFile('a.png', png(500, 99))).toMatchObject({ code: 'image too small' });
    expect(checkUnderlayFile('a.png', png(100, 100)).ok).toBe(true);
    expect(checkUnderlayFile('a.png', png(8192, 8192)).ok).toBe(true);
    expect(checkUnderlayFile('a.png', png(8193, 500))).toEqual({ ok: false, code: 'image too large', status: 422 });
    expect(checkUnderlayFile('a.png', png(500, 8193))).toMatchObject({ code: 'image too large' });
  });
});

/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { RECEIPT_JPEG_QUALITY, RECEIPT_MAX_EDGE, compressReceipt, fitWithin } from './compress-receipt';

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('the size a receipt is shrunk to', () => {
  it('brings the long side to the cap and keeps the shape', () => {
    expect(fitWithin(4000, 3000)).toEqual({ width: 1600, height: 1200 });
    expect(fitWithin(3024, 4032)).toEqual({ width: 1200, height: 1600 });
  });

  it('never enlarges a picture already inside the cap', () => {
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 });
    expect(fitWithin(RECEIPT_MAX_EDGE, 10)).toEqual({ width: RECEIPT_MAX_EDGE, height: 10 });
  });

  it('never rounds a long thin till roll down to nothing', () => {
    expect(fitWithin(40, 20000)).toEqual({ width: 3, height: 1600 });
    expect(fitWithin(1, 100000).width).toBe(1);
  });
});

/** jsdom has no canvas and no decoder, so both are stood in for here. */
function stubCanvas(result: Blob | null) {
  const drawImage = vi.fn();
  const toBlob = vi.fn((done: (blob: Blob | null) => void) => { done(result); });
  const canvas = {
    width: 0, height: 0, toBlob,
    getContext: () => ({ fillStyle: '', fillRect: vi.fn(), drawImage }),
  };
  const create = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation((tag: string) => (
    tag === 'canvas' ? canvas as unknown as HTMLCanvasElement : create(tag)
  ));
  return { canvas, toBlob, drawImage };
}

function stubDecoder(width: number, height: number) {
  const close = vi.fn();
  const decode = vi.fn(async () => ({ width, height, close }));
  vi.stubGlobal('createImageBitmap', decode);
  return { decode, close };
}

const photo = (bytes: number, type = 'image/jpeg') =>
  new File([new Uint8Array(bytes)], 'IMG_0412.jpg', { type });

describe('shrinking a receipt before it is sent', () => {
  it('redraws a camera photo at the capped size as a JPEG at the set quality', async () => {
    const small = new Blob([new Uint8Array(300)], { type: 'image/jpeg' });
    const { canvas, toBlob, drawImage } = stubCanvas(small);
    const { decode, close } = stubDecoder(4000, 3000);
    const file = photo(5000);

    expect(await compressReceipt(file)).toBe(small);
    expect(decode).toHaveBeenCalledWith(file, { imageOrientation: 'from-image' });
    expect([canvas.width, canvas.height]).toEqual([1600, 1200]);
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 1600, 1200);
    expect(toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/jpeg', RECEIPT_JPEG_QUALITY);
    expect(close).toHaveBeenCalled();
  });

  it('keeps the original when re-encoding made it bigger', async () => {
    stubCanvas(new Blob([new Uint8Array(900)], { type: 'image/jpeg' }));
    stubDecoder(400, 300);
    const file = photo(500);
    expect(await compressReceipt(file)).toBe(file);
  });

  it('still converts a format the server does not take, even when that is bigger', async () => {
    const converted = new Blob([new Uint8Array(900)], { type: 'image/jpeg' });
    stubCanvas(converted);
    stubDecoder(400, 300);
    expect(await compressReceipt(photo(500, 'image/heic'))).toBe(converted);
  });

  it('sends the original when the browser cannot decode the picture', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn(async () => { throw new Error('decode failed'); }));
    const file = photo(500);
    expect(await compressReceipt(file)).toBe(file);
  });

  it('sends the original when the canvas gives nothing back', async () => {
    stubCanvas(null);
    stubDecoder(4000, 3000);
    const file = photo(5000);
    expect(await compressReceipt(file)).toBe(file);
  });
});

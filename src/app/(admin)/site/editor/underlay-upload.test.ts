import { describe, it, expect, vi } from 'vitest';
import { uploadUnderlay, type UploadDeps } from './underlay-upload';

const PLAN = '0b7c6a52-8f7e-4c1e-9a55-3d2f1e0c9b8a';
const OTHER = '5e1d2c3b-4a59-4876-9e0f-a1b2c3d4e5f6';
const KEY = `site-underlays/${PLAN}/${'a'.repeat(64)}.png`;
const FAILED = 'ההעלאה נכשלה. אפשר לנסות שוב.';

function bytes(...parts: Array<number[] | string>): number[] {
  const out: number[] = [];
  for (const part of parts) {
    if (typeof part === 'string') for (let i = 0; i < part.length; i += 1) out.push(part.charCodeAt(i));
    else out.push(...part);
  }
  return out;
}
const be32 = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
function png(width: number, height: number, padTo = 64): Uint8Array {
  const header = bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], be32(13), 'IHDR', be32(width), be32(height), [8, 6, 0, 0, 0]);
  const out = new Uint8Array(Math.max(padTo, header.length));
  out.set(header);
  return out;
}
// A copy over a plain ArrayBuffer: `File` takes no view that could sit on a SharedArrayBuffer (TS 5.9's BlobPart).
const file = (data: Uint8Array, name: string) => new File([new Uint8Array(data)], name);
const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function deps(answer: () => Promise<Response>) {
  const fetch = vi.fn<UploadDeps['fetch']>(answer);
  const decode = vi.fn<UploadDeps['decode']>(async () => {});
  return { fetch, decode };
}

describe('sending a picture from the card', () => {
  it('checks it, proves the browser can show it, sends it to the map’s own address, and answers the stored file', async () => {
    const stored = { storageKey: KEY, contentType: 'image/png', sizeBytes: 64, filename: 'שרטוט.png' };
    const route = deps(async () => json(stored, 201));
    const sketch = file(png(1600, 1200), 'שרטוט.png');
    expect(await uploadUnderlay(sketch, PLAN, route)).toEqual({ ok: true, file: stored });
    expect(route.decode).toHaveBeenCalledWith(sketch);
    const [url, init] = route.fetch.mock.calls[0];
    expect(url).toBe(`/site/underlay/${PLAN}`);
    expect(init.method).toBe('POST');
    expect(((init.body as FormData).get('file') as File).name).toBe('שרטוט.png');
  });

  it('refuses in Hebrew before sending anything: a PDF, an iPhone photo, too many bytes, too few pixels', async () => {
    for (const [data, name, said] of [
      [Uint8Array.from(bytes('%PDF-1.7\n')), 'plan.pdf', 'קובץ PDF אי אפשר להעלות כרקע. צילום מסך של העמוד יעבוד.'],
      [Uint8Array.from(bytes(be32(24), 'ftyp', 'heic', be32(0), 'mif1', 'heic')), 'IMG_0001.HEIC',
        'הדפדפן לא מציג תמונות HEIC (ברירת המחדל של מצלמת האייפון). שמירה כ־JPEG, או צילום מסך, יעבדו.'],
      [png(1600, 1200, 4 * 1024 * 1024 + 1), 'big.png', 'התמונה גדולה מדי — עד 4 מגה־בייט.'],
      [png(80, 1200), 'thin.png', 'התמונה קטנה מדי — לפחות 100 פיקסלים בכל צד.'],
    ] as const) {
      const route = deps(async () => json({}, 201));
      expect(await uploadUnderlay(file(data, name), PLAN, route)).toEqual({ ok: false, error: said });
      expect(route.fetch).not.toHaveBeenCalled();
      expect(route.decode).not.toHaveBeenCalled();
    }
  });

  it('says the upload failed when the browser cannot show the picture, and sends nothing', async () => {
    const route = deps(async () => json({}, 201));
    route.decode.mockRejectedValueOnce(new Error('The source image could not be decoded.'));
    expect(await uploadUnderlay(file(png(1600, 1200), 'a.png'), PLAN, route)).toEqual({ ok: false, error: FAILED });
    expect(route.fetch).not.toHaveBeenCalled();
  });

  it('says a 413 is the size, in Hebrew, whoever answered it — the route, or the platform before it (review U1)', async () => {
    const size = 'התמונה גדולה מדי — עד 4 מגה־בייט.';
    const fromRoute = deps(async () => json({ error: 'file too large' }, 413));
    expect(await uploadUnderlay(file(png(1600, 1200), 'a.png'), PLAN, fromRoute)).toEqual({ ok: false, error: size });
    const fromPlatform = deps(async () => new Response('Request Entity Too Large', { status: 413, headers: { 'Content-Type': 'text/plain' } }));
    expect(await uploadUnderlay(file(png(1600, 1200), 'a.png'), PLAN, fromPlatform)).toEqual({ ok: false, error: size });
  });

  it('turns every refusal the route answers into its Hebrew, and an unknown one into the fallback', async () => {
    for (const [code, status, said] of [
      ['unauthorized', 401, 'אין הרשאה להעלות קבצים.'],
      ['unknown plan', 404, 'לא מצאנו את המפה הזו — אולי נמחקה בינתיים'],
      ['storage unavailable', 503, 'לא הצלחנו לשמור את התמונה. אפשר לנסות שוב.'],
      ['import failed', 422, FAILED],
    ] as const) {
      const outcome = await uploadUnderlay(file(png(1600, 1200), 'a.png'), PLAN, deps(async () => json({ error: code }, status)));
      expect(outcome).toEqual({ ok: false, error: said });
    }
  });

  it('treats a sign-in page as a failure, never as a stored picture (Review Focus #3)', async () => {
    // An expired session: the proxy redirects the POST to /signin, which answers 200 with a page.
    const signIn = deps(async () => new Response('<!doctype html><html lang="he"><body>כניסה</body></html>', {
      status: 200, headers: { 'Content-Type': 'text/html' },
    }));
    expect(await uploadUnderlay(file(png(1600, 1200), 'a.png'), PLAN, signIn)).toEqual({ ok: false, error: FAILED });
  });

  it('refuses an answer that names another map’s file, a type its name does not carry, or no file', async () => {
    for (const body of [
      { storageKey: `site-underlays/${OTHER}/${'a'.repeat(64)}.png`, contentType: 'image/png', sizeBytes: 64, filename: 'a.png' },
      { storageKey: KEY, contentType: 'image/jpeg', sizeBytes: 64, filename: 'a.png' },
      { storageKey: KEY, contentType: 'image/png', sizeBytes: 0, filename: 'a.png' },
      { storageKey: KEY, contentType: 'image/png', sizeBytes: 64, filename: '' },
      {},
    ]) {
      expect(await uploadUnderlay(file(png(1600, 1200), 'a.png'), PLAN, deps(async () => json(body, 201))))
        .toEqual({ ok: false, error: FAILED });
    }
  });

  it('says the upload failed when no answer came at all', async () => {
    const offline = deps(async () => { throw new TypeError('Failed to fetch'); });
    expect(await uploadUnderlay(file(png(1600, 1200), 'a.png'), PLAN, offline)).toEqual({ ok: false, error: FAILED });
  });
});

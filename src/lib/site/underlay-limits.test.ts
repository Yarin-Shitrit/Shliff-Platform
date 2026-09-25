import { describe, it, expect } from 'vitest';
import {
  MAX_UNDERLAY_BYTES, MAX_UNDERLAY_MB, MAX_UNDERLAY_PX, MAX_UNDERLAY_TEXTURE_PX, MIN_UNDERLAY_PX,
  UNDERLAY_FILE, UNDERLAY_RULES_HE, UPLOAD_FAILED_HE,
  contentTypeOf, isPlanId, underlayKey, underlayKeyPlan, underlayUrl, uploadRefusalHe, uploadUrl,
} from './underlay-limits';

const PLAN = '0b7c6a52-8f7e-4c1e-9a55-3d2f1e0c9b8a';
const OTHER = '5e1d2c3b-4a59-4876-9e0f-a1b2c3d4e5f6';
const SHA = 'a'.repeat(64);

describe('the image limits', () => {
  it('stays inside the 4.5 MB Vercel lets a function receive and send', () => {
    // Above it the platform answers in English before the route runs.
    expect(MAX_UNDERLAY_BYTES).toBe(4 * 1024 * 1024);
    expect(MAX_UNDERLAY_BYTES).toBeLessThan(4.5 * 1024 * 1024);
    expect(MAX_UNDERLAY_MB).toBe(4);
    expect(Number.isInteger(MAX_UNDERLAY_MB)).toBe(true);
  });

  it('takes 100 to 8192 pixels a side, and keeps at most 4096 once decoded', () => {
    expect([MIN_UNDERLAY_PX, MAX_UNDERLAY_PX, MAX_UNDERLAY_TEXTURE_PX]).toEqual([100, 8192, 4096]);
  });
});

describe('where a picture is kept', () => {
  it('keys a file by its plan and its own hash', () => {
    expect(underlayKey(PLAN, SHA, 'png')).toBe(`site-underlays/${PLAN}/${SHA}.png`);
    expect(underlayKeyPlan(underlayKey(PLAN, SHA, 'jpg'))).toBe(PLAN);
    expect(underlayKeyPlan(underlayKey(OTHER, SHA, 'webp'))).toBe(OTHER);
  });

  it('knows no key outside its own folder, and no plan that is not a lower-case uuid', () => {
    for (const key of [
      `uploads/${SHA}.xlsx`,
      `site-underlays/${PLAN}/../${SHA}.png`,
      `site-underlays/../uploads/${SHA}.png`,
      `site-underlays/${PLAN}/${SHA}.gif`,
      `site-underlays/${PLAN.toUpperCase()}/${SHA}.png`,
      `site-underlays/not-a-plan/${SHA}.png`,
      `site-underlays/${PLAN}/${SHA}.png/more`,
      '',
    ]) {
      expect(underlayKeyPlan(key)).toBeNull();
    }
    expect(isPlanId(PLAN)).toBe(true);
    expect(isPlanId(PLAN.toUpperCase())).toBe(false);
    expect(isPlanId('..')).toBe(false);
  });

  it('is fetched from the admin route by its file name, and sent to the plan’s own address', () => {
    expect(underlayUrl(PLAN, underlayKey(PLAN, SHA, 'png'))).toBe(`/site/underlay/${PLAN}/${SHA}.png`);
    expect(uploadUrl(PLAN)).toBe(`/site/underlay/${PLAN}`);
  });

  it('serves only a hash with one of three extensions', () => {
    expect(UNDERLAY_FILE.test(`${SHA}.png`)).toBe(true);
    expect(UNDERLAY_FILE.test(`${SHA}.jpg`)).toBe(true);
    expect(UNDERLAY_FILE.test(`${SHA}.webp`)).toBe(true);
    for (const name of [`${SHA}.PNG`, `${SHA}.jpeg`, `${'g'.repeat(64)}.png`, `${SHA}.png.json`, 'x.png', `a${SHA}.png`]) {
      expect(UNDERLAY_FILE.test(name)).toBe(false);
    }
  });

  it('reads a content type from the stored extension', () => {
    expect(contentTypeOf(`${SHA}.png`)).toBe('image/png');
    expect(contentTypeOf(underlayKey(PLAN, SHA, 'jpg'))).toBe('image/jpeg');
    expect(contentTypeOf(`${SHA}.webp`)).toBe('image/webp');
    expect(contentTypeOf(`${SHA}.gif`)).toBeNull();
  });
});

describe('what an upload says, in Hebrew', () => {
  it('names every refusal the route can answer, in the spec’s words', () => {
    expect(uploadRefusalHe('unauthorized')).toBe('אין הרשאה להעלות קבצים.');
    expect(uploadRefusalHe('unknown plan')).toBe('לא מצאנו את המפה הזו — אולי נמחקה בינתיים');
    expect(uploadRefusalHe('missing file')).toBe('לא נבחר קובץ.');
    expect(uploadRefusalHe('file too large')).toBe('התמונה גדולה מדי — עד 4 מגה־בייט.');
    expect(uploadRefusalHe('pdf')).toBe('קובץ PDF אי אפשר להעלות כרקע. צילום מסך של העמוד יעבוד.');
    expect(uploadRefusalHe('heic')).toBe('הדפדפן לא מציג תמונות HEIC (ברירת המחדל של מצלמת האייפון). שמירה כ־JPEG, או צילום מסך, יעבדו.');
    expect(uploadRefusalHe('unsupported file type')).toBe('אפשר להעלות רק תמונה: PNG,‏ JPEG או WebP.');
    expect(uploadRefusalHe('image too large')).toBe('התמונה גדולה מדי — עד 8192 פיקסלים בכל צד.');
    expect(uploadRefusalHe('image too small')).toBe('התמונה קטנה מדי — לפחות 100 פיקסלים בכל צד.');
    expect(uploadRefusalHe('storage unavailable')).toBe('לא הצלחנו לשמור את התמונה. אפשר לנסות שוב.');
  });

  it('falls back to Hebrew for a code it does not know, or no code at all', () => {
    for (const code of ['import failed', 'constructor', '__proto__', '', undefined, null, 413, {}]) {
      expect(uploadRefusalHe(code)).toBe('ההעלאה נכשלה. אפשר לנסות שוב.');
    }
    expect(UPLOAD_FAILED_HE).toBe('ההעלאה נכשלה. אפשר לנסות שוב.');
  });

  it('states the limits it enforces', () => {
    expect(UNDERLAY_RULES_HE).toBe('PNG,‏ JPEG או WebP, עד 4 מגה־בייט');
    expect(uploadRefusalHe('file too large')).toContain(String(MAX_UNDERLAY_MB));
    expect(uploadRefusalHe('image too large')).toContain(String(MAX_UNDERLAY_PX));
    expect(uploadRefusalHe('image too small')).toContain(String(MIN_UNDERLAY_PX));
  });

  it('carries no Latin word but the formats it names', () => {
    const codes = ['unauthorized', 'unknown plan', 'missing file', 'file too large', 'pdf', 'heic',
      'unsupported file type', 'image too large', 'image too small', 'storage unavailable', 'unknown'];
    for (const sentence of [...codes.map(uploadRefusalHe), UNDERLAY_RULES_HE]) {
      expect(sentence).toMatch(/[֐-׿]/);
      const latin = sentence.match(/[A-Za-z]+/g) ?? [];
      expect(latin.filter((word) => !['PNG', 'JPEG', 'WebP', 'PDF', 'HEIC'].includes(word))).toEqual([]);
    }
  });
});

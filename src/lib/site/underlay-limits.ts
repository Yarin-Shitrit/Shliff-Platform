/**
 * What an image under the camp map may be, where its file is kept, and the
 * Hebrew that says so (spec §16, §20): one module for the numbers and the
 * sentences that quote them, as `src/lib/import/upload-limits.ts` is for
 * workbooks. A rules line that says 4 MB while the route refuses at 3 is
 * worse than no rules line.
 *
 * No imports. The upload route, the image route, `ops.ts`, the scene and the
 * card all read this, so it stays free of `@/db`, of `three`, of React and of
 * anything that touches a filesystem.
 *
 * The 4 MB ceiling is Vercel's, not a preference: a function receives at most
 * a 4.5 MB request body and sends at most a 4.5 MB response, and above that
 * the platform answers in English before the route runs. The image route
 * serves only what the upload route let in, so it never sends more either.
 */

export const MAX_UNDERLAY_BYTES = 4 * 1024 * 1024;
/** Whole megabytes, because the Hebrew below quotes it. */
export const MAX_UNDERLAY_MB = MAX_UNDERLAY_BYTES / (1024 * 1024);

/** Each side of the picture, in pixels, as its header states it. */
export const MIN_UNDERLAY_PX = 100;
export const MAX_UNDERLAY_PX = 8192;

/** The most a decoded picture keeps on its long side; the GPU's own limit may be lower (spec §19). */
export const MAX_UNDERLAY_TEXTURE_PX = 4096;

/** The map length of the picture's width: an item side's bounds, 10 cm to 500 m (`ops.ts`). */
export const MIN_UNDERLAY_WIDTH_CM = 10;
export const MAX_UNDERLAY_WIDTH_CM = 50_000;
/** How far the picture's middle may sit from the plot's corner, either way: `POSITION_RANGE`. */
export const MAX_UNDERLAY_OFFSET_CM = 50_000;
/** A typed calibration distance: `SIDE_RANGE`, 10 cm to 500 m (spec §18.3). */
export const MIN_CALIBRATION_CM = 10;
export const MAX_CALIBRATION_CM = 50_000;

export const UNDERLAY_TYPES = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' } as const;
export type UnderlayExtension = keyof typeof UNDERLAY_TYPES;
export type UnderlayContentType = (typeof UNDERLAY_TYPES)[UnderlayExtension];

/**
 * Where every picture is kept: `site-underlays/<planId>/<sha256>.<ext>`. The
 * name is the file's own hash, so the same bytes land on the same key: a
 * second upload writes nothing new, and a replaced picture keeps its key for
 * an undo to bring back (spec §16). A plan id is lower case, as Postgres
 * writes a uuid, so one plan has one folder.
 */
export const UNDERLAY_PREFIX = 'site-underlays';
/** The one shape of file name the image route serves (spec §16). */
export const UNDERLAY_FILE = /^[0-9a-f]{64}\.(png|jpg|webp)$/;
const PLAN_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** A plan id as a key and a URL carry it: a lower-case uuid, and nothing a path could climb out with. */
export function isPlanId(value: string): boolean {
  return PLAN_ID.test(value);
}

export function underlayKey(planId: string, sha256: string, ext: UnderlayExtension): string {
  return `${UNDERLAY_PREFIX}/${planId}/${sha256}.${ext}`;
}

/** The plan a key was uploaded to, or null when the text is not a picture's key at all. */
export function underlayKeyPlan(key: string): string | null {
  const parts = key.split('/');
  if (parts.length !== 3 || parts[0] !== UNDERLAY_PREFIX) return null;
  return isPlanId(parts[1]) && UNDERLAY_FILE.test(parts[2]) ? parts[1] : null;
}

/** Where a browser asks for the picture: the admin-only route, never storage itself. */
export function underlayUrl(planId: string, key: string): string {
  return `/site/underlay/${planId}/${key.slice(key.lastIndexOf('/') + 1)}`;
}

/** Where a picture is sent. */
export function uploadUrl(planId: string): string {
  return `/site/underlay/${planId}`;
}

/** The content type a stored name's extension stands for, or null. */
export function contentTypeOf(name: string): UnderlayContentType | null {
  const match = /\.(png|jpg|webp)$/.exec(name);
  return match === null ? null : UNDERLAY_TYPES[match[1] as UnderlayExtension];
}

/** The machine codes `POST /site/underlay/<planId>` answers (spec §16). */
export type UnderlayUploadCode =
  | 'unauthorized' | 'unknown plan' | 'missing file' | 'file too large'
  | 'pdf' | 'heic' | 'unsupported file type' | 'image too small' | 'image too large'
  | 'storage unavailable';

/** The rules line under the upload button (spec §20). The mark after "PNG," keeps the comma with its word. */
export const UNDERLAY_RULES_HE = `PNG,‏ JPEG או WebP, עד ${MAX_UNDERLAY_MB} מגה־בייט`;

/** Any other answer: a code this list does not know, an HTML page, no answer at all. */
export const UPLOAD_FAILED_HE = 'ההעלאה נכשלה. אפשר לנסות שוב.';

/** A record, so `tsc` refuses a code without its sentence. */
const UPLOAD_HE: Readonly<Record<UnderlayUploadCode, string>> = {
  unauthorized: 'אין הרשאה להעלות קבצים.',
  'unknown plan': 'לא מצאנו את המפה הזו — אולי נמחקה בינתיים',
  'missing file': 'לא נבחר קובץ.',
  'file too large': `התמונה גדולה מדי — עד ${MAX_UNDERLAY_MB} מגה־בייט.`,
  pdf: 'קובץ PDF אי אפשר להעלות כרקע. צילום מסך של העמוד יעבוד.',
  heic: 'הדפדפן לא מציג תמונות HEIC (ברירת המחדל של מצלמת האייפון). שמירה כ־JPEG, או צילום מסך, יעבדו.',
  'unsupported file type': 'אפשר להעלות רק תמונה: PNG,‏ JPEG או WebP.',
  'image too large': `התמונה גדולה מדי — עד ${MAX_UNDERLAY_PX} פיקסלים בכל צד.`,
  'image too small': `התמונה קטנה מדי — לפחות ${MIN_UNDERLAY_PX} פיקסלים בכל צד.`,
  'storage unavailable': 'לא הצלחנו לשמור את התמונה. אפשר לנסות שוב.',
};
/** A Map, so a code such as `constructor` finds nothing. */
const BY_CODE = new Map<string, string>(Object.entries(UPLOAD_HE));

/** Whatever the route answered, as a Hebrew sentence, never the code itself (spec §21). */
export function uploadRefusalHe(code: unknown): string {
  return (typeof code === 'string' ? BY_CODE.get(code) : undefined) ?? UPLOAD_FAILED_HE;
}

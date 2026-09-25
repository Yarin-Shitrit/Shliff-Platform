import { imageFacts } from './image-facts';
import {
  MAX_UNDERLAY_BYTES, MAX_UNDERLAY_FILENAME, MAX_UNDERLAY_PX, MIN_UNDERLAY_PX, UNDERLAY_TYPES,
  type UnderlayContentType, type UnderlayExtension, type UnderlayUploadCode,
} from './underlay-limits';

/**
 * Whether a file may lie under the map (spec §16, steps 4–6), in the order
 * the route checks: its size, then its type from both its bytes and its
 * name, then its size in pixels. The route runs this on what it received; the
 * card runs it before sending anything (spec §18.1: "by the same rules as the
 * server"), so a refusal a lead sees in the browser is the one the server
 * would have given.
 *
 * Both the bytes and the name must say PNG, JPEG or WebP, and the same one,
 * as `/api/uploads` asks of a workbook. A PDF or an iPhone photo is named for
 * what it is, by either, so its refusal can say what to do instead.
 */

type RefusalCode = Extract<UnderlayUploadCode,
  'file too large' | 'file name too long' | 'pdf' | 'heic' | 'unsupported file type' | 'image too small' | 'image too large'>;

export type UnderlayFileCheck =
  | { ok: true; ext: UnderlayExtension; contentType: UnderlayContentType; width: number; height: number }
  | { ok: false; code: RefusalCode; status: 413 | 415 | 422 };

/** A Map, so a name ending ".constructor" finds nothing. */
const BY_NAME = new Map<string, UnderlayExtension | 'pdf' | 'heic'>([
  ['png', 'png'], ['jpg', 'jpg'], ['jpeg', 'jpg'], ['webp', 'webp'],
  ['pdf', 'pdf'], ['heic', 'heic'], ['heif', 'heic'],
]);

function named(filename: string): UnderlayExtension | 'pdf' | 'heic' | null {
  const match = /\.([a-z0-9]+)$/i.exec(filename.trim());
  return match === null ? null : BY_NAME.get(match[1].toLowerCase()) ?? null;
}

export function checkUnderlayFile(filename: string, bytes: Uint8Array): UnderlayFileCheck {
  if (bytes.byteLength > MAX_UNDERLAY_BYTES) return { ok: false, code: 'file too large', status: 413 };
  // The name is kept with the picture (`ops.ts` refuses a longer one): refused here, before anything is stored (review U1).
  if (filename.trim().length > MAX_UNDERLAY_FILENAME) return { ok: false, code: 'file name too long', status: 422 };

  const facts = imageFacts(bytes);
  const byName = named(filename);
  if (facts.kind === 'pdf' || byName === 'pdf') return { ok: false, code: 'pdf', status: 415 };
  if (facts.kind === 'heic' || byName === 'heic') return { ok: false, code: 'heic', status: 415 };

  const byBytes: UnderlayExtension | null = facts.kind === 'png' ? 'png'
    : facts.kind === 'jpeg' ? 'jpg'
      : facts.kind === 'webp' ? 'webp' : null;
  if (byBytes === null || byName !== byBytes || facts.width === null || facts.height === null) {
    return { ok: false, code: 'unsupported file type', status: 415 };
  }

  if (facts.width < MIN_UNDERLAY_PX || facts.height < MIN_UNDERLAY_PX) {
    return { ok: false, code: 'image too small', status: 422 };
  }
  if (facts.width > MAX_UNDERLAY_PX || facts.height > MAX_UNDERLAY_PX) {
    return { ok: false, code: 'image too large', status: 422 };
  }
  return { ok: true, ext: byBytes, contentType: UNDERLAY_TYPES[byBytes], width: facts.width, height: facts.height };
}

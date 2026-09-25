import type { UploadedUnderlay } from '@/lib/site/editor/underlay-commands';
import { checkUnderlayFile } from '@/lib/site/underlay-file';
import {
  MAX_UNDERLAY_BYTES, UPLOAD_FAILED_HE, contentTypeOf, underlayKeyPlan, uploadRefusalHe, uploadUrl,
} from '@/lib/site/underlay-limits';

/**
 * Sending a picture from the card (spec §18.1). First the checks the route
 * will make — type, size, pixels — so a refusal needs no round trip. Then one
 * small decode, to be sure this browser can show the picture at all. Then
 * the POST. Nothing here throws, and every failure is a Hebrew sentence, so
 * the card never shows English and never hangs on "מעלה…".
 *
 * Only a 201 carrying a well-formed answer is a stored picture. An expired
 * session is redirected by the proxy to the sign-in page, which answers 200
 * with HTML (Review Focus #3). Taking "ok" for success would put a picture
 * with no file on the map.
 */

export type UploadOutcome = { ok: true; file: UploadedUnderlay } | { ok: false; error: string };

export interface UploadDeps {
  fetch: (input: string, init: RequestInit) => Promise<Response>;
  /** Proves the browser can show the picture. Decoded small: the check needs no pixels kept. */
  decode: (file: Blob) => Promise<void>;
}

async function decodeOnce(file: Blob): Promise<void> {
  const bitmap = await createImageBitmap(file, { resizeWidth: 64, resizeQuality: 'low' });
  bitmap.close();
}

const BROWSER: UploadDeps = { fetch: (input, init) => fetch(input, init), decode: decodeOnce };

/** A JSON body, without assuming there is one: an HTML page, or nothing, reads as `{}`. */
async function readJson(response: Response): Promise<Record<string, unknown>> {
  try {
    const body: unknown = await response.json();
    return body !== null && typeof body === 'object' ? body as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

/** The route's answer as a stored file of this map, or null when it is not one. */
function storedFile(body: Record<string, unknown>, planId: string): UploadedUnderlay | null {
  const { storageKey, contentType, sizeBytes, filename } = body;
  if (typeof storageKey !== 'string' || underlayKeyPlan(storageKey) !== planId) return null;
  const type = contentTypeOf(storageKey);
  if (type === null || contentType !== type) return null;
  if (typeof sizeBytes !== 'number' || !Number.isInteger(sizeBytes) || sizeBytes < 1 || sizeBytes > MAX_UNDERLAY_BYTES) return null;
  if (typeof filename !== 'string' || filename.trim() === '') return null;
  return { storageKey, contentType: type, sizeBytes, filename };
}

export async function uploadUnderlay(file: File, planId: string, deps: UploadDeps = BROWSER): Promise<UploadOutcome> {
  const failed: UploadOutcome = { ok: false, error: UPLOAD_FAILED_HE };

  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
  } catch {
    return failed;
  }
  const check = checkUnderlayFile(file.name, bytes);
  if (!check.ok) return { ok: false, error: uploadRefusalHe(check.code) };

  try {
    await deps.decode(file);
  } catch {
    return failed;
  }

  const form = new FormData();
  form.set('file', file);
  let response: Response;
  try {
    response = await deps.fetch(uploadUrl(planId), { method: 'POST', body: form });
  } catch {
    return failed; // offline, aborted, DNS
  }
  // A 413 is the size whoever said it: the route, or the platform before it, in English (review U1).
  if (response.status === 413) return { ok: false, error: uploadRefusalHe('file too large') };
  const body = await readJson(response);
  if (response.status !== 201) return { ok: false, error: uploadRefusalHe(body.error) };
  const stored = storedFile(body, planId);
  return stored === null ? failed : { ok: true, file: stored };
}

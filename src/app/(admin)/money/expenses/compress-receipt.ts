/**
 * Shrinks a receipt's photo in the browser before it is sent.
 *
 * A phone camera hands over 4–12 MB. A receipt needs to be legible, not
 * printable: 1600 px on the long side at JPEG quality 0.7 keeps small print
 * readable and lands at a few hundred KB — which is what makes the upload
 * work on the playa's signal, and keeps every request far under the 4 MB cap
 * the server enforces.
 *
 * Shrinking is a courtesy and never a gate. If the browser cannot decode the
 * picture or draw it, the original goes up unchanged and the server decides
 * (`/money/expenses/record` checks the type and the size itself).
 */
export const RECEIPT_MAX_EDGE = 1600;
export const RECEIPT_JPEG_QUALITY = 0.7;

const KEPT_AS_IS: ReadonlySet<string> = new Set(['image/jpeg', 'image/png', 'image/webp']);

/** The largest size with the same shape whose long side fits `maxEdge`.
 *  A picture already inside it is left at its own size, never enlarged. */
export function fitWithin(
  width: number, height: number, maxEdge: number = RECEIPT_MAX_EDGE,
): { width: number; height: number } {
  const long = Math.max(width, height);
  if (long <= maxEdge) return { width, height };
  const scale = maxEdge / long;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export async function compressReceipt(file: File): Promise<Blob> {
  try {
    // `from-image` applies the camera's rotation, so a portrait receipt does
    // not arrive lying on its side once the EXIF is gone.
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    try {
      const size = fitWithin(bitmap.width, bitmap.height);
      const canvas = document.createElement('canvas');
      canvas.width = size.width;
      canvas.height = size.height;
      const context = canvas.getContext('2d');
      if (context === null) return file;
      // JPEG has no transparency; without this a transparent PNG turns black.
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, size.width, size.height);
      context.drawImage(bitmap, 0, 0, size.width, size.height);
      const blob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob(resolve, 'image/jpeg', RECEIPT_JPEG_QUALITY);
      });
      if (blob === null) return file;
      // A small picture can come out bigger re-encoded; keep the original
      // then — but only one the server takes. A HEIC stays converted.
      if (blob.size >= file.size && KEPT_AS_IS.has(file.type)) return file;
      return blob;
    } finally {
      bitmap.close();
    }
  } catch {
    return file;
  }
}

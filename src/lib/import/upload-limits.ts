/**
 * What the upload route enforces, and the Hebrew that states it on screen.
 *
 * One home for both, because a rules line that says 25 MB while the route
 * rejects at 20 is worse than no rules line at all. The two Hebrew refusals
 * below are lifted unchanged (E5) from the error map of the since-deleted
 * `upload-form.tsx`, now `upload-drop.tsx`; the wording is not being
 * redesigned, only relocated to where the number it quotes is enforced.
 *
 * No import here: this module is pulled into a route handler, a client
 * component and a test, so it must stay free of `@/db` and of anything that
 * reads the filesystem.
 */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
export const MAX_UPLOAD_MB = MAX_UPLOAD_BYTES / (1024 * 1024);
export const UPLOAD_EXTENSION = '.xlsx' as const;

export const UPLOAD_RULES_HE = `קובץ אקסל (xlsx) בלבד, עד ${MAX_UPLOAD_MB} מגה־בייט`;
export const TOO_LARGE_HE = `הקובץ גדול מדי — עד ${MAX_UPLOAD_MB} מגה־בייט.`;
export const WRONG_TYPE_HE = 'אפשר להעלות רק קובץ אקסל בפורמט xlsx.';

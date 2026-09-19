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
 *
 * The 4 MB ceiling is Vercel's, not a preference. A serverless function
 * receives at most a 4.5 MB request body, and above that the platform refuses
 * the request before this route runs — returning its own English error page to
 * a Hebrew screen, which is a product-rule violation rather than a rough edge.
 * Staying below it keeps the refusal here, in Hebrew, in TOO_LARGE_HE.
 *
 * The headroom is real: the largest workbook in docs/reference-data/ measures
 * 0.07 MB, so this is roughly 57x the observed need. That measurement is also
 * why the upload route still imports inline rather than handing off to a
 * background job — at this file size it finishes well inside the function
 * timeout.
 *
 * Must stay a whole number: MAX_UPLOAD_MB is interpolated into the two Hebrew
 * strings below, and "4.5 מגה־בייט" would read as sloppily as it sounds.
 */
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
export const MAX_UPLOAD_MB = MAX_UPLOAD_BYTES / (1024 * 1024);
export const UPLOAD_EXTENSION = '.xlsx' as const;

export const UPLOAD_RULES_HE = `קובץ אקסל (xlsx) בלבד, עד ${MAX_UPLOAD_MB} מגה־בייט`;
export const TOO_LARGE_HE = `הקובץ גדול מדי — עד ${MAX_UPLOAD_MB} מגה־בייט.`;
export const WRONG_TYPE_HE = 'אפשר להעלות רק קובץ אקסל בפורמט xlsx.';

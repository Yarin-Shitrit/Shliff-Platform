/**
 * Incremented whenever parsing, detection, or classification logic changes in a
 * way that could reinterpret previously committed data. Stored on every block so
 * a re-parse is an explicit, reviewable action rather than a silent rewrite.
 */
export const PIPELINE_VERSION = 1;

/**
 * The camp map's Hebrew notices that more than one surface raises — the
 * scene on a drag, the keyboard on a nudge, the inspector on a typed size.
 * Plain strings, and the one helper that places a name inside them: a panel
 * — and `failure-messages.ts`, on the server — may import this file, but never
 * `scene/engine.ts`, which would put `three` in the page's first bundle
 * (plan 04, ruling P14).
 */

/**
 * A locked item was dragged, nudged, resized or refused by the server — the
 * one sentence for it everywhere (ruling P14): the scene, the keys, the
 * inspector and `failure-messages.ts` all say this.
 */
export const LOCKED_NOTICE = 'הפריט נעול. אפשר לשחרר אותו בכפתור הנעילה.';

/** The same, when several items are selected and every one of them is locked. */
export const LOCKED_ALL_NOTICE = 'הפריטים הנבחרים נעולים. אפשר לשחרר אותם בכפתור הנעילה.';

/**
 * A map with nothing on it — the side panel, the list and the plot inspector
 * say the same invitation. How a tile is placed is the library's own hint.
 */
export const EMPTY_MAP = 'המפה ריקה. אפשר להתחיל מכל פריט בלשונית ״הוספה למפה״.';

/** The same invitation on the library tab itself, which is where the items are (#25 fix round, Minor 13). */
export const EMPTY_MAP_HERE = 'המפה ריקה. אפשר להתחיל מכל פריט שכאן.';

/**
 * A name dropped into a Hebrew sentence, between bidi isolates: an item's
 * label may be Latin, a number or mixed, and must not drag the rest of the
 * sentence out of order (the A17 convention). First-strong (FSI…PDI), as
 * `<bdi>` is: the name takes its direction from its own first letter, so
 * "אוהל VIP" stays right to left. LRI forced every name left to right and
 * read it "VIP אוהל" (#25 fix round, Important 4).
 */
export function isolate(name: string): string {
  return `⁨${name}⁩`;
}

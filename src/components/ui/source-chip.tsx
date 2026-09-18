import type { ReactElement } from 'react';
import Link from 'next/link';
import { cx } from './cx';
import styles from './source-chip.module.css';

/**
 * R11: every number keeps its provenance. This is a *display* of a resolved
 * reference — turning `source_block_id`/`source_row` into a sheet name and an
 * A1 address is a query that belongs to the screen plan that needs it. The
 * kit renders what it is handed and nothing more.
 */
export type SourceRef =
  | { kind: 'workbook'; sheet: string; cell: string; blockHref?: string }
  | { kind: 'manual' };

export type SourceChipProps = { source: SourceRef };

/** `תנועות קופה!A14` or `נרשם ידנית` — one string, so a table and a drawer agree. */
export function formatSourceRef(source: SourceRef): string {
  return source.kind === 'manual' ? 'נרשם ידנית' : `${source.sheet}!${source.cell}`;
}

/**
 * A chip for a block that has since been deleted still renders its text: the
 * figure is still explained by a cell that once existed, so a stale
 * `blockHref` degrades to a plain (non-link) chip rather than the whole
 * component refusing to render — see `SourceChipProps`, which never requires
 * `blockHref` to resolve.
 *
 * `נרשם ידנית` is not a failure state — a hand-entered figure is a complete
 * answer to "where did this come from" — so it takes the same chip styling
 * as a workbook reference, never a muted or warning treatment.
 */
export function SourceChip({ source }: SourceChipProps): ReactElement {
  const text = formatSourceRef(source);
  const label = `מקור: ${text}`;
  const className = cx(styles.chip, source.kind === 'manual' && styles.manual);
  // The cell reference is a Latin run inside an RTL page, isolated with
  // `<bdi>` so `תנועות קופה!A14` cannot be reordered by its surroundings.
  const body = source.kind === 'manual' ? text : <bdi>{text}</bdi>;

  if (source.kind === 'workbook' && source.blockHref !== undefined) {
    return (
      <Link className={cx(className, styles.linked)} href={source.blockHref} aria-label={label}>
        {body}
      </Link>
    );
  }

  // `role="img"`, not a bare `<span>`: a `<span>` with no role is
  // `role="generic"`, and ARIA prohibits naming a generic element — browsers
  // simply drop `aria-label` there, so this chip's accessible name was never
  // announced. `role="img"` is the ARIA pattern for exactly this shape (an
  // element whose accessible name is meant to differ from, or add to, its
  // visible text, the way `<span role="img" aria-label="4 out of 5 stars">`
  // does for a row of glyphs): it is the right fit here specifically because
  // `label` is *not* the same string as the rendered text — the chip never
  // renders the `מקור:` (source) word itself, only the sheet!cell/`נרשם ידנית`
  // that follows it; that word only reaches a sighted reader through the
  // chip's own visual/positional context. Dropping `aria-label` and letting
  // the visible text stand alone — the usual fix for this shape — would lose
  // that word for a screen-reader user, which is the one thing R11 asks this
  // component to keep saying.
  return <span className={className} role="img" aria-label={label}>{body}</span>;
}

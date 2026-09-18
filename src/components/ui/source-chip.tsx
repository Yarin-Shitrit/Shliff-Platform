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

  return <span className={className} aria-label={label}>{body}</span>;
}

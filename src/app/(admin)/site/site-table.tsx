import type { ReactElement, ReactNode } from 'react';
import Link from 'next/link';
import { Table, type TableColumn } from '@/components/ui/table';
import { Pill } from '@/components/ui/pill';
import { SourceChip } from '@/components/ui/source-chip';
import type { SiteLineView } from '@/lib/site/plan';
import { formatMetres, formatSize, metres, shadedRect } from '@/lib/site/geometry';
import { toPlaced, type ItemFlags, type ItemShape } from '@/lib/site/derive';
import { SITE_KINDS } from '@/lib/site/kinds';
import { LINE_KINDS } from '@/lib/site/lines';
import {
  SHADE_STATE_LABELS, SHADE_STATE_TONES, SITE_STATE_LABELS, SITE_STATE_TONES,
} from '@/lib/site/labels';
import { BUILD_PATH } from '@/lib/logistics/build-views';
import styles from './site.module.css';

/**
 * No `'use client'`, and nothing in it that needs one side or the other: the
 * item table, the reading of the map that needs no pointer — a phone in a
 * dust storm, a screen reader, a printout. The editor draws it from the map
 * being edited, as the view on a screen under 900 px and under the scene's
 * notice in a browser without WebGL (spec §7); the page draws it from its own
 * read when the map could not be opened for editing.
 *
 * It is shown only where the map is not, so a name is a name: a link that
 * selected the item on a map nobody can see would do nothing. No row actions
 * either — every edit, removal included, is made and undone in the editor.
 */

/** What a row needs: where the item is, what it is called, its flags, and the build task it is tied to. */
export type SiteTableRow = ItemShape & ItemFlags & {
  label: string;
  taskId: string | null;
  taskTitle: string | null;
};

export type SiteTableProps = {
  items: readonly SiteTableRow[];
  /** The season a build task's link goes to. */
  season: string;
  empty: ReactNode;
};

const DASH = '—';

export function SiteTable({ items, season, empty }: SiteTableProps): ReactElement {
  const columns: ReadonlyArray<TableColumn<SiteTableRow>> = [
    {
      key: 'label',
      header: 'פריט',
      card: 'title',
      cell: (row) => (
        <span className={styles.title}>
          <span className="nm">{row.label}</span>
          <span className="muted">{SITE_KINDS[row.kind].label}</span>
        </span>
      ),
    },
    {
      key: 'size',
      header: 'מידות',
      card: 'figure',
      cell: (row) => {
        const shade = row.kind === 'shade' ? shadedRect(toPlaced(row)) : null;
        return (
          <span className={styles.title}>
            <bdi>{formatSize(row.widthCm, row.depthCm)}</bdi>
            {shade === null ? null : (
              <span className="muted"><bdi>{`בצל ${metres(shade.width)} × ${metres(shade.depth)} מ׳`}</bdi></span>
            )}
          </span>
        );
      },
    },
    {
      key: 'position',
      header: 'מיקום',
      card: 'meta',
      cell: (row) => <bdi>{`${metres(row.xCm)} על ${metres(row.yCm)} מ׳`}</bdi>,
    },
    {
      key: 'state',
      header: 'מצב',
      card: 'meta',
      // R3: the word carries the meaning; the tone only decorates it.
      cell: (row) => (
        <span className={styles.pills}>
          {row.outside ? (
            <Pill tone={SITE_STATE_TONES.outside} dot>{SITE_STATE_LABELS.outside}</Pill>
          ) : null}
          {row.overlapping ? (
            <Pill tone={SITE_STATE_TONES.overlapping} dot>{SITE_STATE_LABELS.overlapping}</Pill>
          ) : null}
          {!row.outside && !row.overlapping ? (
            <Pill tone={SITE_STATE_TONES.inside}>{SITE_STATE_LABELS.inside}</Pill>
          ) : null}
        </span>
      ),
    },
    {
      key: 'shade',
      header: 'צל',
      card: 'meta',
      cell: (row) => (row.shade === null ? DASH : (
        <Pill tone={SHADE_STATE_TONES[row.shade]} dot>{SHADE_STATE_LABELS[row.shade]}</Pill>
      )),
    },
    {
      key: 'task',
      header: 'משימת הקמה',
      card: 'meta',
      cell: (row) => (row.taskId === null ? DASH : (
        <Link href={`${BUILD_PATH}?season=${season}`} className="nm">{row.taskTitle ?? DASH}</Link>
      )),
    },
    {
      key: 'source',
      header: 'מקור הנתון',
      card: 'meta',
      // R11: no workbook holds a map, so every size and position says so.
      cell: () => <SourceChip source={{ kind: 'manual' }} />,
    },
  ];

  return (
    <Table
      caption="הפריטים במפה"
      columns={columns}
      rows={items.map((row) => ({
        id: row.id,
        data: row,
        tone: row.outside ? 'bad' : row.overlapping ? 'warn' : undefined,
      }))}
      empty={empty}
    />
  );
}

/** What a line's row needs: what it is, the names of its ends, its bends, and its length on this map. */
export type SiteLinesTableRow = Pick<SiteLineView, 'id' | 'kind' | 'label' | 'fromLabel' | 'toLabel' | 'lengthCm' | 'pointsCm'>;

/**
 * The pipes and cables, read the same way (`site_lines`): what runs from
 * where to where and how long it is on the map, wall to wall through its
 * bends, with no reserve — the metres the camp buys by. Shown, like the items,
 * only where the map is not, so a name is a name. Nothing when the map has
 * none: the editor is where the first one is drawn.
 */
export function SiteLinesTable({ lines }: { lines: readonly SiteLinesTableRow[] }): ReactElement | null {
  if (lines.length === 0) return null;
  const columns: ReadonlyArray<TableColumn<SiteLinesTableRow>> = [
    {
      key: 'label',
      header: 'קו',
      card: 'title',
      cell: (row) => (
        <span className={styles.title}>
          <span className="nm">{row.label}</span>
          <span className="muted">{LINE_KINDS[row.kind].label}</span>
        </span>
      ),
    },
    { key: 'from', header: 'מ', card: 'meta', cell: (row) => row.fromLabel || DASH },
    { key: 'to', header: 'אל', card: 'meta', cell: (row) => row.toLabel || DASH },
    {
      key: 'length',
      header: 'אורך על המפה',
      card: 'figure',
      cell: (row) => (row.lengthCm === null ? 'קצה חסר' : <bdi>{formatMetres(row.lengthCm)}</bdi>),
    },
    {
      key: 'bends',
      header: 'נקודות פנייה',
      card: 'meta',
      cell: (row) => <bdi>{String(row.pointsCm.length)}</bdi>,
    },
    // R11: no workbook holds a map, so every metre here was drawn by a lead.
    { key: 'source', header: 'מקור הנתון', card: 'meta', cell: () => <SourceChip source={{ kind: 'manual' }} /> },
  ];
  const total = lines.reduce((sum, row) => sum + (row.lengthCm ?? 0), 0);
  return (
    <Table
      caption={`צינורות וכבלים · ${formatMetres(total)} על המפה`}
      columns={columns}
      rows={lines.map((row) => ({ id: row.id, data: row }))}
    />
  );
}

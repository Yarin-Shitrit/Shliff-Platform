import type { ReactElement, ReactNode } from 'react';
import Link from 'next/link';
import { Table, type TableColumn } from '@/components/ui/table';
import { Pill } from '@/components/ui/pill';
import { SourceChip } from '@/components/ui/source-chip';
import { formatSize, metres, shadedRect } from '@/lib/site/geometry';
import { toPlaced, type ItemFlags, type ItemShape } from '@/lib/site/derive';
import { SITE_KINDS } from '@/lib/site/kinds';
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

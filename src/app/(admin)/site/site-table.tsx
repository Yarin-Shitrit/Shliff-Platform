import type { ReactElement, ReactNode } from 'react';
import Link from 'next/link';
import { Table, type TableColumn } from '@/components/ui/table';
import { Pill } from '@/components/ui/pill';
import { SourceChip } from '@/components/ui/source-chip';
import type { SiteItemView } from '@/lib/site/plan';
import { formatSize, metres, shadedRect } from '@/lib/site/geometry';
import { toPlaced } from '@/lib/site/derive';
import { SITE_KINDS } from '@/lib/site/kinds';
import {
  SHADE_STATE_LABELS, SHADE_STATE_TONES, SITE_STATE_LABELS, SITE_STATE_TONES,
} from '@/lib/site/labels';
import { itemHref, type RawParams } from '@/lib/site/views';
import { BUILD_PATH } from '@/lib/logistics/build-views';
import styles from './site.module.css';

/**
 * No `'use client'`: the item table, rendered on the server and handed to the
 * editor, which shows it as the view on a screen under 900 px and under the
 * scene's notice in a browser without WebGL (spec §7). It is the reading of
 * the map that needs no pointer — a phone in a dust storm, a screen reader,
 * a printout. A row's name links to the map with that item selected
 * (`?peek=`); there are no row actions, since every edit, removal included,
 * is made and undone in the editor.
 */

export type SiteTableProps = {
  items: readonly SiteItemView[];
  params: RawParams;
  season: string;
  empty: ReactNode;
};

const DASH = '—';

export function SiteTable({ items, params, season, empty }: SiteTableProps): ReactElement {
  const columns: ReadonlyArray<TableColumn<SiteItemView>> = [
    {
      key: 'label',
      header: 'פריט',
      card: 'title',
      cell: (row) => (
        <span className={styles.title}>
          <Link href={itemHref(params, row.id)} className="nm">{row.label}</Link>
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

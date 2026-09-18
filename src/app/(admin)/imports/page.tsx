import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db } from '@/db';
import { requireAdmin } from '@/lib/auth/guard';
import { listUploads, uploadStatusLabel, type UploadRow } from '@/lib/import/uploads';
import { formatDateShort } from '@/lib/dates';
import { Table, type TableColumn } from '@/components/ui/table';
import { Pill } from '@/components/ui/pill';
import { EmptyState } from '@/components/ui/empty-state';
import { Icon } from '@/components/ui/icon';
import { FileRowMenu } from './file-row-menu';
import styles from './imports.module.css';

/** The layout's title template appends `· קופת שליף`, so this is the bare name. */
export const metadata: Metadata = { title: 'קבצים וייבוא' };

/** The parser's own message stays in the database (R9). */
const IMPORT_FAILED = 'לא הצלחנו לקרוא את הקובץ. ודאו שזה קובץ אקסל תקין ונסו שוב.';

/**
 * Dates are formatted here, on the server, and only the string reaches the
 * tree. `block-card.tsx`'s `formatConfirmedAt` exists because a
 * locale-sensitive formatter rendered one way on the server and another in the
 * browser that hydrated it; the fix is to keep `Date` out of the components,
 * not to hand-roll a second UTC formatter. `formatDateShort` is plan 01's —
 * there is no `@/lib/format/date` and there will not be (A2).
 */
const COLUMNS: ReadonlyArray<TableColumn<UploadRow>> = [
  {
    key: 'file',
    card: 'title',
    header: 'קובץ',
    cell: (row) => (
      <>
        <Link className={styles.fileLink} href={`/imports/${row.id}`}>
          {/* A16: the set is frozen at 65 and has no `file`; `sheet` is the
              document glyph in it. */}
          <Icon name="sheet" size={15} />
          <bdi>{row.filename}</bdi>
        </Link>
        <span className={styles.sub}>
          {row.status === 'failed' ? IMPORT_FAILED : (
            <>
              {/* Two independent counts, so one isolate each (A17). */}
              <bdi>{row.sheetCount} גיליונות</bdi>
              {' · '}
              <bdi>{row.blockCount} טבלאות</bdi>
            </>
          )}
        </span>
      </>
    ),
  },
  { key: 'by', card: 'meta', header: 'הועלה ע״י', cell: (row) => row.uploadedBy },
  {
    key: 'when',
    card: 'meta',
    header: 'מתי',
    cell: (row) => <bdi>{formatDateShort(row.createdAt)}</bdi>,
  },
  {
    key: 'status',
    card: 'meta',
    header: 'מצב',
    cell: (row) => {
      const status = uploadStatusLabel(row);
      return <Pill tone={status.tone}>{status.text}</Pill>;
    },
  },
  {
    key: 'confirmed',
    card: 'meta',
    header: 'טבלאות שאושרו',
    /* One isolate for the whole phrase, not one per number (A17). */
    cell: (row) => <bdi>{row.confirmedCount} מתוך {row.blockCount}</bdi>,
  },
  {
    key: 'written',
    card: 'figure',
    header: 'מה נכתב',
    cell: (row) => (row.promotedRows > 0
      ? <bdi>{row.promotedRows} שורות</bdi>
      : <span className={styles.muted}>טרם קודם</span>),
  },
];

export default async function ImportsPage() {
  const admin = await requireAdmin();
  if (!admin.ok) notFound();

  const rows = await listUploads(db);

  return (
    <main className={styles.page}>
      <div className={styles.head}>
        <div>
          <h1 className={styles.title}>קבצים וייבוא</h1>
          <p className={styles.lead}>
            כל קובץ שהועלה, מה זוהה בו, ומה כבר נכתב לנתוני הקאמפ.
          </p>
        </div>
        <Link className={styles.primary} href="/upload">
          <Icon name="upload" size={14} /> העלאת קובץ
        </Link>
      </div>

      {/*
        * The empty state replaces the table rather than filling its body.
        * `Table`'s own `empty` slot keeps the header row, which is right when a
        * filter empties a populated table and wrong here: six column headings
        * above "nothing yet" is a report about a table that does not exist,
        * where an invitation belongs (C10, and the rule that an empty state is
        * an invitation rather than an apology).
        */}
      {rows.length === 0 ? (
        <EmptyState
          kind="nothing-yet"
          noun="קבצים שהעליתם"
          action={{ label: 'העלאת קובץ', href: '/upload' }}
        />
      ) : (
        <Table<UploadRow>
          caption="קבצים שהועלו"
          columns={COLUMNS}
          rows={rows.map((row) => ({ id: row.id, data: row }))}
          rowActions={(row) => (
            <FileRowMenu
              uploadId={row.id}
              firstOpenBlockId={row.firstOpenBlockId}
              openDecisions={row.openDecisions}
            />
          )}
        />
      )}
    </main>
  );
}

import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { db } from '@/db';
import { requireAdmin } from '@/lib/auth/guard';
import { listUsers, type UserRow } from '@/lib/auth/users';
import { DateText } from '@/components/format';
import { Table } from '@/components/ui/table';
import type { TableColumn, TableRowModel } from '@/components/ui/table';
import { Pill } from '@/components/ui/pill';
import { EmptyState } from '@/components/ui/empty-state';
import { Drawer } from '@/components/ui/drawer';
import { openActHref, openPeekHref, closePeekHref } from '@/components/ui/drawer-url';
import { UserForm } from './user-form';
import { accessSummary } from './summary';
import styles from './users.module.css';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'משתמשים והרשאות' };

type UsersSearchParams = { act?: string; peek?: string };

const PATH = '/users';

function asParams(current: UsersSearchParams): URLSearchParams {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(current)) {
    if (value !== undefined && value !== '') search.set(key, value);
  }
  return search;
}

/**
 * משתמשים והרשאות — who can sign in, and which pages each account sees or
 * changes. The admin role alone opens this page, and it is the one page no
 * grant can name: it is where the grants are made.
 */
export default async function UsersPage(
  { searchParams }: { searchParams: Promise<UsersSearchParams> },
) {
  const admin = await requireAdmin();
  if (!admin.ok) notFound();

  const params = await searchParams;
  const users = await listUsers(db);

  const creating = params.act === 'user';
  const peeked = params.peek === undefined ? undefined : users.find((user) => user.id === params.peek);
  const newHref = openActHref(PATH, asParams(params), 'user');
  const closeHref = closePeekHref(PATH, asParams(params));

  const columns: Array<TableColumn<UserRow>> = [
    {
      key: 'email',
      card: 'title',
      header: 'חשבון',
      cell: (user) => (
        <span className={styles.email}>
          <Link href={openPeekHref(PATH, asParams(params), user.id)}>
            <bdi dir="ltr">{user.email}</bdi>
          </Link>
          {user.email === admin.email ? <Pill tone="outline">החשבון המחובר</Pill> : null}
        </span>
      ),
    },
    {
      key: 'role',
      card: 'meta',
      header: 'תפקיד',
      cell: (user) => (user.admin
        ? <Pill tone="brand" dot>ניהול מלא</Pill>
        : <Pill tone="neutral">לפי הרשאות</Pill>),
    },
    {
      key: 'pages',
      card: 'figure',
      header: 'עמודים',
      cell: (user) => {
        const summary = accessSummary(user);
        const none = !user.admin && Object.keys(user.pages).length === 0;
        return <span className={none ? styles.summaryNone : styles.summary}>{summary}</span>;
      },
    },
    {
      key: 'created',
      card: 'meta',
      header: 'נוצר',
      cell: (user) => <DateText at={user.createdAt} />,
    },
  ];

  const rows: Array<TableRowModel<UserRow>> = users.map((user) => ({ id: user.id, data: user }));

  return (
    <main className={styles.page}>
      <div className={styles.head}>
        <div className={styles.titleRow}>
          <h1 className={styles.title}>משתמשים והרשאות</h1>
          <Link className={styles.newLink} href={newHref}>חשבון חדש</Link>
        </div>
        <p className={styles.lead}>
          מי יכול להיכנס למערכת, ואילו עמודים כל חשבון רואה או משנה. חשבון עם
          ניהול מלא רואה ועורך הכול; לכל חשבון אחר בוחרים עמוד־עמוד — בלי
          גישה, צפייה בלבד, או צפייה ועריכה. ההרשאות נאכפות בשרת: עמוד שסומן
          לצפייה בלבד מציג את הכפתורים שלו, אבל כל שינוי ממנו נדחה.
        </p>
      </div>

      {!creating ? null : (
        <Drawer
          title="חשבון חדש"
          subtitle="כתובת, סיסמה ראשונית, ומה החשבון רואה"
          closeHref={closeHref}
          width={500}
        >
          <UserForm mode="create" closeHref={closeHref} />
        </Drawer>
      )}

      {peeked === undefined ? null : (
        <Drawer
          title={peeked.email}
          subtitle={peeked.admin ? 'ניהול מלא' : accessSummary(peeked)}
          closeHref={closeHref}
          width={500}
        >
          <UserForm
            mode="edit"
            userId={peeked.id}
            email={peeked.email}
            admin={peeked.admin}
            pages={peeked.pages}
            isSelf={peeked.email === admin.email}
            closeHref={closeHref}
          />
        </Drawer>
      )}

      <Table
        caption="משתמשים"
        columns={columns}
        rows={rows}
        empty={(
          <EmptyState
            kind="nothing-yet"
            noun="חשבונות"
            action={{ href: newHref, label: 'חשבון חדש' }}
          />
        )}
      />
    </main>
  );
}

import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { db } from '@/db';
import { requireAdmin } from '@/lib/auth/guard';
import { listSeasons } from '@/lib/members/roster';
import { listAccounts } from '@/lib/money/accounts';
import { listOwnExpenses } from '@/lib/money/expenses';
import type { ExpenseRow } from '@/lib/money/expenses';
import { EXPENSE_CATEGORY_LABELS } from '@/lib/money/expense-categories';
import { fundLabel } from '@/lib/money/labels';
import { campDayKey } from '@/lib/money/counted';
import { Money, DateText } from '@/components/format';
import { Table } from '@/components/ui/table';
import type { TableColumn, TableTotalsCell } from '@/components/ui/table';
import { EmptyState } from '@/components/ui/empty-state';
import { ExpenseForm } from './expense-form';
import { ExpenseTools } from './expense-tools';
import styles from './expenses.module.css';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'הוצאות' };

export type ExpensesSearchParams = { season?: string };

function Nothing(): ReactNode {
  return <span className={styles.none} aria-hidden="true">—</span>;
}

/**
 * הוצאות: one expense, typed on a phone, with its receipt.
 *
 * Not in the twelve plans — it came after them, like the camp map. It writes
 * to the ledger and reads back only what the signed-in account typed, so the
 * grant for this page shows nobody the camp's balances: an account's name is
 * here (the form has to ask which one paid) and its money is not.
 */
export default async function ExpensesPage(
  { searchParams }: { searchParams: Promise<ExpensesSearchParams> },
) {
  const admin = await requireAdmin('expenses');
  if (!admin.ok) notFound();

  const seasons = await listSeasons(db);
  const params = await searchParams;

  if (seasons.length === 0) {
    return (
      <main className={styles.page}>
        <h1 className={styles.title}>הוצאות</h1>
        <p className="muted">עדיין אין שנים. הריצו את הזריעה מדף הייבוא.</p>
      </main>
    );
  }

  const season = seasons.find((one) => one.id === params.season) ?? seasons[0];
  const canRecord = admin.level === 'edit';
  // Asked, not assumed: the correction link is offered only to an account
  // that can follow it.
  const ledger = await requireAdmin('ledger', 'edit');

  const [accounts, rows] = await Promise.all([
    listAccounts(db),
    listOwnExpenses(db, { recordedBy: admin.email, seasonId: season.id }),
  ]);
  const totalAgorot = rows.reduce((sum, row) => sum + row.amountAgorot, 0);

  const columns: Array<TableColumn<ExpenseRow>> = [
    {
      key: 'date', card: 'meta', header: 'תאריך',
      cell: (row) => <DateText at={row.occurredOn} />,
    },
    { key: 'description', card: 'title', header: 'על מה', cell: (row) => row.description },
    {
      key: 'category', card: 'meta', header: 'קטגוריה',
      cell: (row) => (row.category === null ? <Nothing /> : EXPENSE_CATEGORY_LABELS[row.category]),
    },
    {
      key: 'account', card: 'meta', header: 'חשבון',
      cell: (row) => (row.accountName === null ? <Nothing /> : (
        <>
          {row.accountName}{' '}
          <span className={styles.fundTag}>{fundLabel(row.accountFund)}</span>
        </>
      )),
    },
    {
      key: 'receipt', card: 'meta', header: 'קבלה',
      cell: (row) => (row.hasReceipt ? (
        /* A plain anchor, not `Link`: the target is a picture, and the router
           would try to fetch it as a page. */
        <a
          className="link" href={`/money/expenses/receipt/${row.id}`}
          target="_blank" rel="noreferrer"
          aria-label={`הקבלה של ${row.description}`}
        >
          לצפייה
        </a>
      ) : <Nothing />),
    },
    {
      key: 'amount', card: 'figure', header: 'סכום', numeric: true,
      cell: (row) => <Money agorot={row.amountAgorot} />,
    },
  ];

  const totals: TableTotalsCell[] = [
    { key: 'count', content: <bdi>{rows.length} הוצאות</bdi>, colSpan: 5 },
    { key: 'sum', content: <Money agorot={totalAgorot} />, numeric: true },
  ];

  return (
    <main className={styles.page}>
      <div className={styles.head}>
        <h1 className={styles.title}>הוצאות</h1>
        <p className={styles.lead}>
          רושמים כאן הוצאה ששולמה מכספי הקאמפ: כמה, על מה, מאיזה חשבון, וצילום של הקבלה.
          ההוצאה נכנסת מיד לתנועות.
        </p>
      </div>

      {canRecord ? (
        <section className={styles.card} aria-label="הוצאה חדשה">
          <ExpenseForm
            seasonId={season.id}
            seasons={seasons.map((one) => ({ id: one.id, name: one.name }))}
            accounts={accounts.map((one) => ({ id: one.id, name: one.name, fund: one.fund }))}
            today={campDayKey(new Date())}
          />
        </section>
      ) : (
        <p className={styles.readOnly}>יש לך כאן צפייה בלבד, ולכן אין טופס לרישום הוצאה.</p>
      )}

      <section className={styles.page} aria-label="ההוצאות שרשמת">
        <div className={styles.listHead}>
          <h2 className={styles.listTitle}>ההוצאות שרשמת ב<bdi>{season.name}</bdi></h2>
          {ledger.ok ? (
            <Link className="link" href={`/money/ledger?season=${season.id}&view=out`}>
              לכל ההוצאות בתנועות
            </Link>
          ) : null}
        </div>
        <Table
          caption={`ההוצאות שרשמת ב${season.name}`}
          columns={columns}
          rows={rows.map((row) => ({ id: row.id, data: row }))}
          totals={rows.length === 0 ? undefined : totals}
          rowActionsVisible
          rowActionsHeader="פעולות"
          rowActions={canRecord ? (row) => (
            <ExpenseTools
              expenseId={row.id}
              description={row.description}
              amountAgorot={row.amountAgorot}
              accountName={row.accountName}
              editHref={ledger.ok
                ? `/money/ledger?season=${season.id}&peek=${row.id}&act=edit`
                : null}
            />
          ) : undefined}
          empty={(
            <EmptyState kind="nothing-this-season" noun="הוצאות שרשמת" seasonName={season.name} />
          )}
        />
      </section>
    </main>
  );
}

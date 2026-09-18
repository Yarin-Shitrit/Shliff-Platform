import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { db } from '@/db';
import { requireAdmin } from '@/lib/auth/guard';
import { listSeasons } from '@/lib/members/roster';
import { listSeasonFees } from '@/lib/fees/season-fees';
import { seasonFeeSummary } from '@/lib/fees/summary';
import { listOpenAccounts } from '@/lib/money/accounts';
import {
  parseFeeView, rowsForView, viewCounts, nextPayable, payablePosition,
} from '@/lib/fees/views';
import { formatShekels } from '@/lib/money';
import { Banner } from '@/components/ui/banner';
import { EmptyState } from '@/components/ui/empty-state';
import { FeeRollup, feeLeadSentence, missingDuesSentence } from './fee-rollup';
import { FeeViews } from './fee-views';
import { FeeTable } from './fee-table';
import { IssueMissingDuesButton } from './issue-due-button';
import { PaymentDrawer } from './payment-drawer';
import { ExceptionDrawer } from './exception-drawer';
import styles from './fees.module.css';

export const dynamic = 'force-dynamic';
/** B8: every page names itself. Every page used to be "פלטפורמת שליף". */
export const metadata: Metadata = { title: 'דמי קאמפ' };

/**
 * דמי קאמפ.
 *
 * A Server Component that reads the season from `?season=` (R5 — the per-page
 * season nav is gone; the shell owns the switcher), calls `seasonFeeSummary`
 * once and `listSeasonFees` once, and composes four server-rendered pieces
 * plus at most one URL-driven drawer.
 *
 * Every filter, count and "who is next" decision comes from
 * `@/lib/fees/views`, over the rows fetched here — so a tile, a tab and the
 * table can never disagree about what טרם שילמו means.
 */
export default async function FeesPage(
  { searchParams }: {
    searchParams: Promise<{
      season?: string; view?: string; peek?: string; act?: string;
    }>;
  },
) {
  const admin = await requireAdmin();
  if (!admin.ok) notFound();

  const seasons = await listSeasons(db);
  if (seasons.length === 0) {
    return (
      <main className={styles.page}>
        <h1>דמי קאמפ</h1>
        <EmptyState
          kind="nothing-yet"
          noun="שנים"
          action={{ label: 'מעבר לייבוא', href: '/imports' }}
        />
      </main>
    );
  }

  const params = await searchParams;
  // R5: the season is one global control, carried in the URL by the shell.
  const season = seasons.find((option) => option.id === params.season) ?? seasons[0];
  const view = parseFeeView(params.view);

  const summary = await seasonFeeSummary(db, season.id);
  const rows = await listSeasonFees(db, season.id);
  const accounts = await listOpenAccounts(db);

  const counts = viewCounts(rows);
  const visible = rowsForView(rows, view);

  /**
   * A3: the drawer is `?peek=<personId>&act=pay|exception`, read through the
   * same two params every other screen's drawer uses. Two drawers never open
   * at once — `act` decides which, and `pay` is the default because it is the
   * verb a lead reaches for far more often.
   */
  const peeked = params.peek ? rows.find((row) => row.personId === params.peek) : undefined;
  const payRow = peeked && params.act !== 'exception' ? peeked : undefined;
  const exceptionRow = peeked && params.act === 'exception' ? peeked : undefined;

  const allClear = rows.length > 0 && visible.length === 0 && view === 'unpaid';

  return (
    <main className={styles.page}>
      <header className={styles.pagehead}>
        <h1>דמי קאמפ</h1>
        {/* A17: one isolate around the whole phrase, not one per figure. */}
        <p className={styles.sub}>
          <bdi>{feeLeadSentence(summary, counts.paid)}</bdi>
        </p>
      </header>

      <FeeRollup summary={summary} counts={counts} seasonId={season.id} view={view} />

      {summary.missingDues.length > 0 && (
        <div className={styles.notice}>
          <Banner
            tone="neutral"
            headline={missingDuesSentence(summary.missingDues.length, season.name)}
          />
          {/* C9 caps a Banner at one action and that action is an href, so the
              button that writes sits beside the banner rather than inside it. */}
          <IssueMissingDuesButton
            seasonId={season.id}
            missingCount={summary.missingDues.length}
            flatRateAgorot={summary.flatRateAgorot}
          />
        </div>
      )}

      {summary.unattributedAgorot > 0 && (
        <Banner
          tone="warn"
          headline={`${formatShekels(summary.unattributedAgorot)} מדמי הקאמפ נרשמו בלי קופה.`}
          detail="הם נספרים בגבייה אבל לא ביתרה של אף חשבון."
          action={{ label: 'מעבר לקופות', href: '/money' }}
        />
      )}

      <FeeViews counts={counts} seasonId={season.id} view={view} />

      {allClear ? (
        <EmptyState kind="all-clear" />
      ) : (
        <FeeTable
          rows={visible}
          seasonId={season.id}
          seasonName={season.name}
          view={view}
          flatRateAgorot={summary.flatRateAgorot}
          totals={{
            expectedAgorot: summary.expectedAgorot,
            collectedAgorot: summary.collectedAgorot,
            outstandingAgorot: summary.outstandingAgorot,
            memberCount: summary.memberCount,
            exceptionCount: summary.exceptionCount,
            noDueCount: summary.missingDues.length,
          }}
        />
      )}

      {payRow && (
        <PaymentDrawer
          row={payRow}
          seasonId={season.id}
          view={view}
          accounts={accounts.map((account) => ({
            id: account.id, name: account.name, kind: account.kind,
          }))}
          recordedBy={admin.email}
          /* R6 + ruling N: the run is computed on the server, from the same
             ordered list the table just rendered. */
          nextPersonId={nextPayable(rows, view, payRow.personId)}
          prevPersonId={null}
          position={payablePosition(rows, view, payRow.personId)}
        />
      )}

      {exceptionRow && (
        <ExceptionDrawer
          row={exceptionRow}
          seasonId={season.id}
          seasonName={season.name}
          view={view}
          flatRateAgorot={summary.flatRateAgorot}
          decidedBy={admin.email}
        />
      )}
    </main>
  );
}

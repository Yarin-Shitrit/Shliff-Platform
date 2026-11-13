import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { db } from '@/db';
import { requireAdmin } from '@/lib/auth/guard';
import { listSeasons } from '@/lib/members/roster';
import { listSeasonFees } from '@/lib/fees/season-fees';
import { issuedFlatDues } from '@/lib/fees/dues';
import { seasonClosePreview } from '@/lib/fees/close-season';
import { seasonFeeSummary } from '@/lib/fees/summary';
import { listOpenAccounts } from '@/lib/money/accounts';
import {
  parseFeeView, rowsForView, viewCounts, nextPayable, payablePosition,
} from '@/lib/fees/views';
import { formatShekels } from '@/lib/money';
import { Banner } from '@/components/ui/banner';
import { ButtonLink } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { EmptyState } from '@/components/ui/empty-state';
import { FeeRollup, feeLeadSentence, missingDuesSentence, staleRateSentence } from './fee-rollup';
import { FeeViews } from './fee-views';
import { FeeTable } from './fee-table';
import { IssueMissingDuesButton } from './issue-due-button';
import { PaymentDrawer } from './payment-drawer';
import { ExceptionDrawer } from './exception-drawer';
import { RateDrawer } from './rate-drawer';
import { CloseSeasonDrawer } from './close-season-drawer';
import { feesHref } from './href';
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

  /*
   * The season's own drawer: `?act=rate` with no `peek`, the shape a create
   * drawer takes (`openActHref`). What it reads — the flat dues already out,
   * and how many carry money — is fetched only when it is open, since that
   * is the one moment the counts decide anything.
   */
  const settingRate = params.act === 'rate' && !params.peek;
  const issued = settingRate ? await issuedFlatDues(db, season.id) : null;

  /*
   * The season's closing drawer: `?act=close`, the same shape. Its preview
   * is fetched only when it is open, for the same reason as the rate's —
   * the counts decide something only at that moment.
   */
  const closing = params.act === 'close' && !params.peek;
  const closePreview = closing ? await seasonClosePreview(db, season.id) : null;

  const allClear = rows.length > 0 && visible.length === 0 && view === 'unpaid';

  /* Counted on the whole roster, not the view: a stale due hides in any tab. */
  const staleFlatDues = rows.filter((row) => (
    row.kind === 'flat' && row.amountAgorot !== null && row.amountAgorot !== summary.flatRateAgorot
  )).length;

  return (
    <main className={styles.page}>
      <header className={styles.pagehead}>
        <div className={styles.headRow}>
          <h1>דמי קאמפ</h1>
          {/*
            The rate is the first figure in the sentence below, and this is
            the link that can change it (D1). A link, because the drawer it
            opens is a URL like every other drawer here.
          */}
          <span className={styles.headLinks}>
            <ButtonLink tone="ghost" size="sm" href={feesHref({ season: season.id, view, rate: true })}>
              <Icon name="pencil" size={14} /> {`שינוי התעריף של ${season.name}`}
            </ButtonLink>
            {/*
              The starting point after a year the book was not kept: every
              open balance of the season goes to zero by a write-off that
              says so (`closeSeasonBalances`). A link, because the drawer it
              opens is a URL like every other drawer here.
            */}
            <ButtonLink tone="ghost" size="sm" href={feesHref({ season: season.id, view, close: true })}>
              <Icon name="check" size={14} /> {`סגירת היתרות של ${season.name}`}
            </ButtonLink>
          </span>
        </div>
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

      {/*
        Flat dues issued before the rate changed and left where they were.
        The rate drawer offers to rewrite them and "no" is a legitimate
        answer, but the gap must stay visible until it is closed one way or
        the other: a roster whose balances disagree with the rate for a
        reason only the database knows is the silent default this system
        refuses. The banner counts them and leads to the drawer.
      */}
      {staleFlatDues > 0 && (
        <Banner
          tone="warn"
          headline={staleRateSentence(staleFlatDues, summary.flatRateAgorot)}
          detail="היתרות של החיובים האלה מחושבות מהסכום שהונפק, לא מהתעריף. בחלון התעריף אפשר לעדכן אותם."
          action={{ label: 'שינוי התעריף', href: feesHref({ season: season.id, view, rate: true }) }}
        />
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

      {issued !== null && (
        <RateDrawer
          seasonId={season.id}
          seasonName={season.name}
          view={view}
          flatRateAgorot={summary.flatRateAgorot}
          issued={issued}
        />
      )}

      {closePreview !== null && (
        <CloseSeasonDrawer
          preview={closePreview}
          view={view}
          latest={season.id === seasons[0].id}
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

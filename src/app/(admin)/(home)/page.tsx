import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { db } from '@/db';
import { requireAdmin } from '@/lib/auth/guard';
import { resolveSeason } from '@/lib/seasons/current';
import { seasonOverview } from '@/lib/overview/summary';
import type { DecisionKind } from '@/lib/overview/summary';
import { Money } from '@/components/format';
import { Icon } from '@/components/ui/icon';
import type { IconName } from '@/components/ui/icon';
import { ButtonLink } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Figures } from './figures';
import { InboxPreview } from './inbox-preview';
import { Understaffed } from './understaffed';
import { UnpaidList } from './unpaid-list';
import type { PreviewItem } from './inbox-preview';
import styles from './home.module.css';

export const dynamic = 'force-dynamic';

/**
 * A glyph per kind of decision, and the one mapping this screen makes from
 * the register's vocabulary onto its own.
 *
 * It lives here because it is presentation, and it is exhaustive because it
 * is a `Record`: a new kind of decision in the register stops this file
 * compiling rather than rendering a row with no icon.
 */
const ICON_FOR: Record<DecisionKind, IconName> = {
  'unlinked-name': 'link',
  'sheet-season': 'calendar',
  'sheet-collision': 'copy',
  'block-undecided': 'layers',
  'unnamed-debt': 'scale',
  // Neither of these is a decision, so neither reaches the preview — the map
  // is total because the type is, not because the panel draws them.
  'refused-row': 'alert',
  'arithmetic-flag': 'calc',
};

/** B8: every page sets its own title; the suffix comes from the root
 *  layout's own template. */
export const metadata: Metadata = { title: 'בית' };

/**
 * The first screen, and the only one that answers "where does the camp stand"
 * without being asked a season first.
 *
 * Three rules from the page this replaces survive intact, and each has a test:
 *
 *  1. Every figure links to the page that can change it. A number a lead
 *     cannot act on belongs in a report, not on a landing page.
 *  2. A card that would always read zero is not drawn. A dashboard that always
 *     shows "0 outstanding items" trains its reader to stop looking at that
 *     row. The rule lives in `SeasonOverview`'s nullable figures; this file
 *     only renders what is there.
 *  3. An empty state names the season and offers a next step.
 *
 * What changed: the season now comes from the shared control (R5) rather than
 * from the newest row, and the whole screen is one `seasonOverview` call
 * rather than a query per section.
 */
export default async function HomePage(
  { searchParams }: { searchParams: Promise<{ season?: string }> },
) {
  const admin = await requireAdmin();
  if (!admin.ok) notFound();

  const { season: requested } = await searchParams;
  const { current: season } = await resolveSeason(db, requested);

  if (!season) {
    return (
      <main className={styles.page}>
        <h1>בית</h1>
        <EmptyState
          kind="nothing-yet"
          noun="שנים"
          action={{ label: 'מעבר לייבוא', href: '/upload' }}
        />
      </main>
    );
  }

  const overview = await seasonOverview(db, season.id);
  const nothingYet = !overview.dues && !overview.cash
    && !overview.debts && !overview.coverage;

  /*
   * The register's own rows, turned into the panel's shape here and nowhere
   * else. The verb on a row is the register's, and so is where it goes: this
   * screen names a decision and hands it on. Nothing here writes, and A23
   * forbids a control that would — the register renders what promotion would
   * do, and even it does not offer to run it.
   *
   * A17: one isolate per readable phrase. A title like "4 טבלאות ממתינות"
   * is one sentence with a number in it, not a number beside a sentence.
   */
  const previewItems: PreviewItem[] = overview.decisions.items.map((item) => ({
    id: item.id,
    icon: ICON_FOR[item.kind],
    title: <bdi>{item.title}</bdi>,
    detail: <bdi>{item.detail}</bdi>,
    pill: item.blocksImport ? { text: 'חוסם ייבוא', tone: 'warn' } : undefined,
    source: item.source ?? undefined,
    action: { label: item.actionLabel, href: item.href },
  }));
  // Read off the register's own total rather than counted here: the panel
  // never learns how many are waiting by counting the rows it drew.
  const hidden = overview.decisions.total - previewItems.length;

  return (
    <main className={styles.page}>
      <div className={styles.head}>
        <div>
          <h1>{season.name}</h1>
          {/* A17: one isolate per readable phrase, not one per number. The
              roster size and the rate are two independent facts, so they are
              two isolates rather than one that spans the separator. */}
          <p className={styles.sub}>
            <bdi>{overview.memberCount} חברים ברשימה</bdi>
            {' · '}
            תעריף <Money agorot={overview.flatRateAgorot} />
          </p>
        </div>
        <div className={styles.headActions}>
          <ButtonLink size="sm" href="/upload">
            <Icon name="upload" size={14} /> העלאת קובץ
          </ButtonLink>
          <ButtonLink size="sm" href={`/fees?season=${season.id}`}>
            <Icon name="receipt" size={14} /> רישום תשלום
          </ButtonLink>
        </div>
      </div>

      <Figures overview={overview} />

      {nothingYet ? (
        <EmptyState
          kind="nothing-this-season"
          noun="נתונים"
          seasonName={season.name}
          action={{ label: 'מעבר לייבוא', href: '/upload' }}
        />
      ) : null}

      <div className={styles.columns}>
        <div className={styles.wide}>
          <InboxPreview
            items={previewItems}
            total={overview.decisions.total}
            remainder={hidden > 0 ? (
              <bdi>
                {hidden === 1
                  ? 'ועוד החלטה אחת ברשימה'
                  : `ועוד ${hidden} החלטות ברשימה`}
              </bdi>
            ) : null}
            seasonName={season.name}
            href={`/inbox?season=${season.id}`}
          />
        </div>
        <div className={styles.narrow}>
          <Understaffed
            tasks={overview.understaffed}
            coverage={overview.coverage}
            seasonId={season.id}
            seasonName={season.name}
          />
          <UnpaidList dues={overview.dues} seasonId={season.id} seasonName={season.name} />
        </div>
      </div>
    </main>
  );
}

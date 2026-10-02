import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { db } from '@/db';
import { requireAdmin } from '@/lib/auth/guard';
import { listUnlinkedNames } from '@/lib/members/identity';
import { listSeasons } from '@/lib/members/roster';
import { listPeopleForSeason } from '@/lib/members/people-list';
import { previewMerge } from '@/lib/members/link';
import {
  PEOPLE_PATH, PEOPLE_SORTS, applyPeopleQuery, closeDrawerHref, mergeHref,
  parsePeopleQuery, viewCounts,
  type PeopleSort, type PeopleView, type RawParams,
} from '@/lib/members/people-views';
import { SavedViews, type SavedView } from '@/components/ui/saved-views';
import { FilterBar, type FilterOption } from '@/components/ui/filter-bar';
import { EmptyState, type EmptyStateProps } from '@/components/ui/empty-state';
import { Banner } from '@/components/ui/banner';
import { AddMember } from './add-member';
import { DUES_STATE_LABELS } from '@/lib/members/labels';
import { PeopleTable } from './people-table';
import { PeekDrawer } from './peek-drawer';
import { MergePanel } from './merge-panel';
import styles from './people.module.css';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'אנשים' };

const SORT_LABELS: Record<PeopleSort, string> = {
  name: 'שם',
  balance: 'יתרה',
  tasks: 'משימות',
  activity: 'פעילות אחרונה',
};

function one(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}

/** Every list link keeps the season (R5) and drops only what it is changing. */
function listHref(params: RawParams, changes: Record<string, string | null>): string {
  const next = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (key === 'peek' || key === 'act' || key === 'with') continue;
    if (value === undefined) continue;
    for (const single of Array.isArray(value) ? value : [value]) next.append(key, single);
  }
  for (const [key, value] of Object.entries(changes)) {
    if (value === null) next.delete(key);
    else next.set(key, value);
  }
  const query = next.toString();
  return query === '' ? PEOPLE_PATH : `${PEOPLE_PATH}?${query}`;
}

export default async function MembersPage(
  { searchParams }: { searchParams: Promise<RawParams> },
) {
  const admin = await requireAdmin();
  if (!admin.ok) notFound();

  const params = await searchParams;
  const seasons = await listSeasons(db);
  const requested = one(params.season);
  const scope = seasons.find((season) => season.id === requested) ?? seasons[0] ?? null;

  const rows = await listPeopleForSeason(db, scope?.id ?? null);
  const query = parsePeopleQuery(params, scope !== null);
  const counts = viewCounts(rows);
  const shown = applyPeopleQuery(rows, query);

  const viewLabels: Record<PeopleView, string> = {
    all: 'כולם',
    // Named after the season itself: "the roster" is not a thing a lead thinks in.
    roster: scope?.name ?? 'רשימת השנה',
    unpaid: 'טרם שילמו',
    new: 'חדשים השנה',
    leads: 'ראשי צוות',
    lapsed: 'לא חזרו השנה',
  };

  const views: SavedView[] = (['all', 'roster', 'unpaid', 'new', 'leads', 'lapsed'] as const)
    .map((view) => ({
      id: view,
      label: viewLabels[view],
      count: counts[view],
      href: listHref(params, { view }),
    }));

  // The count, and only the count. Resolving a candidate per queued name was
  // this page doing the register's work; /inbox now shows each name with its
  // evidence, its candidates and their reasons (W24, D3).
  const unlinked = await listUnlinkedNames(db);

  /*
   * C10/E1's five kinds, chosen from the data rather than from the view alone.
   * "Nothing at all" and "nothing this year" and "nothing matching what you
   * typed" send a lead to three different places, and getting it wrong sends
   * them hunting for a filter they never set. The fifth kind, `not-permitted`,
   * is the shell's (B9) — this page has already called `notFound()`.
   */
  const filtered = query.q !== '' || query.dues !== null;
  let empty: EmptyStateProps;
  if (rows.length === 0) {
    empty = { kind: 'nothing-yet', noun: 'אנשים', action: { label: 'הוספת אדם', href: '#add-person' } };
  } else if (query.view === 'unpaid' && !filtered) {
    empty = { kind: 'all-clear' };
  } else if (query.view === 'roster' && !filtered && scope !== null) {
    empty = {
      kind: 'nothing-this-season',
      noun: 'אנשים',
      seasonName: scope.name,
      action: { label: 'הוספת אדם', href: '#add-person' },
    };
  } else {
    empty = {
      kind: 'no-matches',
      action: { label: 'ניקוי הסינון', href: listHref(params, { q: null, dues: null }) },
    };
  }

  const peeked = query.peek === null
    ? null
    : rows.find((candidate) => candidate.personId === query.peek) ?? null;

  /*
   * The merge panel takes precedence over the peek: both are the same drawer
   * slot, and `?act=merge` says which one the URL means. A merge whose second
   * id no longer resolves falls back to the peek rather than to nothing — A3's
   * "an action drawer degrades to the preview", which is also why the two are
   * resolved in this order rather than as separate slots.
   */
  const merge = query.merge === null
    ? null
    : await previewMerge(db, query.merge[0], query.merge[1]);

  /*
   * Awaited here rather than rendered as `<PeekDrawer />`: it is a Server
   * Component that reads two more tables, and this page has no Suspense
   * boundary to hand a pending element to. Awaiting keeps the whole screen —
   * list and drawer — one server render, which is also what makes the drawer
   * survive a refresh with no client fetch.
   */
  const drawer = merge !== null ? (
    <MergePanel
      preview={merge}
      cancelHref={closeDrawerHref(params)}
      swapHref={mergeHref(params, merge.target.personId, merge.source.personId)}
    />
  ) : peeked === null ? null : await PeekDrawer({
    row: peeked,
    seasonId: scope?.id ?? null,
    seasonName: scope?.name ?? null,
    closeHref: closeDrawerHref(params),
  });

  const duesOptions: FilterOption[] = (Object.keys(DUES_STATE_LABELS) as Array<keyof typeof DUES_STATE_LABELS>)
    .map((state) => ({
      id: state,
      label: DUES_STATE_LABELS[state],
      href: listHref(params, { dues: state }),
      current: query.dues === state,
    }));

  const sortOptions: FilterOption[] = PEOPLE_SORTS.map((sort) => ({
    id: sort,
    label: SORT_LABELS[sort],
    href: listHref(params, { sort }),
    current: query.sort === sort,
  }));

  return (
    <main>
      <div className={styles.head}>
        <div className={styles.headText}>
          <h1>אנשים</h1>
          <p className={styles.subline}>
            <bdi>{`${counts.all} אנשים בקאמפ · ${counts.roster} ב${viewLabels.roster}`}</bdi>
          </p>
        </div>
        {/*
          One plain anchor per season, deliberately: this is a file download
          from a Route Handler, not a page to navigate to client-side — `Link`
          would prefetch the CSV response on hover/viewport for nothing. The
          season used to be implicit (whichever the route defaulted to), so a
          lead exporting for one season silently got a different one's roster
          with nothing saying so — naming every season here and carrying it
          through the query string is the fix.
        */}
        {seasons.length === 0 ? null : (
          <span className={styles.headActions}>
            ייצוא לקובץ CSV:{' '}
            {seasons.map((season, index) => (
              <span key={season.id}>
                {index > 0 && ' · '}
                <a href={`/members/export?season=${season.id}`}>{season.name}</a>
              </span>
            ))}
          </span>
        )}
      </div>

      <SavedViews label="תצוגות שמורות" views={views} currentId={query.view} />

      <div className={styles.toolbar}>
        <FilterBar
          searchValue={query.q}
          searchLabel="חיפוש אנשים"
          searchPlaceholder="שם או כינוי"
          chips={query.dues === null ? [] : [{
            id: 'dues',
            label: 'דמי קאמפ',
            value: DUES_STATE_LABELS[query.dues],
            clearHref: listHref(params, { dues: null }),
            options: duesOptions,
          }]}
          addFilter={query.dues === null ? { options: duesOptions } : undefined}
          sort={{ value: SORT_LABELS[query.sort], options: sortOptions }}
          rowCount={shown.length}
        />
      </div>

      <PeopleTable
        rows={shown}
        seasonYears={seasons.map((season) => season.year).sort((a, b) => a - b)}
        params={params}
        seasonId={scope?.id ?? null}
        seasonName={scope?.name ?? null}
        viewLabel={viewLabels[query.view]}
        empty={<EmptyState {...empty} />}
      />

      {/*
        D3's destination exists now, so the queue itself has moved: /inbox
        shows each unattributed name beside the workbook rows it came from and
        the candidates with their reasons. W24 says this is surfaced by a link
        and not by a second implementation, and the count is what a banner is
        for. Plan 06 kept the queue here with a note saying it would go when
        the register existed; this is that.
      */}
      {unlinked.length === 0 ? null : (
        <Banner
          tone="info"
          label="שמות שלא שויכו"
          headline={<bdi>{unlinked.length} שמות מהקבצים עדיין לא שויכו לאף אחד.</bdi>}
          detail="המערכת לא מנחשת — מיזוג של שני אנשים אינו הפיך, ולכן ההחלטה שלכם."
          action={{ label: 'טיפול בשמות', href: '/inbox?tab=decide&kind=names' }}
        />
      )}

      {/*
        Resolved against the unfiltered roster, never against `shown`. A peek
        link is meant to be pasted, and the person who opens it has whatever
        filter the sender had — or none at all. A peek naming nobody renders
        nothing rather than an error: a truncated URL out of a chat is not a
        404, it is just a list.
      */}
      {drawer}

      <section className={styles.section} id="add-person">
        <h2>הוספת אדם</h2>
        <AddMember seasons={seasons.map((season) => ({ id: season.id, name: season.name }))} />
      </section>
    </main>
  );
}

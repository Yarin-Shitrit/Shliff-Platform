import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { db } from '@/db';
import { requireAdmin } from '@/lib/auth/guard';
import { resolveSeason } from '@/lib/seasons/current';
import { listTasks } from '@/lib/work/tasks';
import { loadDoc, seasonsWithPlans, siteView } from '@/lib/site/plan';
import {
  copyHref, parseSiteQuery, plotHref, seasonDateHref, siteHref, sunDateOf, type RawParams,
} from '@/lib/site/views';
import { TopBar, SeasonChip } from '@/components/shell/top-bar';
import { Banner } from '@/components/ui/banner';
import { EmptyState } from '@/components/ui/empty-state';
import { ButtonLink } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { SiteEditor } from './editor/site-editor';
import { SiteTable } from './site-table';
import { PlotDrawer } from './plot-drawer';
import { CopyDrawer } from './copy-drawer';
import styles from './site.module.css';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'מפת הקאמפ' };

/**
 * מפת הקאמפ — where everything goes this year.
 *
 * One map per season. The page reads it once and hands it to the editor
 * (spec §6.1); from then on the editor's store is the truth and saves in the
 * background, so nothing here re-reads after an edit. The editor draws the
 * item table from that store on a screen under 900 px and under its no-WebGL
 * notice (§7), so a phone, a screen reader and an old browser all still read
 * the map as it is being edited.
 *
 * Every number on this screen was typed by somebody (R11): no workbook holds
 * a map, and the chips say so.
 */
export default async function SitePage(
  { searchParams }: { searchParams: Promise<RawParams> },
) {
  const admin = await requireAdmin();
  if (!admin.ok) notFound();

  const params = await searchParams;
  const query = parseSiteQuery(params);
  const { current } = await resolveSeason(db, query.season || undefined);

  const crumbs = [{ label: 'מפת הקאמפ' }];

  if (current === null) {
    return (
      <main className={styles.page}>
        <TopBar crumbs={crumbs} />
        <h1>מפת הקאמפ</h1>
        <EmptyState
          kind="nothing-yet"
          noun="שנים"
          action={{ label: 'ייבוא מהגיליון', href: '/imports' }}
        />
      </main>
    );
  }

  /* The URL the sidebar wrote may carry no `season`; every link this page
     builds carries the one it resolved, so a switch of year survives a
     drawer (R5). Built from the season alone, never from the raw query, so
     nothing else in an old link — `?editor=3d` included — is carried on. */
  const here: RawParams = { season: current.id };
  const closeHref = siteHref(here);
  const view = await siteView(db, current.id);
  const others = (await seasonsWithPlans(db)).filter((plan) => plan.seasonId !== current.id);

  if (view === null) {
    return (
      <main className={styles.page}>
        <TopBar crumbs={crumbs} chip={<SeasonChip seasonName={current.name} />} />
        <h1>מפת הקאמפ</h1>
        <EmptyState
          kind="nothing-this-season"
          noun="מפות"
          seasonName={current.name}
          action={{ label: 'יצירת מפה', href: plotHref(here) }}
        />
        {others.length === 0 ? null : (
          <div className={styles.invitations}>
            <ButtonLink size="sm" href={copyHref(here)}>
              <Icon name="copy" size={14} />
              {`העתקה מ${others[0].seasonName}`}
            </ButtonLink>
          </div>
        )}
        {query.plot ? (
          <PlotDrawer seasonId={current.id} seasonName={current.name} plan={null} items={[]} closeHref={closeHref} />
        ) : null}
        {query.copy && others.length > 0 ? (
          <CopyDrawer seasonId={current.id} seasonName={current.name} sources={others} closeHref={closeHref} />
        ) : null}
      </main>
    );
  }

  const { plan, items } = view;

  /* `loadDoc` answers null only if the plan was there for `siteView` and not
     found a moment later. Not a 404 — the page exists — and never a guess:
     nothing in the platform deletes a map, so the page says only what it
     found, and what a reload will show — the map, opened for editing, if it
     is there; the invitation to create one if it is not. It keeps what it did
     read readable. No drawer opens over a map that could not be opened. */
  const loaded = await loadDoc(db, plan.id);
  if (loaded === null) {
    return (
      <main className={styles.page}>
        <TopBar crumbs={crumbs} chip={<SeasonChip seasonName={current.name} />} />
        <h1>מפת הקאמפ</h1>
        <Banner
          tone="warn"
          label="המפה לא נמצאה"
          headline="המפה לא נמצאה כשנפתחה לעריכה."
          detail="טעינה מחדש תקרא אותה שוב: אם היא שם, היא תיפתח לעריכה; אם לא, יוצע ליצור מפה לשנה הזו. עד אז, אלה הפריטים כפי שנקראו רגע לפני כן."
          action={{ label: 'טעינה מחדש', href: closeHref }}
        />
        <SiteTable
          items={items}
          season={current.id}
          empty={<EmptyState kind="nothing-this-season" noun="פריטים במפה" seasonName={current.name} />}
        />
      </main>
    );
  }

  /* `?peek=` selects an item when the map loads (spec §12) — only one that is
     on this season's map. Nothing opens over the editor for it, not even the
     retired board's `?act=remove`: a removal is undone in the editor. */
  const initialSelection = query.peek !== null && loaded.doc.items.some((entry) => entry.id === query.peek)
    ? query.peek
    : null;
  const buildTasks = (await listTasks(db, current.id, { kind: 'build' }))
    .map((task) => ({ id: task.taskId, title: task.title }));

  return (
    <main className={styles.editorPage}>
      <h1 className="sr-only">{`מפת הקאמפ · ${current.name}`}</h1>
      {/* Keyed on the plan, so another season's map is another editor and
          one season's name never sits over another's frozen map. Never on
          the version: a remount would drop edits not yet saved. A newer
          version reaching this editor is handled inside it (Task 25). */}
      <SiteEditor
        key={plan.id}
        initial={loaded}
        initialSelection={initialSelection}
        seasonId={current.id}
        seasonName={current.name}
        sunDate={sunDateOf(current.startsOn)}
        buildTasks={buildTasks}
        plotHref={plotHref(here)}
        seasonDateHref={seasonDateHref(here)}
      />
      {query.plot ? (
        <PlotDrawer
          seasonId={current.id}
          seasonName={current.name}
          plan={{ id: plan.id, widthCm: plan.widthCm, depthCm: plan.depthCm, gridCm: plan.gridCm, northDeg: plan.northDeg, notes: plan.notes }}
          items={items}
          closeHref={closeHref}
        />
      ) : null}
    </main>
  );
}

import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { db } from '@/db';
import { requireAdmin } from '@/lib/auth/guard';
import { resolveSeason } from '@/lib/seasons/current';
import { listTasks } from '@/lib/work/tasks';
import { itemById, loadDoc, seasonsWithPlans, siteView } from '@/lib/site/plan';
import { formatArea, formatSize } from '@/lib/site/geometry';
import {
  copyHref, itemHref, parseSiteQuery, plotHref, removeItemHref, seasonDateHref, siteHref, sunDateOf, type RawParams,
} from '@/lib/site/views';
import { TopBar, SeasonChip } from '@/components/shell/top-bar';
import { StatTile } from '@/components/ui/stat-tile';
import { Banner } from '@/components/ui/banner';
import { EmptyState } from '@/components/ui/empty-state';
import { ButtonLink } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { SiteBoard } from './site-board';
import { SiteTable } from './site-table';
import { ItemDrawer } from './item-drawer';
import { PlotDrawer } from './plot-drawer';
import { CopyDrawer } from './copy-drawer';
import { RemoveItem } from './remove-item';
import { SiteEditor } from './editor/site-editor';
import styles from './site.module.css';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'מפת הקאמפ' };

/**
 * מפת הקאמפ — where everything goes this year.
 *
 * One map per season, because the plot changes every burn. The board is the
 * editor; the table under it is the same map for a phone, a screen reader
 * and a printout; the tiles say what the drawing cannot say at a glance —
 * how much ground, how much of it shaded, what the fence cuts through.
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
     drawer (R5). */
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

  const { plan, items, counts } = view;

  /* The editor behind `?editor=3d`, until Task 26 makes it the page. `loadDoc`
     answers null only if the plan vanished since `siteView` read it; the
     board below is then the honest fallback. The item drawer and the remove
     page do not open over the editor: `?peek=` selects the item instead, so
     this branch comes before the drawer's own reads. */
  if (query.editor3d) {
    const loaded = await loadDoc(db, plan.id);
    if (loaded !== null) {
      /* `?peek=` selects an item when the map loads — only one on this map. */
      const initialSelection = query.peek !== null && loaded.doc.items.some((entry) => entry.id === query.peek)
        ? query.peek
        : null;
      const editorTasks = (await listTasks(db, current.id, { kind: 'build' }))
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
            seasonName={current.name}
            sunDate={sunDateOf(current.startsOn)}
            buildTasks={editorTasks}
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
  }

  /* Fetched rather than found among `items`: the id comes from a URL, and a
     row that is not on this plan is not this page's to open. */
  const peekedRow = query.peek === null ? null : await itemById(db, query.peek);
  const peeked = peekedRow !== null && peekedRow.planId === plan.id
    ? items.find((item) => item.id === peekedRow.id) ?? null
    : null;
  const buildTasks = peeked === null ? [] : (await listTasks(db, current.id, { kind: 'build' }))
    .map((task) => ({ id: task.taskId, title: task.title }));

  const plotLink = (
    <ButtonLink size="sm" href={plotHref(here)}>
      <Icon name="grid" size={14} />
      הגדרות המגרש
    </ButtonLink>
  );

  const drawers = (
    <>
      {peeked !== null && !query.removing ? (
        <ItemDrawer
          item={peeked}
          buildTasks={buildTasks}
          closeHref={closeHref}
          removeHref={removeItemHref(here, peeked.id)}
        />
      ) : null}
      {peeked !== null && query.removing ? (
        <RemoveItem item={{ id: peeked.id, label: peeked.label }} cancelHref={closeHref} />
      ) : null}
      {query.plot ? (
        <PlotDrawer
          seasonId={current.id}
          seasonName={current.name}
          plan={{ id: plan.id, widthCm: plan.widthCm, depthCm: plan.depthCm, gridCm: plan.gridCm, northDeg: plan.northDeg, notes: plan.notes }}
          items={items}
          closeHref={closeHref}
        />
      ) : null}
    </>
  );

  const firstOutside = items.find((item) => item.outside) ?? null;
  const shadeAttention = counts.shade.partly + counts.shade.unshaded;

  return (
    <main className={styles.page}>
      <TopBar crumbs={crumbs} chip={<SeasonChip seasonName={current.name} />} actions={plotLink} />

      <div className={styles.head}>
        <div>
          <h1>מפת הקאמפ</h1>
          <p className={styles.sub}>
            <bdi>{`מגרש של ${formatSize(plan.widthCm, plan.depthCm)} ל${current.name}`}</bdi>
            {' · '}
            <bdi>{`${counts.items} פריטים במפה`}</bdi>
          </p>
        </div>
      </div>

      {counts.outside > 0 ? (
        <Banner
          tone="danger"
          headline={<bdi>{`${counts.outside} פריטים נמצאים מחוץ למגרש.`}</bdi>}
          detail="המגרש שונה והפריטים לא זזו — יש להזיז אותם או להגדיל את המגרש."
          action={firstOutside === null ? undefined : { label: 'לפריט הראשון', href: itemHref(here, firstOutside.id) }}
          label="פריטים מחוץ למגרש"
        />
      ) : null}

      <div className={styles.tiles}>
        <StatTile
          label="שטח המגרש"
          value={formatArea(counts.plotAreaM2)}
          derivation={<bdi>{`${formatSize(plan.widthCm, plan.depthCm)} · נרשם ידנית`}</bdi>}
          href={plotHref(here)}
        />
        <StatTile
          label="שטח בצל"
          value={formatArea(counts.shade.shadedAreaM2)}
          tone={shadeAttention > 0 ? 'warn' : 'default'}
          derivation={counts.shade.nets === 0
            ? 'אין רשתות צל במפה'
            : <bdi>{`${counts.shade.nets} רשתות צל · ${shadeAttention} פריטים חלקית או ללא צל`}</bdi>}
        />
        <StatTile
          label="מחוץ למגרש"
          value={counts.outside}
          tone={counts.outside > 0 ? 'bad' : 'default'}
          derivation={counts.outside === 0 ? 'הכול בתוך הגדר' : 'הפריטים לא זזו לבד'}
          href={firstOutside === null ? undefined : itemHref(here, firstOutside.id)}
        />
        <StatTile
          label="חפיפות"
          value={counts.overlapPairs}
          tone={counts.overlapPairs > 0 ? 'warn' : 'default'}
          derivation={counts.overlapPairs === 0
            ? 'שום דבר לא יושב על משהו אחר'
            : <bdi>{`${counts.overlapping} פריטים מעורבים`}</bdi>}
        />
      </div>

      <SiteBoard
        plan={{ id: plan.id, widthCm: plan.widthCm, depthCm: plan.depthCm, gridCm: plan.gridCm }}
        items={items.map((item) => ({
          id: item.id, kind: item.kind, label: item.label, sort: item.sort,
          xCm: item.xCm, yCm: item.yCm, widthCm: item.widthCm, depthCm: item.depthCm,
          insetCm: item.insetCm,
        }))}
        season={current.id}
        initialSelected={peeked?.id ?? null}
      />

      <SiteTable
        items={items}
        params={here}
        season={current.id}
        rowActions={(row) => (
          /* Two glyphs, named for assistive technology (E4): the pencil opens
             the same drawer the board's toolbar does, the bin opens the
             confirmation — never the delete itself. */
          <>
            <ButtonLink tone="ghost" size="sm" iconLabel="עריכה" href={itemHref(here, row.id)}>
              <Icon name="pencil" size={15} />
            </ButtonLink>
            <ButtonLink tone="ghost" size="sm" iconLabel="מחיקה" href={removeItemHref(here, row.id)}>
              <Icon name="trash" size={15} />
            </ButtonLink>
          </>
        )}
        empty={(
          /* An invitation: the palette above is how a thing gets on the map. */
          <EmptyState kind="nothing-this-season" noun="פריטים במפה" seasonName={current.name} />
        )}
      />

      {drawers}
    </main>
  );
}

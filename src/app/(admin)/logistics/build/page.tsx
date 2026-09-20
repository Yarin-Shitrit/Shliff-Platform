import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { db } from '@/db';
import { requireAdmin } from '@/lib/auth/guard';
import { resolveSeason } from '@/lib/seasons/current';
import { listBuildTasks, buildCounts } from '@/lib/logistics/build';
import { listWarehouse } from '@/lib/logistics/warehouse';
import { listAcquisitions } from '@/lib/logistics/acquisitions';
import {
  parseBuildQuery, buildHref, addMaterialHref, type RawParams,
} from '@/lib/logistics/build-views';
import { WAREHOUSE_PATH } from '@/lib/logistics/warehouse-views';
import { ACQUISITIONS_PATH } from '@/lib/logistics/acquisitions-views';
import { TopBar, SeasonChip } from '@/components/shell/top-bar';
import { StatTile } from '@/components/ui/stat-tile';
import { Banner } from '@/components/ui/banner';
import { EmptyState } from '@/components/ui/empty-state';
import { ButtonLink } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { DateText } from '@/components/format';
import { BuildTable, groupOf, type BuildLine } from './build-table';
import { MaterialDrawer } from './material-drawer';
import { RemoveMaterial } from './remove-material';
import styles from './build.module.css';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'הקמה' };

/**
 * הקמה — the build tasks of one season, and what each of them needs.
 *
 * The tasks are not this screen's: they are the same `build` tasks the משימות
 * board shows, read through the same function, so the two can never disagree
 * about who is on one or when it is due. What this screen adds is the
 * materials — and every material's state is computed here at load from the
 * warehouse and the רכש list, never stored, because a stored one would go on
 * saying `במחסן` after somebody took the thing.
 */
export default async function BuildPage(
  { searchParams }: { searchParams: Promise<RawParams> },
) {
  const admin = await requireAdmin();
  if (!admin.ok) notFound();

  const params = await searchParams;
  const query = parseBuildQuery(params);
  const { current } = await resolveSeason(db, query.season || undefined);

  if (current === null) {
    return (
      <main className={styles.page}>
        <TopBar crumbs={[{ label: 'לוגיסטיקה', href: '/logistics' }, { label: 'הקמה' }]} />
        <h1>הקמה</h1>
        <EmptyState
          kind="nothing-yet"
          noun="שנים"
          action={{ label: 'ייבוא מהגיליון', href: '/imports' }}
        />
      </main>
    );
  }

  const tasks = await listBuildTasks(db, current.id);
  const counts = buildCounts(tasks);

  const peeked = query.peek === null
    ? null : tasks.find((task) => task.taskId === query.peek) ?? null;

  /* Only loaded when a drawer is open: the pickers are the only thing that
     needs the whole warehouse and the whole רכש list, and this page is read
     far more often than it is written to. */
  const [stock, orders] = peeked === null && !query.adding ? [[], []] : await Promise.all([
    listWarehouse(db, {
      view: 'all', q: '', category: null, sort: 'name', dir: 'asc',
      peek: null, creating: false,
    }),
    listAcquisitions(db, current.id, {
      season: current.id, view: 'all', q: '', category: null,
      sort: 'name', dir: 'asc', peek: null, creating: false, arriving: false,
    }),
  ]);

  const closeHref = buildHref(params, {});

  /** How many tasks sit in each bucket, for the group headings. */
  const groupCounts: Record<string, number> = {};
  for (const task of tasks) {
    const group = groupOf(task);
    groupCounts[group] = (groupCounts[group] ?? 0) + 1;
  }

  return (
    <main className={styles.page}>
      <TopBar
        crumbs={[{ label: 'לוגיסטיקה', href: '/logistics' }, { label: 'הקמה' }]}
        chip={<SeasonChip seasonName={current.name} />}
        actions={(
          <ButtonLink size="sm" href="/tasks">
            <Icon name="tasks" size={14} />
            כל המשימות
          </ButtonLink>
        )}
      />

      <div className={styles.head}>
        <div>
          <h1>הקמה</h1>
          <p className={styles.sub}>
            <bdi>{`${counts.openTasks} משימות הקמה ל${current.name}`}</bdi>
            {' · '}
            <bdi>{`${counts.blockedTasks} ממתינות לחומרים`}</bdi>
            {counts.nextDueOn === null ? null : (
              <>{' · הראשונה ביעד '}<DateText at={counts.nextDueOn} /></>
            )}
          </p>
        </div>
      </div>

      {/*
        Said once, at the top, because the alternative is a lead maintaining
        two lists: these are the same tasks, with the same people and the same
        dates, and only the materials are added here. W24's rule — surface it
        with a link, never with a second implementation.
      */}
      <Banner
        tone="neutral"
        headline="המשימות כאן הן משימות ההקמה מתוך ״משימות״."
        detail="אותן משימות, אותם אחראים ואותם תאריכים. מה שנוסף כאן הוא רשימת הציוד שכל משימה דורשת."
        action={{ label: 'מעבר למשימות', href: '/tasks' }}
      />

      <div className={styles.tiles}>
        <StatTile
          label="משימות הקמה פתוחות"
          value={counts.openTasks}
          derivation={<bdi>{`${counts.blockedTasks} מהן ממתינות לחומר`}</bdi>}
          href="/tasks"
        />
        <StatTile
          label="חומרים שחסרים"
          value={counts.missingMaterials}
          tone={counts.missingMaterials > 0 ? 'bad' : 'default'}
          derivation={counts.missingMaterials === 0
            ? 'אין חומר חסר'
            : <bdi>{`${counts.missingOnAcquisitionList} מהם כבר ברשימת הרכש`}</bdi>}
          href={ACQUISITIONS_PATH}
        />
        <StatTile
          label="חומרים שדורשים תיקון"
          value={counts.repairMaterials}
          tone={counts.repairMaterials > 0 ? 'warn' : 'default'}
          derivation="קיימים במחסן אבל לא במצב עבודה"
          href={`${WAREHOUSE_PATH}?view=attention`}
        />
      </div>

      <BuildTable
        tasks={tasks}
        groupCounts={groupCounts}
        rowActions={(line: BuildLine) => (line.kind === 'task' ? (
          <ButtonLink size="sm" href={addMaterialHref(params, line.task.taskId)}>
            <Icon name="plus" size={14} />
            חומר
          </ButtonLink>
        ) : (
          <RemoveMaterial material={line.material} />
        ))}
        empty={(
          /* An invitation, not an apology. The action is `/tasks`, because a
             build task is created there and this screen would be lying if it
             offered to create one of its own. */
          <EmptyState
            kind="nothing-this-season"
            noun="משימות הקמה"
            seasonName={current.name}
            action={{ label: 'יצירת משימת הקמה', href: '/tasks?act=task' }}
          />
        )}
      />

      {peeked !== null && query.adding && (
        <MaterialDrawer
          taskId={peeked.taskId}
          taskTitle={peeked.title}
          stock={stock.map((item) => ({
            id: item.id, name: item.name, locationText: item.locationText, condition: item.condition,
          }))}
          orders={orders.map((order) => ({
            id: order.id, name: order.name, status: order.status,
          }))}
          closeHref={closeHref}
        />
      )}
    </main>
  );
}

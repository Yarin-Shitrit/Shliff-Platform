import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db } from '@/db';
import { requireAdmin } from '@/lib/auth/guard';
import { personDossier } from '@/lib/members/dossier';
import { listSeasons } from '@/lib/members/roster';
import { listPeopleForSeason } from '@/lib/members/people-list';
import { aliasSourcesFor, type AliasSource } from '@/lib/members/alias-sources';
import { personChangeLog, type ChangeEntry } from '@/lib/members/change-log';
import { listObligations } from '@/lib/money/obligations';
import { accountBalances } from '@/lib/money/accounts';
import { listPayments, type PaymentRow } from '@/lib/fees/payments';
import type { ObligationRow } from '@/lib/money/obligations';
import { roleLabel, dueKindLabel, DUES_STATE_LABELS } from '@/lib/members/labels';
import type { DuesState } from '@/lib/members/people-list';
import type { DossierDue } from '@/lib/members/dossier';
import { mergeHref, type RawParams } from '@/lib/members/people-views';
import type { Responsibility } from '@/lib/work/coverage';
/* A39: was a fourth local copy of these four words, typed Record<string,
   string> so a fifth TaskKind would have rendered the raw enum value here. */
import { TASK_KIND_LABELS } from '@/lib/work/labels';
import { Avatar } from '@/components/ui/avatar';
import { Pill, type PillTone } from '@/components/ui/pill';
import { Table, type TableColumn } from '@/components/ui/table';
import { Popover } from '@/components/ui/popover';
import { StatTile } from '@/components/ui/stat-tile';
import { SourceChip } from '@/components/ui/source-chip';
import { EmptyState } from '@/components/ui/empty-state';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Icon } from '@/components/ui/icon';
import { Button, ButtonLink } from '@/components/ui/button';
import { Field, TextInput } from '@/components/ui/field';
import { Money, DateText } from '@/components/format';
import { formatShekels } from '@/lib/money';
import { formatDateShort, formatDateTime } from '@/lib/dates';
import { AddToSeason } from '../add-member';
import { renamePersonAndReturn, unlinkAliasAndReturn } from '../actions';
import { UNLINK_ERROR_PARAM } from '../unlink-error';
import { RENAME_ERROR_PARAM, RENAME_PARAM } from '../rename-params';
import styles from './person.module.css';

export const dynamic = 'force-dynamic';

/**
 * A `shift` responsibility that cannot say when it runs does not answer
 * "what am I responsible for" — so timing is rendered whenever any of it is
 * present, not only for shifts. A start and an end become a range; a lone
 * start or end stands alone; a `dueOn` is a deadline, not a window, and is
 * shown independently of the other two.
 */
function timingParts(item: Responsibility): Array<{ label: string; value: string }> {
  const parts: Array<{ label: string; value: string }> = [];
  if (item.startsAt && item.endsAt) {
    parts.push({ label: 'מ־', value: formatDateTime(item.startsAt) });
    parts.push({ label: 'עד', value: formatDateTime(item.endsAt) });
  } else if (item.startsAt) {
    parts.push({ label: 'החל מ־', value: formatDateTime(item.startsAt) });
  } else if (item.endsAt) {
    parts.push({ label: 'עד', value: formatDateTime(item.endsAt) });
  }
  if (item.dueOn) {
    parts.push({ label: 'מועד יעד', value: formatDateTime(item.dueOn) });
  }
  return parts;
}

/**
 * The list's words for a due's state, said about this person's dues. The
 * dossier carries `settled` and the amounts rather than a `DuesState`, and
 * cannot tell a settlement by קיזוז from one by cash — so a settled due reads
 * `שולם` here, as the tile already does, and never `שולם בקיזוז`. A local tone
 * map rather than `people-table.tsx`'s: that file is a client module, and a
 * `const` read from it across the boundary is `undefined`
 * (`client-boundary.test.ts`).
 */
function dueStateOf(due: DossierDue): DuesState {
  if (due.kind === 'exception' && due.amountAgorot === 0) return 'exempt';
  if (due.settled) return 'paid';
  if (due.paidAgorot > 0) return 'partial';
  return 'unpaid';
}

const DUE_STATE_TONE: Record<DuesState, PillTone> = {
  paid: 'ok', offset: 'info', partial: 'warn', unpaid: 'bad', exempt: 'neutral', none: 'neutral',
};

/** One season of this person's life in the camp: the membership, and the due
 *  issued for it, when one was. */
type SeasonRow = {
  seasonId: string;
  seasonName: string;
  role: string;
  due: DossierDue | null;
  current: boolean;
};

type ResponsibilityRow = Responsibility;

type PaymentListRow = PaymentRow & { seasonName: string };

const TABS = ['overview', 'payments', 'tasks', 'debts', 'aliases', 'history'] as const;
type PersonTab = (typeof TABS)[number];

const TAB_LABELS: Record<PersonTab, string> = {
  overview: 'סקירה',
  payments: 'תשלומים',
  tasks: 'משימות',
  debts: 'חובות',
  aliases: 'כינויים',
  history: 'היסטוריה',
};

function one(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}

/**
 * E5's glossary lives on the screen, which is why `personChangeLog` returns
 * structure and not sentences. Every form is a noun phrase: Hebrew verbs
 * inflect for gender, the schema records none, and the roster is mixed.
 */
function changeSentence(entry: ChangeEntry): string {
  switch (entry.kind) {
    case 'joined_season': return `הצטרפות ל${entry.subject}`;
    case 'alias_linked': return `קישור הכינוי ${entry.subject}`;
    case 'alias_merged': return `הכינוי ${entry.subject} הגיע ממיזוג`;
    case 'exception_decided': return `חריג — ${entry.subject}`;
    case 'payment_recorded':
      return `נרשם תשלום ${formatShekels(entry.amountAgorot ?? 0)} ב${entry.subject}`;
    case 'assigned': return `שיבוץ ל${entry.subject}`;
  }
}

/**
 * R11. A manual spelling says so and that is the whole truth about it. An
 * import spelling gets a workbook cell only when one corroborates it — the
 * obligation whose party name normalizes to the same string — and otherwise
 * reads `מקובץ` and stops there. `person_aliases` has no `source_block_id`
 * and this plan adds none, so an invented cell is the only alternative, and
 * inventing one is exactly what the platform forbids.
 */
function AliasSourceMark({ alias }: { alias: AliasSource }) {
  if (alias.source === 'manual') return <SourceChip source={{ kind: 'manual' }} />;
  if (alias.cell === null) return <span className={styles.noCell}>מקובץ</span>;

  const [sheet, cell] = alias.cell.reference.split('!');
  return <SourceChip source={{ kind: 'workbook', sheet, cell }} />;
}

export async function generateMetadata(
  { params }: { params: Promise<{ id: string }> },
): Promise<Metadata> {
  const { id } = await params;
  const dossier = await personDossier(db, id);
  return { title: `${dossier?.displayName ?? 'אדם'} · אנשים` };
}

export default async function PersonPage(
  { params, searchParams }: {
    params: Promise<{ id: string }>;
    searchParams: Promise<RawParams>;
  },
) {
  const admin = await requireAdmin();
  if (!admin.ok) notFound();

  const { id } = await params;
  const dossier = await personDossier(db, id);
  if (!dossier) notFound();

  const search = await searchParams;
  const rawTab = one(search.tab) as PersonTab;
  const tab: PersonTab = TABS.includes(rawTab) ? rawTab : 'overview';

  const seasons = await listSeasons(db);
  const requested = one(search.season);
  const scope = seasons.find((season) => season.id === requested) ?? seasons[0] ?? null;

  const aliasSources = await aliasSourcesFor(db, dossier.personId);
  const log = await personChangeLog(db, dossier.personId);
  const accounts = (await accountBalances(db))
    .filter((account) => account.holderPersonId === dossier.personId);
  const owedToThem = (await listObligations(db, { direction: 'camp_owes' }))
    .filter((row) => row.partyPersonId === dossier.personId);

  /*
   * One query for the whole roster instead of four per person: `listPeople`
   * issued an aliases, a memberships and a dues query per row to populate a
   * `<select>` nobody could search. The merge entry point is now a list of
   * links, each one A3's URL for this record and that candidate.
   */
  const candidates = (await listPeopleForSeason(db, null))
    .filter((person) => person.personId !== dossier.personId);

  const scopeDue = scope === null
    ? null
    : dossier.dues.find((row) => row.seasonName === scope.name) ?? null;

  /*
   * Every payment this person ever made, one read per due — at most one per
   * season, so four reads on the longest record. The תשלומים tab lists them;
   * a tab that listed the dues instead repeated the overview's seasons table
   * under another name, and the actual payments were nowhere on the page.
   */
  const paymentRows: PaymentListRow[] = [];
  for (const due of dossier.dues) {
    for (const payment of await listPayments(db, due.dueId)) {
      paymentRows.push({ ...payment, seasonName: due.seasonName });
    }
  }
  paymentRows.sort((a, b) => a.paidOn.getTime() - b.paidOn.getTime());
  const lastPayment = scopeDue === null
    ? null
    : paymentRows.filter((row) => row.seasonName === scopeDue.seasonName).at(-1) ?? null;

  const outstandingAgorot = dossier.dues
    .reduce((total, row) => total + row.outstandingAgorot, 0);
  const owingSeasons = dossier.dues.filter((row) => row.outstandingAgorot > 0).length;
  const owedAgorot = owedToThem.reduce((total, row) => total + row.outstandingAgorot, 0);

  const scopeTasks = scope === null
    ? []
    : dossier.responsibilities.filter((task) => task.seasonName === scope.name);

  const role = dossier.seasons.find((season) => season.seasonId === scope?.id)?.role
    ?? dossier.seasons[0]?.role
    ?? null;
  const onScopeSeason = scope !== null
    && dossier.seasons.some((season) => season.seasonId === scope.id);

  const seasonRows: SeasonRow[] = dossier.seasons.map((season) => ({
    seasonId: season.seasonId,
    seasonName: season.seasonName,
    role: season.role,
    due: dossier.dues.find((due) => due.seasonName === season.seasonName) ?? null,
    current: season.seasonId === scope?.id,
  }));

  /** Back to the list, on the same season (R5). */
  const listHref = requested === '' ? '/members' : `/members?season=${requested}`;

  const otherSpellings = dossier.aliases
    .map((alias) => alias.alias)
    .filter((alias) => alias !== dossier.displayName);

  const dated = log.filter((entry) => entry.at !== null);
  const undated = log.filter((entry) => entry.at === null);

  function tabHref(next: PersonTab): string {
    const query = new URLSearchParams();
    if (requested !== '') query.set('season', requested);
    if (next !== 'overview') query.set('tab', next);
    const text = query.toString();
    return text === '' ? `/members/${dossier!.personId}` : `/members/${dossier!.personId}?${text}`;
  }

  /*
   * Ruling 5's confirmation, driven by the URL rather than by state. R7 allows
   * this screen exactly two new client components and both are spent, so the
   * dialog is raised by `?unlink=<aliasId>`, submits a bound Server Action, and
   * cancels through `ConfirmDialog`'s `cancelHref` — no closure crosses the
   * server/client boundary, and the decision survives a refresh like every
   * other drawer here.
   */
  function unlinkHref(aliasId: string): string {
    const query = new URLSearchParams();
    if (requested !== '') query.set('season', requested);
    if (tab !== 'overview') query.set('tab', tab);
    query.set('unlink', aliasId);
    return `/members/${dossier!.personId}?${query.toString()}`;
  }

  /*
   * `createPerson` writes the display name as the first alias and `resolveName`
   * matches on aliases alone, so a person with none is invisible to every future
   * import. `unlinkAliasAction` refuses that case against the database — this is
   * the same refusal said before the fact, so the screen never offers a control
   * whose only outcome is a refusal.
   */
  const canUnlink = aliasSources.length > 1;
  const unlinking = canUnlink
    ? aliasSources.find((alias) => alias.aliasId === one(search.unlink)) ?? null
    : null;

  /*
   * A38 (BINDING): a server-rendered dialog may not swallow a refusal.
   *
   * `ConfirmDialog` submits through a plain `<form action>`, which has nowhere
   * to put an `ActionResult`. This used to drop the value on the floor, and
   * argued it was safe because `canUnlink` withholds the control for the only
   * refusal the screen itself can reach. That argument is true and it is not
   * enough: `?unlink=` is a URL anyone can type, and a hand-typed alias id
   * belonging to somebody else failed with **no message at all** — not English
   * on a Hebrew screen, no message. A38 calls that the platform's first rule
   * broken in the quietest way there is, since nothing goes red.
   *
   * `unlinkAliasAndReturn` redirects back with the refusal in the URL instead,
   * the mechanism `/signin` already uses, and the banner below renders it.
   */
  const unlinkingId = unlinking?.aliasId ?? '';
  const unlinkError = one(search[UNLINK_ERROR_PARAM]);

  /*
   * The rename form, URL-driven like the unlink dialog and for the same
   * reason: this screen's client-component budget (R7) is spent, and a form
   * a Server Component renders with a bound Server Action needs none. It
   * opens on `?rename=1`, posts to `renamePersonAndReturn`, and both the
   * cancel link and the success redirect go to `tabHref(tab)` — the same
   * page without the param — so it closes either way. A refusal comes back
   * in `?renameError=` and lands in the banner above the header (A38).
   */
  const renaming = one(search[RENAME_PARAM]) === '1';
  const renameError = one(search[RENAME_ERROR_PARAM]);
  const renameFieldId = 'person-rename';

  function renameHref(): string {
    const query = new URLSearchParams();
    if (requested !== '') query.set('season', requested);
    if (tab !== 'overview') query.set('tab', tab);
    query.set(RENAME_PARAM, '1');
    return `/members/${dossier!.personId}?${query.toString()}`;
  }

  const counts: Record<PersonTab, number | undefined> = {
    overview: undefined,
    payments: paymentRows.length,
    tasks: dossier.responsibilities.length,
    debts: owedToThem.length,
    aliases: aliasSources.length,
    history: log.length,
  };

  const seasonColumns: ReadonlyArray<TableColumn<SeasonRow>> = [
    {
      key: 'season',
      card: 'title',
      header: 'שנה',
      cell: (row) => (
        <span className={styles.seasonCell}>
          <bdi>{row.seasonName}</bdi>
          {row.current ? <Pill tone="brand">נוכחית</Pill> : null}
        </span>
      ),
    },
    { key: 'role', card: 'meta', header: 'תפקיד', cell: (row) => roleLabel(row.role) },
    {
      key: 'dues',
      card: 'meta',
      header: 'דמי קאמפ',
      cell: (row) => (row.due === null
        ? <span className="muted">לא הונפק חיוב</span>
        : (
          <span className={styles.duesCell}>
            <Pill tone={DUE_STATE_TONE[dueStateOf(row.due)]} dot>
              {DUES_STATE_LABELS[dueStateOf(row.due)]}
            </Pill>
            {row.due.kind === 'exception' ? (
              <span className={styles.cellNote}>
                {dueKindLabel(row.due.kind)}
                {row.due.exceptionReason === null || row.due.exceptionReason === ''
                  ? null
                  : ` · ${row.due.exceptionReason}`}
              </span>
            ) : null}
          </span>
        )),
    },
    {
      key: 'amount',
      card: 'figure',
      header: 'לתשלום',
      numeric: true,
      cell: (row) => (row.due === null ? <span className="muted">—</span> : <Money agorot={row.due.amountAgorot} />),
    },
    {
      key: 'paid',
      card: 'figure',
      header: 'שולם',
      numeric: true,
      cell: (row) => (row.due === null || row.due.paidAgorot === 0
        ? <span className="muted">—</span>
        : <Money agorot={row.due.paidAgorot} />),
    },
    {
      key: 'outstanding',
      card: 'figure',
      header: 'יתרה',
      numeric: true,
      /* A zero balance is `—`, as on the list: a column of zeroes reads as a
         column of debts to check. */
      cell: (row) => (row.due === null || row.due.outstandingAgorot === 0
        ? <span className="muted">—</span>
        : <Money agorot={row.due.outstandingAgorot} />),
    },
  ];

  const paymentColumns: ReadonlyArray<TableColumn<PaymentListRow>> = [
    { key: 'paidOn', card: 'meta', header: 'תאריך', cell: (row) => <DateText at={row.paidOn} /> },
    { key: 'season', card: 'title', header: 'שנה', cell: (row) => <bdi>{row.seasonName}</bdi> },
    /* The channel values are already Hebrew words (`PAYMENT_CHANNELS`). */
    { key: 'channel', card: 'meta', header: 'איך', cell: (row) => <Pill tone="neutral">{row.channel}</Pill> },
    {
      key: 'amount',
      card: 'figure',
      header: 'סכום',
      numeric: true,
      cell: (row) => <Money agorot={row.amountAgorot} />,
    },
    {
      key: 'note',
      card: 'meta',
      header: 'הערה',
      cell: (row) => (row.note === null || row.note === ''
        ? <span className="muted">—</span>
        : <span className={styles.wrapCell}>{row.note}</span>),
    },
    { key: 'by', card: 'meta', header: 'נרשם ע״י', cell: (row) => <bdi>{row.recordedBy}</bdi> },
  ];

  const taskColumns: ReadonlyArray<TableColumn<ResponsibilityRow>> = [
    { key: 'title', card: 'title', header: 'משימה', cell: (row) => <span className={styles.wrapCell}>{row.title}</span> },
    {
      key: 'kind',
      card: 'meta',
      header: 'סוג',
      cell: (row) => (
        <>
          {TASK_KIND_LABELS[row.kind] ?? row.kind}
          {row.eventName === null ? null : <span className={styles.cellNote}>{` · ${row.eventName}`}</span>}
        </>
      ),
    },
    { key: 'season', card: 'meta', header: 'שנה', cell: (row) => <bdi>{row.seasonName}</bdi> },
    {
      key: 'when',
      card: 'meta',
      header: 'מתי',
      cell: (row) => {
        const parts = timingParts(row);
        if (parts.length === 0) return <span className="muted">—</span>;
        return (
          <span className={styles.timing}>
            {parts.map((part) => (
              <span key={part.label}>{part.label} <bdi>{part.value}</bdi></span>
            ))}
          </span>
        );
      },
    },
    {
      key: 'budget',
      card: 'figure',
      header: 'תקציב',
      numeric: true,
      cell: (row) => (row.budgetAgorot === null
        ? <span className="muted">—</span>
        : <Money agorot={row.budgetAgorot} />),
    },
  ];

  const debtColumns: ReadonlyArray<TableColumn<ObligationRow>> = [
    { key: 'description', card: 'title', header: 'על מה', cell: (row) => <span className={styles.wrapCell}>{row.description}</span> },
    {
      key: 'opened',
      card: 'meta',
      header: 'נפתח',
      /* `null` means the workbook does not say when — so neither does this. */
      cell: (row) => (row.openedOn === null
        ? <span className="muted">ללא תאריך</span>
        : <DateText at={row.openedOn} />),
    },
    {
      key: 'state',
      card: 'meta',
      header: 'מצב',
      cell: (row) => (row.settled
        ? <Pill tone="ok" dot>קוזז במלואו</Pill>
        : <Pill tone="warn" dot>פתוח</Pill>),
    },
    {
      key: 'amount',
      card: 'figure',
      header: 'סכום',
      numeric: true,
      cell: (row) => <Money agorot={row.amountAgorot} />,
    },
    {
      key: 'settled',
      card: 'figure',
      header: 'קוזז',
      numeric: true,
      cell: (row) => (row.settledAgorot === 0
        ? <span className="muted">—</span>
        : <Money agorot={row.settledAgorot} />),
    },
    {
      key: 'outstanding',
      card: 'figure',
      header: 'נותר',
      numeric: true,
      cell: (row) => (row.outstandingAgorot === 0
        ? <span className="muted">—</span>
        : <Money agorot={row.outstandingAgorot} />),
    },
  ];

  return (
    <main className={styles.page}>
      {/*
        A38. Where a refusal from the unlink dialog lands. `unlinkAliasAndReturn`
        redirects here carrying its own Hebrew sentence, so a refusal reached
        by a hand-typed `?unlink=` is read rather than lost — and the refusal
        the server wrote is the one on screen, never a second copy of it
        maintained here.
      */}
      {unlinkError === '' ? null : (
        <p className={styles.unlinkError} role="alert">{unlinkError}</p>
      )}
      {renameError === '' ? null : (
        <p className={styles.unlinkError} role="alert">{renameError}</p>
      )}
      {/* The way back keeps the season (R5). A record page reached from a
          chat link has no list behind it to return to otherwise. */}
      <nav className={styles.crumbs} aria-label="מיקום">
        <Link href={listHref}>אנשים</Link>
        <Icon name="left" size={14} />
        <span aria-current="page">{dossier.displayName}</span>
      </nav>

      <header className={styles.head}>
        <Avatar name={dossier.displayName} size="lg" />
        <div className={styles.headText}>
          <h1>{dossier.displayName}</h1>
          {renaming ? (
            <form
              className={styles.renameForm}
              action={renamePersonAndReturn.bind(null, dossier.personId, tabHref(tab))}
            >
              <Field
                id={renameFieldId}
                label="שם חדש"
                hint="השם הנוכחי נשאר כינוי, כך שהקבצים ימשיכו למצוא את האדם."
                required
              >
                <TextInput
                  id={renameFieldId}
                  name="displayName"
                  defaultValue={dossier.displayName}
                  required
                />
              </Field>
              <div className={styles.renameActions}>
                <Button tone="primary" type="submit">שמירת השם</Button>
                <ButtonLink tone="ghost" href={tabHref(tab)} replace>ביטול</ButtonLink>
              </div>
            </form>
          ) : null}
          {/*
            The mock draws `050-1234567 · roni@example.com` here. `persons`
            carries display_name, notes, merged_into_id and created_at — no
            phone, no email — and this plan adds no column, so the sub-line is
            the person's other spellings instead. A real fact in the place the
            mock wanted one; an empty field for a column that does not exist
            would be worse than its absence.
          */}
          {otherSpellings.length > 0 ? (
            <p className={styles.subline}>{`גם: ${otherSpellings.join(' · ')}`}</p>
          ) : null}
        </div>
        <div className={styles.headActions}>
          {role === null ? null : (
            <Pill tone={role === 'lead' ? 'brand' : 'neutral'}>{roleLabel(role)}</Pill>
          )}
          {/* A link, not a button: the form it opens lives in the URL, so a
              half-finished rename survives a refresh like every other drawer
              here, and the control disappears while the form is open. */}
          {renaming ? null : (
            <ButtonLink tone="ghost" size="sm" href={renameHref()} replace>
              <Icon name="pencil" size={14} /> שינוי שם
            </ButtonLink>
          )}
          {/*
            The mock's top bar: the two verbs a lead opens a person for. Both
            hand off to the screens that own the write — /fees opens its
            payment drawer from `?peek=<personId>&act=pay`, A3's shape; /tasks
            has no per-person drawer and lands on the season's board. Withheld
            off the scope season: a payment is season-scoped, and a link that
            can only land on the wrong year is worse than none.
          */}
          {scope === null ? null : (
            <ButtonLink size="sm" href={`/tasks?season=${scope.id}`}>
              <Icon name="tasks" size={14} /> שיבוץ למשימה
            </ButtonLink>
          )}
          {scope === null || !onScopeSeason ? null : (
            <ButtonLink tone="primary" size="sm" href={`/fees?season=${scope.id}&peek=${dossier.personId}&act=pay`}>
              <Icon name="receipt" size={14} /> רישום תשלום
            </ButtonLink>
          )}
          {/*
            D4's merge entry point: a link per candidate, never a form. The
            comparison, the preview of what moves and the acknowledgement all
            live on the drawer this opens — nothing merges from here.
          */}
          {candidates.length === 0 ? null : (
            <Popover
              id="merge-target"
              label="מיזוג לתוך אדם אחר"
              triggerContent={<><Icon name="merge" size={14} /> מיזוג</>}
              align="end"
            >
              {candidates.map((candidate) => (
                <Link
                  key={candidate.personId}
                  className={styles.menuItem}
                  href={mergeHref(
                    { season: requested || undefined },
                    dossier.personId,
                    candidate.personId,
                  )}
                >
                  {candidate.displayName}
                </Link>
              ))}
            </Popover>
          )}
        </div>
      </header>

      {/*
        Five tiles, of which three always render. Tiles 3 and 4 appear only
        when there is something to report: a `0 ₪` debt tile implies the camp
        owes this person nothing *yet*, and a zero-balance account tile implies
        a relationship with the קופה that does not exist. A zero is not a
        neutral value here; it is a claim.
      */}
      <div className={styles.tiles}>
        <StatTile
          label={scope === null ? 'דמי קאמפ' : `דמי קאמפ · ${scope.name}`}
          value={scopeDue === null ? 'אין חיוב' : (scopeDue.settled ? 'שולם' : 'טרם שולם')}
          tone={scopeDue === null ? 'default' : (scopeDue.settled ? 'ok' : 'warn')}
          derivation={scopeDue === null ? 'לא הונפק חיוב לשנה הזו' : (
            <bdi>
              {`${formatShekels(scopeDue.amountAgorot)} · ${dueKindLabel(scopeDue.kind)}`}
              {/* A payment is dated to a day, never a time: the column is a
                  date, and a time of day on it would be the server's
                  midnight dressed as a fact. */}
              {lastPayment === null ? ' · טרם נרשם תשלום' : ` · ${formatDateShort(lastPayment.paidOn)}`}
            </bdi>
          )}
          href={scope === null ? undefined : `/fees?season=${scope.id}&person=${dossier.personId}`}
        />

        <StatTile
          label="יתרה לתשלום"
          valueAgorot={outstandingAgorot}
          tone={outstandingAgorot > 0 ? 'bad' : 'ok'}
          derivation={outstandingAgorot === 0
            ? 'אין חוב לקאמפ'
            : <bdi>{`מתוך ${owingSeasons} שנים`}</bdi>}
          href={tabHref('payments')}
        />

        {owedAgorot === 0 ? null : (
          <StatTile
            label={`הקאמפ חייב ל־${dossier.displayName}`}
            valueAgorot={owedAgorot}
            tone="warn"
            derivation={
              <bdi>{`מתוך ${owedToThem.length} · ${owedToThem.filter((row) => row.settled).length} קוזזו`}</bdi>
            }
            href={tabHref('debts')}
          />
        )}

        {accounts.length === 0 ? null : (
          <StatTile
            label="מחזיק/ה קופה"
            valueAgorot={accounts.reduce((total, account) => total + account.balanceAgorot, 0)}
            tone={accounts.some((account) => account.kind === 'personal') ? 'warn' : 'default'}
            derivation={
              <>
                <bdi>{accounts.map((account) => account.name).join(' · ')}</bdi>
                {accounts.some((account) => account.kind === 'personal') ? (
                  <span className={styles.warnLine}>חשבון פרטי עם כסף של הקאמפ</span>
                ) : null}
              </>
            }
            href="/money"
          />
        )}

        <StatTile
          label={scope === null ? 'משימות' : `משימות ב${scope.name}`}
          value={<bdi>{scopeTasks.length}</bdi>}
          derivation={scopeTasks.length === 0
            ? 'אין משימות משויכות'
            : scopeTasks.slice(0, 2).map((task) => task.title).join(' · ')}
          href={tabHref('tasks')}
        />
      </div>

      {/* Links, never buttons: a tab a lead can send to someone is worth more
          than one that exists in a single browser tab (R6). */}
      <div className={styles.tabs} role="tablist" aria-label="חלקי הרשומה">
        {TABS.map((each) => (
          <Link
            key={each}
            className={each === tab ? styles.tabCurrent : styles.tab}
            href={tabHref(each)}
            role="tab"
            aria-selected={each === tab}
          >
            {TAB_LABELS[each]}
            {counts[each] === undefined ? null : (
              <span className={styles.tabCount}><bdi>{counts[each]}</bdi></span>
            )}
          </Link>
        ))}
      </div>

      <div className={styles.body}>
        <section className={styles.main}>
          {tab === 'overview' ? (
            <>
              <div className={styles.block}>
                <h2>השנים בקאמפ</h2>
                {/*
                  One row per season the person was on, with that season's due
                  beside the membership — the mock's seasons table. A season
                  with no due says so in words: `לא הונפק חיוב` is a fact about
                  the camp's bookkeeping, where a blank cell would read as a
                  missing number.
                */}
                <Table
                  caption="השנים בקאמפ"
                  columns={seasonColumns}
                  rows={seasonRows.map((row) => ({ id: row.seasonId, data: row }))}
                  empty={<EmptyState kind="nothing-yet" noun="שנים" />}
                  density="compact"
                />
              </div>
              <div className={styles.block}>
                <h2>שיוך לשנה</h2>
                <AddToSeason
                  personId={dossier.personId}
                  seasons={seasons.map((season) => ({ id: season.id, name: season.name }))}
                  memberSeasonIds={dossier.seasons.map((season) => season.seasonId)}
                />
              </div>
            </>
          ) : null}

          {tab === 'payments' ? (
            <div className={styles.block}>
              <div className={styles.blockHead}>
                <h2>תשלומים שנרשמו</h2>
                {scope === null || !onScopeSeason ? null : (
                  <ButtonLink size="sm" href={`/fees?season=${scope.id}&peek=${dossier.personId}&act=pay`}>
                    <Icon name="receipt" size={14} /> רישום תשלום
                  </ButtonLink>
                )}
              </div>
              <Table
                caption="תשלומים שנרשמו"
                columns={paymentColumns}
                rows={paymentRows.map((row) => ({ id: row.id, data: row }))}
                empty={<EmptyState kind="nothing-yet" noun="תשלומים" />}
                density="compact"
              />
            </div>
          ) : null}

          {tab === 'tasks' ? (
            <div className={styles.block}>
              <div className={styles.blockHead}>
                <h2>משימות</h2>
                {scope === null ? null : (
                  <ButtonLink size="sm" href={`/tasks?season=${scope.id}`}>
                    <Icon name="tasks" size={14} /> ללוח המשימות
                  </ButtonLink>
                )}
              </div>
              <Table
                caption="משימות"
                columns={taskColumns}
                rows={dossier.responsibilities.map((row) => ({ id: row.taskId, data: row }))}
                empty={<EmptyState kind="nothing-yet" noun="משימות" />}
                density="compact"
              />
            </div>
          ) : null}

          {tab === 'debts' ? (
            <div className={styles.block}>
              <div className={styles.blockHead}>
                <h2>מה הקאמפ חייב</h2>
                <ButtonLink size="sm" href="/money/debts">
                  <Icon name="scale" size={14} /> לכל החובות
                </ButtonLink>
              </div>
              <Table
                caption="מה הקאמפ חייב"
                columns={debtColumns}
                rows={owedToThem.map((row) => ({ id: row.id, data: row }))}
                empty={<EmptyState kind="all-clear" />}
                density="compact"
              />
            </div>
          ) : null}

          {tab === 'aliases' ? (
            <div className={styles.block}>
              <h2>כינויים</h2>
              <p className="muted">כל האיותים שהופיעו בקבצים, מקושרים לאדם אחד. קישור אפשר לבטל; מיזוג לא.</p>
              <ul className={styles.aliasList}>
                {aliasSources.map((alias) => (
                  <li key={alias.aliasId} className={styles.aliasRow}>
                    <span className={styles.aliasName}><bdi>{alias.alias}</bdi></span>
                    <AliasSourceMark alias={alias} />
                    {alias.confirmedBy === null ? null : (
                      <span className="muted">אושר ע״י <bdi>{alias.confirmedBy}</bdi></span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {tab === 'history' ? (
            <div className={styles.block}>
              <h2>היסטוריית שינויים</h2>
              {log.length === 0 ? (
                <EmptyState kind="nothing-yet" noun="שינויים" />
              ) : (
                <>
                  <ul className={styles.logList}>
                    {dated.map((entry, index) => (
                      <li key={`d-${index}`}>
                        {changeSentence(entry)}
                        <span className="muted"> · <DateText at={entry.at!} /></span>
                        {entry.by === null ? null : <span className="muted"> · <bdi>{entry.by}</bdi></span>}
                      </li>
                    ))}
                  </ul>
                  {undated.length === 0 ? null : (
                    <>
                      {/* The same group the side panel draws, for the same
                          reason: an undated entry placed in a chronology is
                          a guessed date. */}
                      <h3 className={styles.undatedHead}>ללא תאריך</h3>
                      <ul className={styles.logList}>
                        {undated.map((entry, index) => (
                          <li key={`u-${index}`}>
                            {changeSentence(entry)}
                            {entry.by === null ? null : <span className="muted"> · <bdi>{entry.by}</bdi></span>}
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </>
              )}
            </div>
          ) : null}
        </section>

        {/* Always present, on every tab: this is the identity of the record,
            not a section of it. */}
        <aside className={styles.side} role="complementary" aria-label="פרטי הרשומה">
          <section>
            <h2>פרטים</h2>
            <dl className={styles.facts}>
              <dt>תפקיד</dt>
              <dd>{role === null ? <span className="muted">—</span> : roleLabel(role)}</dd>
              <dt>שנים</dt>
              <dd>
                {dossier.seasons.length === 0
                  ? <span className="muted">לא שויך/ה לאף שנה</span>
                  : <bdi>{dossier.seasons.map((season) => season.seasonName).join(' · ')}</bdi>}
              </dd>
              <dt>מחזיק/ה קופה</dt>
              <dd>
                {accounts.length === 0
                  ? <span className="muted">לא</span>
                  : <bdi>{accounts.map((account) => account.name).join(' · ')}</bdi>}
              </dd>
              <dt>הערות</dt>
              <dd>{dossier.notes === null || dossier.notes === ''
                ? <span className="muted">—</span>
                : dossier.notes}</dd>
            </dl>
          </section>

          <section>
            <h2>כינויים ומקורות</h2>
            <ul className={styles.aliasList}>
              {aliasSources.map((alias) => (
                <li key={alias.aliasId} className={styles.aliasRow}>
                  <span className={styles.aliasName}><bdi>{alias.alias}</bdi></span>
                  <AliasSourceMark alias={alias} />
                  {canUnlink ? (
                    <Link className={styles.aliasUnlink} href={unlinkHref(alias.aliasId)}>
                      ביטול הקישור
                    </Link>
                  ) : (
                    <span className={styles.aliasLocked}>
                      הכינוי היחיד — בלעדיו אי אפשר יהיה לזהות את האדם בקבצים.
                    </span>
                  )}
                  {alias.mergedFromPersonId === null ? null : (
                    <span className={styles.mergedNote}>הכינוי הזה הגיע ממיזוג.</span>
                  )}
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h2>היסטוריית שינויים</h2>
            {log.length === 0 ? (
              <p className="muted">עדיין לא נרשם דבר.</p>
            ) : (
              <>
                <ul className={styles.logList}>
                  {dated.map((entry, index) => (
                    <li key={`sd-${index}`}>
                      <span>{changeSentence(entry)}</span>
                      <span className="muted"> · <DateText at={entry.at!} /></span>
                      {/* `memberships` records when somebody joined and never
                          who added them, so this entry names no actor rather
                          than guessing one. */}
                      {entry.by === null ? null : (
                        <span className="muted"> · <bdi>{entry.by}</bdi></span>
                      )}
                    </li>
                  ))}
                </ul>
                {undated.length === 0 ? null : (
                  <>
                    {/* `dues` records who decided an exception and never when.
                        Its own group, because putting an entry at an assumed
                        position in a chronology is the same lie as giving it
                        a date. */}
                    <h3 className={styles.undatedHead}>ללא תאריך</h3>
                    <ul className={styles.logList}>
                      {undated.map((entry, index) => (
                        <li key={`su-${index}`}>
                          <span>{changeSentence(entry)}</span>
                          {entry.by === null ? null : (
                            <span className="muted"> · <bdi>{entry.by}</bdi></span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </>
            )}
          </section>
        </aside>
      </div>

      {unlinking === null ? null : (
        <ConfirmDialog
          title="ביטול קישור הכינוי"
          consequence={
            <>
              הכינוי <bdi>{unlinking.alias}</bdi> יחזור לרשימת השמות שממתינים לשיוך.
              {unlinking.mergedFromPersonId === null ? null : ' הכינוי הזה הגיע ממיזוג.'}
            </>
          }
          confirmLabel="ביטול הקישור"
          cancelHref={tabHref(tab)}
          action={unlinkAliasAndReturn.bind(null, unlinkingId, tabHref(tab))}
        />
      )}
    </main>
  );
}

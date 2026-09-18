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
import { listPayments } from '@/lib/fees/payments';
import { roleLabel, dueKindLabel } from '@/lib/members/labels';
import { mergeHref, type RawParams } from '@/lib/members/people-views';
import type { Responsibility } from '@/lib/work/coverage';
import { Avatar } from '@/components/ui/avatar';
import { Pill } from '@/components/ui/pill';
import { Popover } from '@/components/ui/popover';
import { StatTile } from '@/components/ui/stat-tile';
import { SourceChip } from '@/components/ui/source-chip';
import { EmptyState } from '@/components/ui/empty-state';
import { Icon } from '@/components/ui/icon';
import { Money, DateText } from '@/components/format';
import { formatShekels } from '@/lib/money';
import { AddToSeason } from '../add-member';
import styles from './person.module.css';

export const dynamic = 'force-dynamic';

const KIND_LABELS: Record<string, string> = {
  deliverable: 'אחריות תקציבית',
  shift: 'משמרת',
  build: 'הקמה ולוגיסטיקה',
  event_task: 'משימה באירוע',
};

/** he-IL, date and time together — a shift's "when" is never just a day. */
function formatDateTime(date: Date): string {
  return date.toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' });
}

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
  const scopePayments = scopeDue === null ? [] : await listPayments(db, scopeDue.dueId);
  const lastPayment = scopePayments.at(-1) ?? null;

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

  const counts: Record<PersonTab, number | undefined> = {
    overview: undefined,
    payments: dossier.dues.length,
    tasks: dossier.responsibilities.length,
    debts: owedToThem.length,
    aliases: aliasSources.length,
    history: log.length,
  };

  return (
    <main className={styles.page}>
      <header className={styles.head}>
        <Avatar name={dossier.displayName} size="lg" />
        <div className={styles.headText}>
          <h1>{dossier.displayName}</h1>
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
              {lastPayment === null ? ' · טרם נרשם תשלום' : ` · ${formatDateTime(lastPayment.paidOn)}`}
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
              <h2>שנים</h2>
              {dossier.seasons.length === 0 ? (
                <EmptyState kind="nothing-yet" noun="שנים" />
              ) : (
                <ul className={styles.plainList}>
                  {dossier.seasons.map((season) => (
                    <li key={season.seasonId}>
                      {season.seasonName}
                      <span className="muted"> — {roleLabel(season.role)}</span>
                    </li>
                  ))}
                </ul>
              )}
              <AddToSeason
                personId={dossier.personId}
                seasons={seasons.map((season) => ({ id: season.id, name: season.name }))}
                memberSeasonIds={dossier.seasons.map((season) => season.seasonId)}
              />
            </>
          ) : null}

          {tab === 'payments' ? (
            <>
              <h2>דמי קאמפ</h2>
              {dossier.dues.length === 0 ? (
                <EmptyState kind="nothing-yet" noun="חיובים" />
              ) : (
                <ul className={styles.plainList}>
                  {dossier.dues.map((row) => (
                    <li key={row.dueId}>
                      <bdi>{`${row.seasonName} · ${formatShekels(row.amountAgorot)} · שולם ${formatShekels(row.paidAgorot)} · יתרה ${formatShekels(row.outstandingAgorot)}`}</bdi>
                      {row.kind === 'exception' ? (
                        <span className="muted">
                          {` — ${dueKindLabel(row.kind)}: ${row.exceptionReason ?? ''}`}
                          {row.decidedBy === null ? null : <> — אושר ע״י <bdi>{row.decidedBy}</bdi></>}
                        </span>
                      ) : (
                        <span className="muted"> — {dueKindLabel(row.kind)}</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : null}

          {tab === 'tasks' ? (
            <>
              <h2>משימות</h2>
              {dossier.responsibilities.length === 0 ? (
                <EmptyState kind="nothing-yet" noun="משימות" />
              ) : (
                <ul className={styles.plainList}>
                  {dossier.responsibilities.map((item) => (
                    <li key={item.taskId}>
                      {item.title}
                      <span className="muted">
                        {' — '}{KIND_LABELS[item.kind] ?? item.kind}, {item.seasonName}
                        {item.eventName && <>, {item.eventName}</>}
                        {item.budgetAgorot !== null && (
                          <> — תקציב <Money agorot={item.budgetAgorot} /></>
                        )}
                        {timingParts(item).map((part) => (
                          <span key={part.label}>
                            {' — '}{part.label} <bdi>{part.value}</bdi>
                          </span>
                        ))}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : null}

          {tab === 'debts' ? (
            <>
              <h2>מה הקאמפ חייב</h2>
              {owedToThem.length === 0 ? (
                <EmptyState kind="all-clear" />
              ) : (
                <ul className={styles.plainList}>
                  {owedToThem.map((row) => (
                    <li key={row.id}>
                      {row.description}
                      <span className="muted">
                        {' — '}<bdi>{`${formatShekels(row.outstandingAgorot)} מתוך ${formatShekels(row.amountAgorot)}`}</bdi>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : null}

          {tab === 'aliases' ? (
            <>
              <h2>כינויים</h2>
              <p className="muted">כל האיותים שהופיעו בקבצים, מקושרים לאדם אחד.</p>
              <ul className={styles.plainList}>
                {aliasSources.map((alias) => (
                  <li key={alias.aliasId}>
                    <bdi>{alias.alias}</bdi>
                    {alias.confirmedBy === null ? null : (
                      <span className="muted"> — אושר ע״י <bdi>{alias.confirmedBy}</bdi></span>
                    )}
                  </li>
                ))}
              </ul>
            </>
          ) : null}

          {tab === 'history' ? (
            <>
              <h2>היסטוריית שינויים</h2>
              {log.length === 0 ? (
                <EmptyState kind="nothing-yet" noun="שינויים" />
              ) : (
                <ul className={styles.plainList}>
                  {dated.map((entry, index) => (
                    <li key={`d-${index}`}>
                      {changeSentence(entry)}
                      <span className="muted"> · <DateText at={entry.at!} /></span>
                      {entry.by === null ? null : <span className="muted"> · <bdi>{entry.by}</bdi></span>}
                    </li>
                  ))}
                </ul>
              )}
            </>
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
    </main>
  );
}

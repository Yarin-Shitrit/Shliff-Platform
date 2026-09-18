import type { AnyDb } from '@/lib/db-types';
import {
  worklist, collisionGroups, sheetsNeedingSeason, flaggedArithmetic,
  type CollisionGroup,
} from '@/lib/data/worklist';
import { blockStates, type BlockStateRow } from '@/lib/import/register';
import { SEASON_REQUIRED_ARCHETYPES } from '@/lib/import/promote/promote';
import type { SheetRow } from '@/lib/import/sheets';
import type { Refusal, RefusalReason } from '@/lib/import/promote/types';
import { traceRow, type SourceCell } from '@/lib/money/trace';
import { unnamedObligations, type ObligationRow } from '@/lib/money/obligations';
import type { BudgetLineRow } from '@/lib/money/budget';
import { listUnlinkedNames } from '@/lib/members/identity';
import { suggestPeopleForName, type NameSuggestion } from '@/lib/members/suggest';
import { copyDiff, type CopyDiff } from '@/lib/data/evidence';
import { partyRowCounts } from './party-rows';

export type InboxKind =
  | 'unlinked-name'      // a name from a workbook nobody has attributed
  | 'sheet-season'       // a sheet with no season (W10, W11)
  | 'sheet-collision'    // two copies of one sheet, no authority chosen (W12, W13)
  | 'block-undecided'    // a block unconfirmed, or confirmed with no column map
  | 'unnamed-debt'       // an obligation with no party, which can never be settled
  | 'refused-row'        // a row the promoter refused on purpose
  | 'arithmetic-flag';   // quantity × unit ≠ total (W20)

export type InboxGroup = 'names' | 'sheets' | 'blocks' | 'debts' | 'refusals';

export type InboxActionKind =
  | 'link-name' | 'new-person' | 'search-person' | 'split-name' | 'ignore-name'
  | 'set-season' | 'set-authority' | 'confirm-block'
  | 'name-debt' | 'open-source' | 'snooze' | 'skip';

export interface InboxAction {
  kind: InboxActionKind;
  /** Hebrew, rendered verbatim on the control. */
  label: string;
  control: 'button' | 'select' | 'link';
  /** `Digit1`–`Digit5` (R10). Null on a select, and on anything past the
   *  fifth keyboard-reachable action. */
  digit: 1 | 2 | 3 | 4 | 5 | null;
  /** For `control: 'link'`. */
  href: string | null;
  /** The one argument the server action takes beyond the item's own id. */
  arg: string | null;
  /** True when pressing it writes. R8 confirms first; E2 toasts after. */
  writes: boolean;
  /** True when the domain can reverse it, so the toast offers undo (E2). */
  undoable: boolean;
}

interface InboxItemBase {
  /** Stable across requests: `<kind-prefix>:<natural key>`. */
  id: string;
  kind: InboxKind;
  /** Hebrew, one line — the rail's first line. */
  title: string;
  /** Hebrew, one line — the rail's second line. */
  detail: string;
  /** The workbook cell this decision is about. Null when it has no single
   *  cell: a whole sheet, or a name queued by hand. */
  source: SourceCell | null;
  /** Ruling 1: the system is holding a fact back until a person decides.
   *  Drives the tab and the badge, and nothing else. */
  blocking: boolean;
  /** Set when a deferral is in force. The item is never blocking while it is. */
  snoozedUntil: Date | null;
  actions: InboxAction[];
}

export interface UnlinkedNameItem extends InboxItemBase {
  kind: 'unlinked-name';
  aliasId: string;
  alias: string;
  /** Promoted money rows still carrying this raw string — counted, never
   *  assumed. See `party-rows.ts`. */
  rowCount: number;
  suggestions: NameSuggestion[];
}

export interface SheetSeasonItem extends InboxItemBase {
  kind: 'sheet-season';
  sheet: SheetRow;
  /** Confirmed blocks on this sheet that are waiting. */
  waiting: Array<{ blockId: string; archetype: string; rows: number }>;
  /**
   * True when at least one confirmed block on this sheet belongs to an
   * archetype whose promoter refuses a season-less row outright. This, and
   * not the missing label itself, is what blocks promotion (Ruling 2).
   */
  refusesWithoutSeason: boolean;
}

export interface SheetCollisionItem extends InboxItemBase {
  kind: 'sheet-collision';
  group: CollisionGroup;
  diff: CopyDiff;
}

export interface BlockUndecidedItem extends InboxItemBase {
  kind: 'block-undecided';
  blockId: string;
  archetype: string;
  /** `גיליון2!A3:F44`. */
  range: string;
  rows: number;
  reason: 'unconfirmed' | 'unmapped-column';
}

export interface UnnamedDebtItem extends InboxItemBase {
  kind: 'unnamed-debt';
  obligation: ObligationRow;
}

export interface RefusedRowItem extends InboxItemBase {
  kind: 'refused-row';
  blockId: string;
  refusal: Refusal;
}

export interface ArithmeticFlagItem extends InboxItemBase {
  kind: 'arithmetic-flag';
  seasonName: string;
  line: BudgetLineRow;
}

export type InboxItem =
  | UnlinkedNameItem | SheetSeasonItem | SheetCollisionItem | BlockUndecidedItem
  | UnnamedDebtItem | RefusedRowItem | ArithmeticFlagItem;

export interface InboxInput {
  /** Deferrals in force, from the cookie. */
  snoozed: ReadonlyMap<string, Date>;
  now: Date;
  /** Stamped onto the dry runs `worklist` performs. */
  recordedBy: string;
  /** The sidebar's season (R5), used only to explain a name candidate. The
   *  register itself is camp-wide (Ruling 7). */
  seasonId?: string | null;
  /**
   * Whether to include `refused-row` items, which are the only kind that
   * needs `worklist` — and `worklist` dry-runs every confirmed block.
   *
   * Default false, and the default is the safe one on purpose. The shell's
   * badge and the home page's preview call `loadInboxItems` on every request;
   * running the promoter, even dry, on every page load in the app is the
   * hazard integration A32 names, arriving through a different door. No
   * refused row is ever blocking (Ruling 3), so the open-decision count is
   * identical either way — pinned by a test, because that equality is the
   * whole reason this is safe to skip.
   */
  includeRefusals?: boolean;
}

/** The rail's segmented control (the mock's הכול · שמות · גיליונות · טבלאות · חובות). */
const GROUPS: Record<InboxKind, InboxGroup> = {
  'unlinked-name': 'names',
  'sheet-season': 'sheets',
  'sheet-collision': 'sheets',
  'block-undecided': 'blocks',
  'unnamed-debt': 'debts',
  'refused-row': 'refusals',
  'arithmetic-flag': 'refusals',
};

export function groupOf(item: InboxItem): InboxGroup {
  return GROUPS[item.kind];
}

/**
 * Ruling 1. The tab is derived, never stored, so the badge and the tab strip
 * cannot drift apart.
 */
export function tabOf(item: InboxItem): 'decide' | 'notice' {
  return item.blocking ? 'decide' : 'notice';
}

/**
 * B2. Only blocking items are counted, so the badge never cries wolf: a
 * refused סה״כ row and a budget line whose arithmetic does not add up are
 * both true and neither is a decision, and a badge that counted them would
 * read 40 on a camp with nothing to do.
 */
export function openDecisionCount(items: readonly InboxItem[]): number {
  return items.filter((item) => item.blocking).length;
}

/**
 * Ruling 2. Narrower than `blocking` on purpose.
 *
 * Bulk promotion waits on the three decisions `promoteAll` itself refuses or
 * skips over. It does not wait on unlinked names or nameless debts, because
 * those are *produced by* promotion: gating on them deadlocks, since the only
 * way to clear the name queue is to promote, and a new upload could never be
 * promoted while one name sat in it.
 *
 * **This predicate is not a safety control, and integration A23 is why.** It
 * answers "is anyone still deciding", which is a different question from
 * "would doing this again duplicate rows". A block can be confirmed, eligible
 * and entirely undisputed while a re-import has shifted a `source_row`
 * underneath it — and then the promoter's sweep keeps the referenced old rows
 * and writes the new ones beside them. No screen may offer bulk promotion on
 * the strength of this returning false.
 */
export function blocksPromotion(item: InboxItem): boolean {
  switch (item.kind) {
    case 'sheet-collision':
    case 'block-undecided':
      return true;
    case 'sheet-season':
      return item.refusesWithoutSeason;
    default:
      return false;
  }
}

/**
 * Ruling 5: digits are handed out once, at the end, over the finished list.
 *
 * `skip` is excluded along with every `select`, and the ruling's own wording
 * ("the first five actions whose control is not select") does not say so —
 * but its test does, and the test is right. Under the literal rule `skip`
 * takes digit 4 on a collision, which offers three actions, and no digit on
 * an unlinked name, which offers seven. A key that means "dismiss this" on
 * one item and "choose the second copy of the sheet" on the next is worse
 * than no key: the digits exist to be learned, and Task 2's cap of three
 * candidates was chosen to keep exactly this map stable.
 */
function withDigits(actions: Omit<InboxAction, 'digit'>[]): InboxAction[] {
  let next = 1;
  return actions.map((action) => {
    if (action.control === 'select' || action.kind === 'skip' || next > 5) {
      return { ...action, digit: null };
    }
    const digit = next as 1 | 2 | 3 | 4 | 5;
    next += 1;
    return { ...action, digit };
  });
}

/**
 * The block states a lead can act on *from this screen*, named positively.
 *
 * An allow-list rather than a skip-list, and that direction is the point.
 * `superseded` and `blocked` are the states of a block whose sheet is
 * contested, and that sheet's own collision item already carries the
 * decision — emitting both is Ruling 4's duplicate in a different costume.
 * `sheetEligibility` gives a non-eligible state only to a sheet that has a
 * contest, so nothing is hidden.
 *
 * **The enum is not closed, which is why this is written this way.** A
 * `retired` state is coming for the sheets the camp lead has chosen to close
 * rather than backfill, and a skip-list would greet it by manufacturing a
 * decision — "confirm this table" on a sheet somebody deliberately retired,
 * which is the 96 unresolvable rail items returning through a different
 * door. An unrecognised state produces no decision here. It should not
 * produce silence either: a retired block belongs in לידיעה with an undo,
 * and that item cannot be built until the state exists on this branch.
 */
const DECIDABLE_BLOCK_STATES: ReadonlySet<string> = new Set([
  'needs-review', 'recognised', 'confirmed',
]);

/** Ruling 4: reasons another item kind already carries, and blank rows. */
const CARRIED_ELSEWHERE: ReadonlySet<RefusalReason> = new Set<RefusalReason>([
  'no-season', 'sheet-undecided', 'sheet-ambiguous', 'sheet-superseded',
  'unconfirmed', 'unmapped-column', 'blank-row',
]);

const SKIP: Omit<InboxAction, 'digit'> = {
  kind: 'skip', label: 'דילוג', control: 'button',
  href: null, arg: null, writes: false, undoable: false,
};

function snoozeAction(itemId: string): Omit<InboxAction, 'digit'> {
  return {
    kind: 'snooze', label: 'דחייה לשבוע', control: 'button',
    href: null, arg: itemId, writes: true, undoable: true,
  };
}

function formatDate(date: Date): string {
  const dd = String(date.getUTCDate()).padStart(2, '0');
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const yy = String(date.getUTCFullYear()).slice(-2);
  return `${dd}/${mm}/${yy}`;   // A12: slashes in tables and chips
}

/**
 * Everything the system could not settle, in one list.
 *
 * Block state comes from `src/lib/import/register.ts` and from nowhere else
 * (I13, as narrowed by A32): exactly one projection answers "what state is
 * this block in", plan 11 owns it, and this module reads it rather than
 * deriving a second opinion that could report a different number in the rail
 * than the file list reports on the same block.
 *
 * `worklist` is consulted only for refused rows, and only when asked — it is
 * the sole source of a per-row `Refusal`, and it obtains them by dry-running
 * the promoter. Nothing here ever calls `promoteBlock`, and nothing here ever
 * passes `dryRun: false` anywhere.
 */
export async function inboxItems(db: AnyDb, input: InboxInput): Promise<InboxItem[]> {
  const { snoozed, recordedBy } = input;
  const seasonId = input.seasonId ?? null;
  const includeRefusals = input.includeRefusals ?? false;

  const [blocks, collisions, seasonless, flags, debts, names] = await Promise.all([
    blockStates(db),
    collisionGroups(db),
    sheetsNeedingSeason(db),
    flaggedArithmetic(db),
    unnamedObligations(db),
    listUnlinkedNames(db),
  ]);

  const items: InboxItem[] = [];

  /** Applies Ruling 2 of this task: a deferral removes the block, not the item. */
  const settle = <T extends InboxItem>(item: T): T => {
    const until = snoozed.get(item.id) ?? null;
    if (until === null) return item;
    return {
      ...item,
      snoozedUntil: until,
      blocking: false,
      detail: `${item.detail} · נדחה על ידך עד ${formatDate(until)}`,
    };
  };

  // --- names -------------------------------------------------------------
  const rowsByAlias = await partyRowCounts(db, names.map((name) => name.alias));

  for (const name of names) {
    const id = `name:${name.aliasId}`;
    const suggestions = await suggestPeopleForName(db, name.alias, { seasonId });
    const top = suggestions[0] ?? null;
    const detail = top
      ? `שם מקובץ · הצעה: ${top.displayName} (${top.confidence})`
      : 'שם מקובץ · אין הצעה';

    items.push(settle<UnlinkedNameItem>({
      id, kind: 'unlinked-name', title: `״${name.alias}״`, detail,
      source: null, blocking: true, snoozedUntil: null,
      aliasId: name.aliasId, alias: name.alias,
      rowCount: rowsByAlias.get(name.alias) ?? 0, suggestions,
      actions: withDigits([
        ...suggestions.map((s) => ({
          kind: 'link-name' as const, label: `קישור ל${s.displayName}`,
          control: 'button' as const, href: null, arg: s.personId,
          writes: true, undoable: true,
        })),
        { kind: 'new-person', label: 'יצירת אדם חדש', control: 'button', href: null, arg: null, writes: true, undoable: false },
        { kind: 'ignore-name', label: 'לא אדם — התעלמות', control: 'button', href: null, arg: null, writes: true, undoable: true },
        snoozeAction(id),
        { kind: 'search-person', label: 'חיפוש אדם אחר', control: 'button', href: null, arg: null, writes: false, undoable: false },
        { kind: 'split-name', label: 'פיצול לשני שמות', control: 'button', href: null, arg: null, writes: true, undoable: false },
        SKIP,
      ]),
    }));
  }

  // --- sheets with no season --------------------------------------------
  const bySheet = new Map<string, BlockStateRow[]>();
  for (const block of blocks) {
    const list = bySheet.get(block.sheetId) ?? [];
    list.push(block);
    bySheet.set(block.sheetId, list);
  }

  for (const sheet of seasonless) {
    const id = `sheet-season:${sheet.id}`;
    const onSheet = bySheet.get(sheet.id) ?? [];
    // Read off the promoter's own export, not from a dry run and not from a
    // second list kept here: `budgetRow` and `ticketRow` refuse a season-less
    // row before looking at a cell, and `promote.ts` exports that set
    // precisely so a screen can say "this cannot write anything yet" without
    // running anything. An unconfirmed block is not counted — it would refuse
    // for being unconfirmed first, and `block-undecided` carries that.
    const refuses = onSheet.some((block) => (
      block.confirmedAt !== null
      && SEASON_REQUIRED_ARCHETYPES.includes(block.archetype)
    ));
    const waiting = onSheet.map((block) => ({
      blockId: block.blockId, archetype: block.archetype, rows: block.promotedRows,
    }));
    const pending = waiting.reduce((sum, w) => sum + w.rows, 0);

    items.push(settle<SheetSeasonItem>({
      id, kind: 'sheet-season',
      title: `לגיליון ״${sheet.name}״ אין שנה`,
      detail: refuses
        ? 'לגיליון לא נקבעה עונה, ותקציב חייב עונה'
        : `${pending} שורות נכתבו בלי שיוך לעונה`,
      source: null, blocking: true, snoozedUntil: null,
      sheet, waiting, refusesWithoutSeason: refuses,
      actions: withDigits([
        { kind: 'set-season', label: 'בחירת עונה', control: 'select', href: null, arg: sheet.id, writes: true, undoable: true },
        snoozeAction(id),
        SKIP,
      ]),
    }));
  }

  // --- collisions --------------------------------------------------------
  for (const group of collisions) {
    const seasonKey = group.sheets[0]?.seasonId ?? 'none';
    const id = `collision:${group.name}:${seasonKey}`;
    const diff = await copyDiff(db, group.sheets.map((s) => s.id));

    const detail = group.state === 'ambiguous'
      ? 'יותר מעותק אחד של הגיליון הזה סומן כנכון'
      : diff.ok
        ? `${diff.differing} שורות שונות · חוסם קידום`
        : diff.reason;

    items.push(settle<SheetCollisionItem>({
      id, kind: 'sheet-collision',
      title: `שני עותקים של ״${group.name}״`,
      detail, source: null, blocking: true, snoozedUntil: null,
      group, diff,
      actions: withDigits([
        ...group.sheets.map((s) => ({
          kind: 'set-authority' as const,
          label: `בחירת ${s.filename} כמוסמך`,
          control: 'button' as const, href: null, arg: s.id,
          writes: true, undoable: true,
        })),
        snoozeAction(id),
        SKIP,
      ]),
    }));
  }

  // --- blocks ------------------------------------------------------------
  for (const block of blocks) {
    if (!DECIDABLE_BLOCK_STATES.has(block.state)) continue;

    const unconfirmed = block.confirmedAt === null;
    const unmapped = !unconfirmed && block.columnMap.length === 0;
    if (!unconfirmed && !unmapped) continue;

    const id = `block:${block.blockId}`;
    const range = `${block.sheetName}!${block.range}`;
    items.push(settle<BlockUndecidedItem>({
      id, kind: 'block-undecided',
      title: unmapped
        ? `לטבלה אין שיוך עמודות — ${block.sheetName}`
        : `״${block.sheetName}״ — אישור סיווג`,
      detail: `${range} · ${block.rowCount} שורות`,
      source: null, blocking: true, snoozedUntil: null,
      blockId: block.blockId, archetype: block.archetype, range, rows: block.rowCount,
      reason: unmapped ? 'unmapped-column' : 'unconfirmed',
      actions: withDigits([
        {
          kind: 'confirm-block', label: 'פתיחת הטבלה לאישור', control: 'link',
          href: `/imports/${block.uploadId}#block-${block.blockId}`, arg: block.blockId,
          writes: false, undoable: false,
        },
        snoozeAction(id),
        SKIP,
      ]),
    }));
  }

  // --- nameless debts ----------------------------------------------------
  for (const debt of debts) {
    const id = `debt:${debt.id}`;
    const source = debt.sourceBlockId && debt.sourceRow !== null
      ? await traceRow(db, 'obligations', debt.id)
      : null;

    // Ruling 6: no snooze, no ignore. D8 — a nameless debt cannot be settled
    // and cannot be dismissed, and a deferral is a dismissal with a timer.
    items.push({
      id, kind: 'unnamed-debt',
      title: `חוב בלי שם — ${debt.description}`,
      detail: 'אי אפשר לסגור עד שיירשם למי',
      source, blocking: true, snoozedUntil: null,
      obligation: debt,
      actions: withDigits([
        { kind: 'name-debt', label: 'רישום למי החוב', control: 'link', href: `/money/debts?peek=${debt.id}`, arg: debt.id, writes: false, undoable: false },
        { kind: 'open-source', label: 'פתיחת התא בקובץ', control: 'link', href: source ? `/imports/${source.sheetId}#row-${source.sheetRow}` : '/imports', arg: null, writes: false, undoable: false },
      ]),
    });
  }

  // --- refused rows ------------------------------------------------------
  if (includeRefusals) {
    for (const row of await worklist(db, recordedBy)) {
      for (const refusal of row.refusals) {
        if (CARRIED_ELSEWHERE.has(refusal.reason)) continue;
        const id = `refusal:${row.blockId}:${refusal.sheetRow}:${refusal.reason}`;
        items.push({
          id, kind: 'refused-row',
          title: `${row.sheetName}!${refusal.sheetRow}`,
          detail: refusal.message,
          source: null, blocking: false, snoozedUntil: null,
          blockId: row.blockId, refusal,
          actions: withDigits([
            { kind: 'open-source', label: 'פתיחת השורה בקובץ', control: 'link', href: `/imports/${row.sheetId}#row-${refusal.sheetRow}`, arg: null, writes: false, undoable: false },
          ]),
        });
      }
    }
  }

  // --- arithmetic flags --------------------------------------------------
  for (const flag of flags) {
    items.push({
      id: `arith:${flag.line.id}`, kind: 'arithmetic-flag',
      title: flag.line.label,
      detail: `${flag.seasonName} · כמות × מחיר ליחידה אינו שווה לסה״כ`,
      source: null, blocking: false, snoozedUntil: null,
      seasonName: flag.seasonName, line: flag.line,
      actions: withDigits([
        { kind: 'open-source', label: 'פתיחת שורת התקציב', control: 'link', href: '/money', arg: null, writes: false, undoable: false },
      ]),
    });
  }

  // Decisions before information; within decisions, promotion blockers first.
  const rank = (item: InboxItem): number => {
    if (!item.blocking) return 2;
    return blocksPromotion(item) ? 0 : 1;
  };
  return items.sort((a, b) => rank(a) - rank(b));
}

/**
 * I2: the one entry point the shell's badge and the home page's preview call.
 *
 * `opts` is additive and exists for this screen alone — the two-argument form
 * integration I2 pins is exactly what the other consumers call, and it
 * deliberately runs no dry run. Snoozes live in a cookie under
 * `src/app/(admin)/inbox/`, which a library module must not reach into, so
 * the register passes its own map down.
 */
export async function loadInboxItems(
  db: AnyDb,
  seasonId: string | null,
  opts: Partial<Omit<InboxInput, 'seasonId'>> = {},
): Promise<InboxItem[]> {
  return inboxItems(db, {
    snoozed: opts.snoozed ?? new Map(),
    now: opts.now ?? new Date(),
    // Inert on a dry run — nothing is written — but the promoter's signature
    // requires it. Named so that a row carrying it would be obviously wrong.
    recordedBy: opts.recordedBy ?? 'inbox-dry-run',
    includeRefusals: opts.includeRefusals ?? false,
    seasonId,
  });
}

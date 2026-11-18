import { formatShekels } from '@/lib/money';
import { Icon } from '@/components/ui/icon';
import { StatTile } from '@/components/ui/stat-tile';
import type { SeasonOverview } from '@/lib/overview/summary';
import { ACCOUNT_FUNDS, ACCOUNT_FUND_NAMES } from '@/lib/money/labels';
import styles from './home.module.css';

/**
 * A proportion as a length, 0–100.
 *
 * Lives here rather than in the domain types on purpose: a percentage is a
 * presentation of two numbers the figure already carries, and storing it would
 * give two screens two chances to round it differently.
 *
 * It clamps even though `StatTile` clamps the bar it draws, because the bar's
 * accessible name is built from this number too — and a tile that draws a full
 * track while announcing "נגבו 110 אחוזים" is worse than either error alone.
 */
export function percent(part: number, whole: number): number {
  if (whole <= 0) return 0;
  return Math.min(100, Math.round((part / whole) * 100));
}

/**
 * The gold line under a tile.
 *
 * `StatTile` has no `warning` slot — the kit shipped five features and this is
 * the sixth — so it composes into the tile's `derivation` node. R3 is what
 * makes that safe rather than a fudge: the line carries a sentence and an
 * alert glyph, so it never reads as a colour alone. Reported as a kit gap
 * rather than worked around by re-implementing the tile here.
 */
function Warning({ children }: { children: string }) {
  return (
    <span className={styles.warning}>
      <Icon name="alert" size={14} />
      <bdi>{children}</bdi>
    </span>
  );
}

/**
 * The figures, and only the ones that have something to report. Cash is two
 * tiles — the camp's and the gift's — so there are up to five.
 *
 * Every tile is a link to the page that can change its number — that is the
 * whole argument for showing a figure on a landing page. Each nullable figure
 * carries the other half of the rule: `null` means "nothing to report", so a
 * card that would always read zero is never drawn.
 */
export function Figures({ overview }: { overview: SeasonOverview }) {
  const { seasonId, dues, cash, debts, coverage } = overview;

  const collectedPercent = dues === null
    ? 0
    : percent(dues.collectedAgorot, dues.expectedAgorot);
  const filledPercent = coverage === null
    ? 0
    : percent(coverage.placesFilled, coverage.placesNeeded);

  return (
    <div className={styles.figures}>
      {dues ? (
        <StatTile
          label="נגבה מדמי קאמפ"
          href={`/fees?season=${seasonId}`}
          valueAgorot={dues.collectedAgorot}
          bar={{
            segments: [{ id: 'collected', percent: collectedPercent, kind: 'dues' }],
            // Copied character for character from the page this replaces (E5).
            label: `נגבו ${collectedPercent} אחוזים מצפי הגבייה`,
          }}
          derivation={
            <>
              {/* A17: one isolate per phrase, each with a plain string inside,
                  so the whole sentence is what a test can query. */}
              <bdi>{`מתוך ${formatShekels(dues.expectedAgorot)}`}</bdi>
              {' · '}
              <bdi>{`${dues.unpaidCount} טרם שילמו`}</bdi>
              {dues.partlyPaidCount > 0 ? (
                <>{' · '}<bdi>{`${dues.partlyPaidCount} שילמו חלקית`}</bdi></>
              ) : null}
            </>
          }
        />
      ) : null}

      {/*
        * One tile per pot, never one over both. The camp's money and the
        * gift's are different money: summed, a pot that is overdrawn hides
        * behind the one that is not. The two warnings are about the cash as a
        * whole, so they are said once, under the first tile.
        */}
      {cash ? ACCOUNT_FUNDS.map((fund, index) => {
        const pot = cash.funds[fund];
        const overdrawn = pot.balanceAgorot < 0;
        const unplaced = cash.funds.unassigned.accountCount;
        return (
          <StatTile
            key={fund}
            label={`כסף ${ACCOUNT_FUND_NAMES[fund]}`}
            href={`/money?season=${seasonId}`}
            valueAgorot={pot.balanceAgorot}
            tone={overdrawn ? 'bad' : 'default'}
            derivation={
              <>
                <bdi>
                  {pot.accountCount === 0
                    ? 'אין עדיין חשבון'
                    : pot.accountCount === 1 ? 'בחשבון אחד' : `ב־${pot.accountCount} חשבונות`}
                </bdi>
                {/* R3: red is never the only carrier — the word says it too. */}
                {overdrawn ? <>{' · '}<bdi>במינוס</bdi></> : null}
                {index === 0 && unplaced > 0 ? (
                  <Warning>
                    {unplaced === 1
                      ? 'חשבון אחד עוד לא שויך לקאמפ או לגיפט'
                      : `${unplaced} חשבונות עוד לא שויכו לקאמפ או לגיפט`}
                  </Warning>
                ) : null}
                {index === 0 && cash.unattributedInAgorot > 0 ? (
                  <Warning>
                    {`${formatShekels(cash.unattributedInAgorot)} נרשמו בלי חשבון`}
                  </Warning>
                ) : null}
              </>
            }
          />
        );
      }) : null}

      {debts ? (
        /*
         * Links to /money, where both obligation tables still live. The
         * dedicated /money/debts screen exists now but carries one direction's
         * view; retarget when D8 owns both. A tile that linked somewhere its
         * own two numbers are not is the one thing this screen may never do,
         * which is hand a lead a figure and then somewhere it cannot be found.
         *
         * The two directions are never summed. What the camp owes and what is
         * owed to it are different facts about different people; one total
         * would be a number that is a quantity of nothing.
         */
        <StatTile
          label="חובות פתוחים"
          href={`/money?season=${seasonId}`}
          valueAgorot={debts.campOwesAgorot}
          derivation={
            <>
              <bdi>אנחנו חייבים</bdi>
              {' · '}
              <bdi>{`חייבים לנו ${formatShekels(debts.owedToCampAgorot)}`}</bdi>
              {debts.unnamedCount > 0 ? (
                <Warning>{`${debts.unnamedCount} חובות בלי שם`}</Warning>
              ) : null}
            </>
          }
        />
      ) : null}

      {coverage ? (
        <StatTile
          label="איוש משימות"
          href={`/tasks?season=${seasonId}`}
          value={
            <bdi>{`${coverage.placesFilled} מתוך ${coverage.placesNeeded} מקומות`}</bdi>
          }
          bar={{
            // `reserve`, never the brand accent (R3/A4): staffing is not a
            // brand state, and the accent may not colour a chart mark.
            segments: [{ id: 'filled', percent: filledPercent, kind: 'reserve' }],
            label: `${filledPercent} אחוזים מהמקומות מאוישים`,
          }}
          derivation={
            <bdi>
              {coverage.uncoveredTasks === 1
                ? 'משימה אחת עדיין חסרה אנשים'
                : `${coverage.uncoveredTasks} משימות עדיין חסרות אנשים`}
            </bdi>
          }
        />
      ) : null}
    </div>
  );
}

import type { AccountBalance } from '@/lib/money/accounts';
import { fundKeyOf } from '@/lib/money/funds';
import type { FundBalances, FundFlows, FundKey } from '@/lib/money/funds';
import {
  ACCOUNT_FUNDS, ACCOUNT_FUND_NAMES, ACCOUNT_FUND_PURPOSE, NO_FUND_GROUP_LABEL,
} from '@/lib/money/labels';
import { Money } from '@/components/format';
import { Banner } from '@/components/ui/banner';
import Link from 'next/link';
import { Pill } from '@/components/ui/pill';
import { AccountCard } from './account-card';
import { moneyHref } from './href';
import styles from './money.module.css';

/**
 * Where the money is, one band per pot.
 *
 * The camp keeps two pots that never mix: dues pay for the camp, and the
 * parties raise money for the gift. So the overview never shows one balance
 * over every account — a pot that is overdrawn would hide behind one that is
 * not. Each band carries its own figure, and that figure is the sum of the
 * cards drawn under it (`fundBalances`), so the two cannot disagree.
 *
 * Both pots are always drawn, with or without accounts: a pot with no account
 * is an invitation to make one, not a band to leave out. Accounts nobody has
 * placed get a band of their own and a banner above everything, because their
 * money is in neither figure until a lead says whose it is.
 *
 * The season's in and out sit beside the balance and are labelled with the
 * season, because they are a different kind of number: a balance is camp-wide
 * and current, while "what came in" is this year's.
 */
export function FundSections({ accounts, funds, flows, seasonId, seasonName }: {
  accounts: AccountBalance[];
  funds: FundBalances;
  flows: FundFlows;
  seasonId: string;
  seasonName: string;
}) {
  const unplaced = accounts.filter((row) => fundKeyOf(row.fund) === 'unassigned');

  const band = (key: FundKey, heading: string, note: string) => {
    const rows = accounts.filter((row) => fundKeyOf(row.fund) === key);
    const overdrawn = funds[key].balanceAgorot < 0;
    return (
      <div className={styles.fundGroup} key={key}>
        <div className={styles.fundHead}>
          <h3 className={styles.fundName}>{heading}</h3>
          <span className={`${styles.fundBalance} ${overdrawn ? styles.fundOverdrawn : ''}`}>
            <Money agorot={funds[key].balanceAgorot} />
          </span>
          {/* R3: red is never the only carrier — the word says it too. */}
          {overdrawn ? <Pill tone="bad">במינוס</Pill> : null}
          <span className={styles.fundFlow}>
            ב<bdi>{seasonName}</bdi>: נכנס <Money agorot={flows[key].inAgorot} />
            {' · '}יצא <Money agorot={flows[key].outAgorot} />
          </span>
        </div>
        <p className={styles.fundNote}>{note}</p>
        {rows.length === 0 ? (
          /* An invitation, kept to one line: the page's full empty state is
             for a camp with no accounts at all, and two of those stacked
             under the headings would bury the one pot that has money. */
          <p className={styles.fundEmpty}>
            עדיין אין חשבון של {heading}.{' '}
            <Link className="link" href={moneyHref({ season: seasonId, newAccount: true })}>
              חשבון חדש
            </Link>
          </p>
        ) : (
          <div className={styles.accountGrid}>
            {rows.map((row) => (
              <AccountCard
                key={row.accountId}
                account={row}
                countHref={moneyHref({ season: seasonId, count: row.accountId })}
                holderHref={moneyHref({ season: seasonId, holder: row.accountId })}
                fundHref={moneyHref({ season: seasonId, fund: row.accountId })}
                /* The heading above the cards already names the pot. */
                hideFund
              />
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className={styles.fundBands}>
      {unplaced.length === 0 ? null : (
        <Banner
          tone="warn"
          action={{
            href: moneyHref({ season: seasonId, fund: unplaced[0].accountId }),
            label: 'לקבוע של מי הכסף',
          }}
          headline={unplaced.length === 1
            ? 'חשבון אחד עוד לא שויך לקאמפ או לגיפט.'
            : <bdi>{unplaced.length} חשבונות עוד לא שויכו לקאמפ או לגיפט.</bdi>}
          detail="היתרה שלהם לא נספרת באף אחת משתי היתרות."
        />
      )}
      {ACCOUNT_FUNDS.map((fund) => (
        band(fund, ACCOUNT_FUND_NAMES[fund], `${ACCOUNT_FUND_PURPOSE[fund]}.`)
      ))}
      {unplaced.length === 0 ? null : band(
        'unassigned',
        NO_FUND_GROUP_LABEL,
        'החשבונות האלה לא נספרים ביתרת הקאמפ ולא ביתרת הגיפט, עד שייקבע של מי הכסף.',
      )}
    </div>
  );
}

import Link from 'next/link';
import type { AccountBalance } from '@/lib/money/accounts';
import type { AccountKind } from '@/db/schema/money';
import { DateText, Money } from '@/components/format';
import { Pill } from '@/components/ui/pill';
import { Icon, type IconName } from '@/components/ui/icon';
import styles from './money.module.css';

export const ACCOUNT_KIND_LABELS: Record<AccountKind, string> = {
  cash: 'מזומן',
  bank: 'בנק',
  personal: 'חשבון פרטי',
  event_float: 'קופת אירוע',
};

/** Every name here is checked against the frozen 65-glyph set in
 *  `src/components/ui/icon.tsx` (A16); none of the four is a substitution. */
const KIND_ICONS: Record<AccountKind, IconName> = {
  cash: 'cash', bank: 'bank', personal: 'user', event_float: 'party',
};

/**
 * One place money sits. The balance is derived — the counted balance plus
 * every movement in, minus every movement out, after the day of the count,
 * from both `ledger_entries` and `payments` (see `accountBalances` in
 * src/lib/money/accounts.ts). There is no stored balance anywhere in this
 * system and this card must never be given one: a stored copy is a second
 * truth that drifts.
 *
 * The count day is on the card because it is the figure's provenance: a
 * balance that says `נספר ב־30/10/2025` tells a lead which movements are
 * already inside it, the same way a cell reference says which sheet a number
 * came from. Without the date, a movement attributed and not moving the
 * balance reads as a bug.
 *
 * `עו״ש אופק` is a member's *personal* current account holding camp funds.
 * That is normal in this camp, and the warning belongs beside the account
 * rather than in a footnote under three cards — a reader who scrolled past
 * the footnote has read the balance without the sentence that qualifies it.
 *
 * The card's `--warn-line` border is never the only carrier of that meaning
 * (R3): the kind pill says `חשבון פרטי` and the sentence below says the rest.
 */
export function AccountCard({ account }: { account: AccountBalance }) {
  const personal = account.kind === 'personal';
  const holder = account.holderName ?? 'חבר מחנה';

  return (
    <div className={`card ${styles.accountCard} ${personal ? styles.accountPersonal : ''}`}>
      <span className={styles.accountHead}>
        <Icon name={KIND_ICONS[account.kind]} size={14} />
        <b className={styles.accountName}>{account.name}</b>
        <Pill tone={personal ? 'warn' : 'neutral'}>{ACCOUNT_KIND_LABELS[account.kind]}</Pill>
      </span>

      <span className={styles.accountBalance}>
        <Money agorot={account.balanceAgorot} />
      </span>

      {account.countedOn === null ? null : (
        <span className={styles.accountHolder}>
          נספר ב־<DateText at={account.countedOn} />, ומאז לפי התנועות
        </span>
      )}

      {personal ? (
        <span className={styles.accountWarning}>
          <Icon name="alert" size={14} />
          {' '}חשבון פרטי של{' '}
          {account.holderPersonId
            ? <Link className="link" href={`/members/${account.holderPersonId}`}>{holder}</Link>
            : holder}
          {' '}שמחזיק כסף של הקאמפ
        </span>
      ) : account.holderName ? (
        <span className={styles.accountHolder}>אצל <bdi>{account.holderName}</bdi></span>
      ) : null}
    </div>
  );
}

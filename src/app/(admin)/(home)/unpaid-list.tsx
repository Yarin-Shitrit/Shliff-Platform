import Link from 'next/link';
import { Icon } from '@/components/ui/icon';
import { Pill } from '@/components/ui/pill';
import { Avatar } from '@/components/ui/avatar';
import { ButtonLink } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Money } from '@/components/format';
import { formatShekels } from '@/lib/money';
import { openPeekHref } from '@/components/ui/drawer-url';
import type { DuesFigure } from '@/lib/overview/summary';
import styles from './home.module.css';

const SHOWN = 5;

/**
 * Who has not paid, by name.
 *
 * Returns nothing at all when no due has been issued: "הכול מטופל" over a
 * season nobody has billed congratulates the camp for work it has not started.
 * That case is `dues === null`, which the summary already distinguishes from
 * "billed, and everyone has paid".
 *
 * Every row is a link, never a button. Recording a payment is D5's action, and
 * `/fees` opens its payment drawer from `?peek=<personId>&act=pay` (I9) — built
 * with the kit's own helper rather than spelled here, so the link lands on a
 * drawer that exists, survives a refresh and can be sent to whoever is doing
 * the collecting.
 */
export function UnpaidList({ dues, seasonId, seasonName }: {
  dues: DuesFigure | null;
  seasonId: string;
  seasonName: string;
}) {
  if (!dues) return null;
  const shown = dues.unpaid.slice(0, SHOWN);
  const scope: Array<readonly [string, string]> = [['season', seasonId]];

  return (
    <section className={styles.panel}>
      <div className={styles.panelHead}>
        <Icon name="receipt" size={16} />
        <h2>טרם שילמו</h2>
        <bdi className={styles.scope}>{seasonName}</bdi>
        {dues.unpaidCount > 0 ? (
          <bdi><Pill>{String(dues.unpaidCount)}</Pill></bdi>
        ) : null}
        <Link className={styles.more} href={`/fees?season=${seasonId}`}>
          לדף דמי הקאמפ ←
        </Link>
      </div>

      {shown.length === 0 ? (
        <div className={styles.emptyBody}>
          <EmptyState kind="all-clear" />
        </div>
      ) : (
        <ul className={styles.rows}>
          {shown.map((member) => (
            <li key={member.dueId} className={styles.row}>
              <Avatar name={member.displayName} />
              <Link className={styles.rowName} href={`/members/${member.personId}`}>
                {member.displayName}
              </Link>
              {member.paidAgorot > 0 ? (
                /* Passive, and about the money rather than the person: the
                   database records no gender, and "שילמה" would be a guess
                   about somebody — the one guess this platform never makes. */
                <Pill tone="info">{`שולם ${formatShekels(member.paidAgorot)}`}</Pill>
              ) : member.kind === 'exception' ? (
                <Pill tone="brand">חריג</Pill>
              ) : (
                <span className={styles.rowDetail}>תעריף רגיל</span>
              )}
              <span className={styles.amount}>
                <Money agorot={member.outstandingAgorot} />
              </span>
              <ButtonLink
                size="sm"
                href={openPeekHref('/fees', scope, member.personId, 'pay')}
                iconLabel={`רישום תשלום ל${member.displayName}`}
              >
                <Icon name="plus" size={15} />
              </ButtonLink>
            </li>
          ))}
        </ul>
      )}

      {dues.missingDuesCount > 0 ? (
        <div className={styles.panelFoot}>
          {/* Said about the charge, not about the people, for the same reason
              the row above is passive. `/fees` states it this way already. */}
          <bdi>
            {dues.missingDuesCount === 1
              ? 'חיוב אחד עדיין לא הונפק'
              : `${dues.missingDuesCount} חיובים עדיין לא הונפקו`}
          </bdi>
          <Link className={styles.more} href={`/fees?season=${seasonId}`}>
            להנפקת חיוב
          </Link>
        </div>
      ) : null}
    </section>
  );
}

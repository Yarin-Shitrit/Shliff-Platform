'use client';

/**
 * The sentence at the head of a page an account may read and not change.
 * Drawn by the layout for every screen, so no page has to know it can be
 * opened read-only: the page's own controls still render, and the server
 * refuses what they send — this banner is what tells the reader why, before
 * they try. The page is found the way the rail marks it, by path prefix.
 */
import { usePathname } from 'next/navigation';
import { Banner } from '@/components/ui/banner';
import { NAV_ITEMS, activeItemId, pageOfItem } from './nav-data';
import { useAccess } from './access-context';
import styles from './view-only-banner.module.css';

export function ViewOnlyBanner() {
  const active = activeItemId(usePathname());
  const { levelOf } = useAccess();

  const item = NAV_ITEMS.find((candidate) => candidate.id === active);
  const page = item ? pageOfItem(item) : null;
  if (page === null || levelOf(page) !== 'view') return null;

  return (
    <div className={styles.notice}>
      <Banner
        tone="info"
        icon="eye"
        headline="צפייה בלבד."
        detail="אפשר לקרוא את העמוד הזה, אבל כל שינוי בו ייחסם. מי שצריך לערוך כאן — שיפנה לאחד מראשי הקאמפ."
        label="הרשאת צפייה בלבד"
      />
    </div>
  );
}

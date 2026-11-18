import Link from 'next/link';
import { currentUser } from '@/lib/auth/guard';
import { pageByKey, visiblePages } from '@/lib/auth/pages';
import { Button } from '@/components/ui/button';
import { signOutAction } from './shell/actions';
import styles from './layout.module.css';

/**
 * B9: a signed-in account reads a sentence, not a 404.
 *
 * Next renders the nearest `not-found` boundary inside this segment's
 * layout, so the one place every admin page's `notFound()` lands is here —
 * no page has to branch, and no screen plan has to remember. The HTTP status
 * stays 404 and `requireAdmin` on the page is still the enforcement; this
 * only decides what the refusal reads like.
 *
 * An admin can only have asked for a page that is not there. Anyone else
 * landed here either because the page is closed to them or because it does
 * not exist, and this boundary cannot tell which — so it says both, and
 * offers the pages that are open, which is the one useful next move either
 * way. An account with no page at all is told so, with the way out.
 */
export default async function AdminNotFound() {
  const user = await currentUser();

  if (user?.admin) {
    return (
      <div className={styles.message}>
        <h1>הדף לא נמצא</h1>
        <p>אולי הקישור ישן, או שהשורה נמחקה.</p>
        <Link href="/">חזרה לבית</Link>
      </div>
    );
  }

  const open = visiblePages(user);

  return (
    <div className={styles.message}>
      <h1>אין לך הרשאה לצפות בדף הזה</h1>
      {open.length === 0 ? (
        <p>החשבון מחובר, אבל עדיין לא ניתנה לו גישה לאף עמוד. פנו לאחד מראשי הקאמפ.</p>
      ) : (
        <>
          <p>או שהדף לא קיים. העמודים שפתוחים לחשבון הזה:</p>
          <ul className={styles.openList} aria-label="עמודים פתוחים">
            {open.map((key) => {
              const page = pageByKey(key);
              return <li key={key}><Link href={page.href}>{page.label}</Link></li>;
            })}
          </ul>
        </>
      )}
      <form action={signOutAction}>
        <Button type="submit">יציאה מהחשבון</Button>
      </form>
    </div>
  );
}

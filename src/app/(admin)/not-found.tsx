import Link from 'next/link';
import { requireAdmin } from '@/lib/auth/guard';
import { Button } from '@/components/ui/button';
import { signOutAction } from './shell/actions';
import styles from './layout.module.css';

/**
 * B9: a signed-in non-admin reads a sentence, not a 404.
 *
 * Next renders the nearest `not-found` boundary inside this segment's
 * layout, so the one place every admin page's `notFound()` lands is here —
 * no page has to branch, and no screen plan has to remember. The HTTP status
 * stays 404 and `requireAdmin` on the page is still the enforcement; this
 * only decides what the refusal reads like.
 */
export default async function AdminNotFound() {
  const admin = await requireAdmin();

  if (admin.ok) {
    return (
      <div className={styles.message}>
        <h1>הדף לא נמצא</h1>
        <p>אולי הקישור ישן, או שהשורה נמחקה.</p>
        <Link href="/">חזרה לבית</Link>
      </div>
    );
  }

  return (
    <div className={styles.message}>
      <h1>אין לך הרשאה לצפות בדף הזה</h1>
      <p>החשבון מחובר, אבל הוא אינו חשבון ניהול. פנו לאחד מראשי הקאמפ.</p>
      <form action={signOutAction}>
        <Button type="submit">יציאה מהחשבון</Button>
      </form>
    </div>
  );
}

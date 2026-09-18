import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { requireAdmin } from '@/lib/auth/guard';
import { UploadDrop } from './upload-drop';
import { DevTools } from './dev-tools';
import styles from './upload.module.css';

export const metadata: Metadata = { title: 'העלאת קובץ' };

export default async function UploadPage() {
  const admin = await requireAdmin();
  if (!admin.ok) notFound();

  return (
    <main className={styles.page}>
      <h1 className={styles.title}>העלאת קובץ</h1>
      <p className={styles.lead}>
        המערכת תזהה את הטבלאות בכל גיליון, תסווג אותן ותציג אותן לאישור.
        שום דבר לא נכתב לנתוני הקאמפ לפני שאישרתם טבלה.
      </p>

      <UploadDrop />

      <p className={styles.duplicateNote}>
        העלאה חוזרת של אותו קובץ בדיוק לא יוצרת עותק שני — היא פותחת את הסקירה
        הקיימת שלו.
      </p>

      <DevTools />
    </main>
  );
}

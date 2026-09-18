import { notFound } from 'next/navigation';
import { requireAdmin } from '@/lib/auth/guard';
import { UploadForm } from './upload-form';
import { SeedButton } from './seed-button';
import { CampSeedButton } from './camp-seed-button';

export default async function UploadPage() {
  const admin = await requireAdmin();
  if (!admin.ok) notFound();

  // Loading the reference workbooks is a development tool (see
  // `seedAction`'s own refusal in production). UI hiding is never the
  // enforcement on its own, but there is no reason to show a button whose
  // press can only fail once deployed.
  const isProduction = process.env.NODE_ENV === 'production';

  return (
    <main>
      <h1>העלאת קובץ</h1>
      <p className="muted">
        המערכת תזהה את הטבלאות בכל גיליון, תסווג אותן ותציג אותן לאישור.
      </p>
      <UploadForm />

      {!isProduction && (
        <>
          <h2>טעינת נתוני עבר</h2>
          <p className="muted">
            טעינת שלושת קובצי האקסל ההיסטוריים של הקאמפ למסד הנתונים. פעולה זו ניתנת להרצה חוזרת בבטחה —
            קבצים שכבר נטענו לא ייטענו פעם נוספת.
          </p>
          <SeedButton />
        </>
      )}
      <CampSeedButton />
    </main>
  );
}

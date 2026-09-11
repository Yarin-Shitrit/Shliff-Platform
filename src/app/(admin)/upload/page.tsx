import { UploadForm } from './upload-form';
import { SeedButton } from './seed-button';
import { CampSeedButton } from './camp-seed-button';

export default function UploadPage() {
  return (
    <main>
      <h1>העלאת קובץ</h1>
      <p className="muted">
        המערכת תזהה את הטבלאות בכל גיליון, תסווג אותן ותציג אותן לאישור.
      </p>
      <UploadForm />

      <h2>טעינת נתוני עבר</h2>
      <p className="muted">
        טעינת שלושת קובצי האקסל ההיסטוריים של הקאמפ למסד הנתונים. פעולה זו ניתנת להרצה חוזרת בבטחה —
        קבצים שכבר נטענו לא ייטענו פעם נוספת.
      </p>
      <SeedButton />
      <CampSeedButton />
    </main>
  );
}

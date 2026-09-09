import Link from 'next/link';

export default function OverviewPage() {
  return (
    <main>
      <h1>קופת שליף</h1>
      <p className="muted">
        ניהול הכספים של הקאמפ — תקציבים, אירועים, חובות וקיזוזים, במקום אחד.
      </p>
      <ul>
        <li>
          <Link href="/data">נתונים</Link> — כל מה שזוהה בקבצי האקסל, לפי שנה
        </li>
        <li>
          <Link href="/upload">ייבוא</Link> — העלאת קובץ חדש וזיהוי הטבלאות שבו
        </li>
      </ul>
      <p className="muted">
        חברי מחנה ודמי קאמפ עדיין לא נבנו. הם השלב הבא אחרי שהנתונים יושבים במסד.
      </p>
    </main>
  );
}

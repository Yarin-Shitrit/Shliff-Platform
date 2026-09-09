import { UploadForm } from './upload-form';

export default function UploadPage() {
  return (
    <main>
      <h1>העלאת קובץ</h1>
      <p className="muted">
        המערכת תזהה את הטבלאות בכל גיליון, תסווג אותן ותציג אותן לאישור.
      </p>
      <UploadForm />
    </main>
  );
}

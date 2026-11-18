'use client';

/**
 * One drawer body for a new account and for an existing one: the role and
 * the grid are the same in both, and two copies would drift on what a
 * grant is. The password is asked when creating, and offered as a separate
 * step when editing — changing who may see what and changing how someone
 * signs in are two decisions, saved by two buttons, so neither rides along
 * with the other by accident.
 *
 * The role is a two-way switch rather than a third grid column: an admin
 * account has no grid, because the role answers before any row is asked
 * (`levelOf`), and showing eighteen ticked rows would suggest they could be
 * unticked one at a time.
 *
 * The password is made here, not typed: a new account opens with one
 * already generated and visible, with a way to draw another or to copy
 * it, and the same control sits under the replacement on an existing
 * account. Once saved it is shown one more time, on the panel that
 * replaces the form, because the drawer closing is the last moment it can
 * be read — the server keeps only the hash and can never show it again.
 */
import { useId, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, ButtonLink } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Field, TextInput } from '@/components/ui/field';
import { useToast } from '@/components/ui/toaster';
import { isBlank } from '@/lib/text/normalize';
import { MIN_PASSWORD_LENGTH, type AccessMap } from '@/lib/auth/pages';
import { generatePassword } from '@/lib/auth/generate-password';
import {
  createUserAction, deleteUserAction, setUserAccessAction, setUserPasswordAction,
} from './actions';
import { AccessGrid } from './access-grid';
import styles from './users.module.css';

const ROLE_LABELS = {
  admin: 'ניהול מלא',
  granted: 'לפי הרשאות',
} as const;

export type UserFormProps = {
  closeHref: string;
  /** The signed-in admin's own row: the role switch and the delete are withheld. */
  isSelf?: boolean;
} & (
  | { mode: 'create' }
  | { mode: 'edit'; userId: string; email: string; admin: boolean; pages: AccessMap }
);

export function UserForm(props: UserFormProps) {
  const router = useRouter();
  const toast = useToast();
  const emailId = useId();
  const passwordId = useId();
  const roleId = useId();
  const newPasswordId = useId();

  const editing = props.mode === 'edit';
  const [email, setEmail] = useState(editing ? props.email : '');
  const [password, setPassword] = useState(() => (editing ? '' : generatePassword()));
  const [admin, setAdmin] = useState(editing ? props.admin : false);
  const [pages, setPages] = useState<AccessMap>(editing ? props.pages : {});
  const [newPassword, setNewPassword] = useState('');
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** The one showing of a password that was just saved. */
  const [handover, setHandover] = useState<{ email: string; password: string } | null>(null);

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.show({ message: 'הסיסמה הועתקה' });
    } catch {
      toast.show({ message: 'לא הצלחנו להעתיק. סמנו את הסיסמה והעתיקו אותה ידנית.', tone: 'bad' });
    }
  }

  const granted = !admin && Object.keys(pages).length;

  async function save() {
    // The library's own sentences, checked here so the refusal is immediate.
    if (isBlank(email)) { setError('יש להזין כתובת אימייל.'); return; }
    if (!editing && password.length < MIN_PASSWORD_LENGTH) {
      setError(`הסיסמה חייבת להכיל לפחות ${MIN_PASSWORD_LENGTH} תווים.`); return;
    }
    setError(null);
    setPending(true);
    try {
      if (props.mode === 'create') {
        const result = await createUserAction({ email, password, admin, pages });
        if (!result.ok) { setError(result.error); return; }
        toast.show({ message: `נוצר חשבון ל־${email.trim()}` });
        // The drawer stays open on the handover panel: closing now would
        // take the password with it.
        setHandover({ email: email.trim(), password });
        router.refresh();
        return;
      }
      const result = await setUserAccessAction(props.userId, { admin, pages });
      if (!result.ok) { setError(result.error); return; }
      toast.show({ message: `ההרשאות של ${props.email} נשמרו` });
      router.replace(props.closeHref);
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  async function changePassword() {
    if (props.mode !== 'edit') return;
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      setError(`הסיסמה חייבת להכיל לפחות ${MIN_PASSWORD_LENGTH} תווים.`); return;
    }
    setError(null);
    setPending(true);
    try {
      const result = await setUserPasswordAction(props.userId, newPassword);
      if (!result.ok) { setError(result.error); return; }
      toast.show({ message: `הסיסמה של ${props.email} הוחלפה` });
      setHandover({ email: props.email, password: newPassword });
      setNewPassword('');
    } finally {
      setPending(false);
    }
  }

  async function remove() {
    if (props.mode !== 'edit') return;
    setPending(true);
    try {
      const result = await deleteUserAction(props.userId);
      if (!result.ok) { setConfirmingDelete(false); setError(result.error); return; }
      toast.show({ message: `החשבון של ${props.email} נמחק` });
      router.replace(props.closeHref);
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  if (handover !== null) {
    return (
      <div className={styles.form} role="status" aria-label="מסירת הסיסמה">
        <p className={styles.who}>
          {props.mode === 'create' ? 'החשבון נוצר.' : 'הסיסמה הוחלפה.'}
          {' '}
          זו הסיסמה של <bdi dir="ltr">{handover.email}</bdi> — מסרו אותה עכשיו, בעל פה או
          בהודעה שנמחקת. היא לא תוצג שוב: המערכת שומרת רק את הגרסה המוצפנת שלה.
        </p>
        <PasswordReveal
          label="הסיסמה"
          value={handover.password}
          onCopy={() => copy(handover.password)}
        />
        <div className={styles.actions}>
          {props.mode === 'create' ? (
            <ButtonLink tone="primary" href={props.closeHref} replace>סיום</ButtonLink>
          ) : (
            <Button tone="primary" onClick={() => setHandover(null)}>חזרה לחשבון</Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={styles.form}>
      {error === null ? null : <p className={styles.error} role="alert">{error}</p>}

      {props.mode === 'create' ? (
        <>
          <Field id={emailId} label="כתובת אימייל" required hint="הכתובת שאיתה נכנסים למערכת">
            <TextInput id={emailId} value={email} disabled={pending} onChange={setEmail} />
          </Field>
          <Field
            id={passwordId}
            label="סיסמה ראשונית"
            required
            hint={`נוצרה עכשיו, ותוצג שוב אחרי השמירה. אפשר להקליד אחרת — לפחות ${MIN_PASSWORD_LENGTH} תווים.`}
          >
            <input
              id={passwordId} className={styles.input} type="text" autoComplete="off" dir="ltr"
              spellCheck={false} value={password} disabled={pending}
              onChange={(event) => { setPassword(event.target.value); }}
            />
          </Field>
          <PasswordTools
            disabled={pending}
            onGenerate={() => setPassword(generatePassword())}
            onCopy={() => copy(password)}
          />
        </>
      ) : (
        <p className={styles.who}><bdi dir="ltr">{props.email}</bdi></p>
      )}

      <Field
        id={roleId}
        label="תפקיד"
        as="group"
        hint={props.isSelf
          ? 'זה החשבון המחובר כרגע, ולכן הרשאת הניהול שלו נשארת.'
          : 'ניהול מלא רואה ועורך הכול, כולל את העמוד הזה. לפי הרשאות — רק מה שמסומן למטה.'}
      >
        <div className={styles.roles} role="radiogroup" id={roleId}>
          {(['granted', 'admin'] as const).map((role) => (
            <label key={role} className={styles.roleChoice} data-on={(admin ? 'admin' : 'granted') === role ? 'true' : undefined}>
              <input
                type="radio"
                name={roleId}
                value={role}
                checked={(admin ? 'admin' : 'granted') === role}
                disabled={pending || props.isSelf}
                onChange={() => setAdmin(role === 'admin')}
              />
              <span>{ROLE_LABELS[role]}</span>
            </label>
          ))}
        </div>
      </Field>

      {admin ? null : (
        <AccessGrid value={pages} onChange={setPages} disabled={pending} />
      )}

      {admin || granted ? null : (
        <p className={styles.note}>בלי אף עמוד מסומן, החשבון יוכל להיכנס אבל לא יראה כלום.</p>
      )}

      <div className={styles.actions}>
        <Button tone="primary" disabled={pending} onClick={save}>
          {props.mode === 'create' ? 'יצירת החשבון' : 'שמירת ההרשאות'}
        </Button>
      </div>

      {props.mode !== 'edit' ? null : (
        <>
          <hr className={styles.rule} />
          <Field
            id={newPasswordId}
            label="סיסמה חדשה"
            hint={`מחליפה את הסיסמה הנוכחית מיד, ותוצג פעם אחת אחרי ההחלפה. לפחות ${MIN_PASSWORD_LENGTH} תווים.`}
          >
            <input
              id={newPasswordId} className={styles.input} type="text" autoComplete="off" dir="ltr"
              spellCheck={false} value={newPassword} disabled={pending}
              onChange={(event) => { setNewPassword(event.target.value); }}
            />
          </Field>
          <PasswordTools
            disabled={pending}
            onGenerate={() => setNewPassword(generatePassword())}
            onCopy={newPassword === '' ? undefined : () => copy(newPassword)}
          />
          <div className={styles.actions}>
            <Button disabled={pending || newPassword === ''} onClick={changePassword}>
              החלפת הסיסמה
            </Button>
          </div>

          {props.isSelf ? null : (
            <>
              <hr className={styles.rule} />
              <div className={styles.actions}>
                <Button tone="danger" disabled={pending} onClick={() => setConfirmingDelete(true)}>
                  מחיקת החשבון
                </Button>
              </div>
              {!confirmingDelete ? null : (
                <ConfirmDialog
                  title={`למחוק את החשבון של ${props.email}?`}
                  consequence="החשבון לא יוכל להיכנס יותר, וכל ההרשאות שלו יימחקו איתו. את הנתונים של הקאמפ זה לא משנה."
                  confirmLabel="מחיקת החשבון"
                  onCancel={() => setConfirmingDelete(false)}
                  onConfirm={remove}
                />
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

/** The two verbs beside a password box: draw another, or take this one. */
function PasswordTools({ disabled, onGenerate, onCopy }: {
  disabled?: boolean;
  onGenerate: () => void;
  onCopy?: () => void;
}) {
  return (
    <div className={styles.actions}>
      <Button size="sm" disabled={disabled} onClick={onGenerate}>יצירת סיסמה אחרת</Button>
      <Button size="sm" disabled={disabled || onCopy === undefined} onClick={onCopy}>העתקת הסיסמה</Button>
    </div>
  );
}

/** A saved password, shown once, in a box that can be selected and copied. */
function PasswordReveal({ label, value, onCopy }: {
  label: string;
  value: string;
  onCopy: () => void;
}) {
  const id = useId();
  return (
    <>
      <Field id={id} label={label}>
        <input id={id} className={styles.input} type="text" readOnly dir="ltr" value={value} />
      </Field>
      <div className={styles.actions}>
        <Button size="sm" onClick={onCopy}>העתקת הסיסמה</Button>
      </div>
    </>
  );
}

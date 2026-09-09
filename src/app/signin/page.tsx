import { signIn } from '@/lib/auth/config';

async function authenticate(formData: FormData) {
  'use server';
  await signIn('credentials', {
    email: formData.get('email'),
    password: formData.get('password'),
    redirectTo: '/',
  });
}

export default function SignInPage() {
  return (
    <main>
      <h1>התחברות</h1>
      <form action={authenticate} className="card">
        <label htmlFor="email">אימייל</label>
        <input id="email" name="email" type="email" autoComplete="email" required />
        <label htmlFor="password">סיסמה</label>
        <input id="password" name="password" type="password" autoComplete="current-password" required />
        <button type="submit">התחבר</button>
      </form>
    </main>
  );
}

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { Field } from '@/components/admin/field'
import { CSRF_COOKIE } from '@/lib/auth/csrf'
import { getCurrentUser } from '@/lib/auth/guard'
import { landingPathFor } from '@/lib/auth/roles'
import { LoginForm } from './login-form'

export default async function LoginPage() {
  const user = await getCurrentUser()
  if (user) redirect(landingPathFor(user.role))

  // Next.js forbids `cookies().set()` inside a Server Component's render —
  // it is only permitted in a Server Action or Route Handler. When the CSRF
  // cookie is missing, hand off to the Route Handler that is allowed to set
  // it; it redirects straight back here once the cookie is in place.
  const store = await cookies()
  const csrf = store.get(CSRF_COOKIE)?.value
  if (!csrf) redirect('/admin/login/csrf')

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6">
      <h1 className="mb-8 font-serif text-3xl text-[var(--color-brass)]">Gala Admin</h1>
      <LoginForm csrf={csrf}>
        <Field label="Email" name="email" type="email" required autoComplete="username" />
        <Field label="Password" name="password" type="password" required autoComplete="current-password" />
      </LoginForm>
    </main>
  )
}

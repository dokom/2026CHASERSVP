import { getCurrentUser } from '@/lib/auth/guard'
import { CsrfInput } from '@/components/admin/csrf-input'
import { logoutAction } from './login/actions'
import { AdminNav } from './nav'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser()

  // The login page is nested under /admin but must render without a shell.
  if (!user) return <>{children}</>

  return (
    <div className="min-h-screen">
      <header className="border-b border-[var(--color-border)] px-4 py-3">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3">
          <span className="font-serif text-lg text-[var(--brass-ink)]">Gala Admin</span>
          <AdminNav role={user.role} />
          <form action={logoutAction}>
            <CsrfInput />
            <span className="mr-3 text-sm text-[var(--color-text-muted)]">{user.name}</span>
            <button type="submit" className="text-sm underline underline-offset-4">
              Sign out
            </button>
          </form>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
    </div>
  )
}

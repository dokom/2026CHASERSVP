'use client'

import { useActionState } from 'react'
import { loginAction } from './actions'

export function LoginForm({ csrf, children }: { csrf: string; children: React.ReactNode }) {
  const [error, action, pending] = useActionState(loginAction, null)
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="csrf" value={csrf} />
      {children}
      {error ? (
        <p role="alert" className="text-sm text-[var(--color-danger)]">{error}</p>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded bg-[var(--color-accent)] px-4 py-2 font-medium text-[var(--on-accent)] disabled:opacity-60"
      >
        {pending ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  )
}

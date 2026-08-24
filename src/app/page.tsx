import Link from 'next/link'
import { BrandMark } from '@/components/brand-mark'

/**
 * The bare origin has no public content: guests arrive by invitation link and
 * staff by the admin sign-in. Say who we are and point staff the right way.
 */
export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col items-start justify-center gap-6 px-6">
      <BrandMark size="lg" />
      <h1 className="font-serif text-3xl">Gala 2026</h1>
      <p className="text-[var(--color-text-muted)]">
        Guests: please use the personal link in your invitation.
      </p>
      <Link href="/admin/login" className="underline underline-offset-4">Staff sign-in</Link>
    </main>
  )
}

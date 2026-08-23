import { cookies } from 'next/headers'
import { prisma } from '@/lib/db'
import { getEnv } from '@/lib/env'
import { requireRole } from '@/lib/auth/guard'
import { CSRF_COOKIE } from '@/lib/auth/csrf'
import { checkInProgress } from '@/lib/checkin/repository'
import { Scanner } from './scanner'

export const dynamic = 'force-dynamic'

export default async function CheckinPage() {
  await requireRole('STAFF')
  const store = await cookies()
  const csrf = store.get(CSRF_COOKIE)?.value
  if (!csrf) throw new Error('CSRF cookie missing — check that src/proxy.ts matches this route')
  const progress = await checkInProgress(prisma)

  return (
    <section className="space-y-6">
      <div className="flex items-baseline justify-between">
        <h1 className="font-serif text-2xl">Check-in</h1>
        <p className="text-sm text-[var(--text-muted)]" data-testid="checkin-progress">
          {progress.checkedIn} of {progress.attending} arrived
        </p>
      </div>
      <Scanner csrf={csrf} appUrl={getEnv().APP_URL} />
    </section>
  )
}

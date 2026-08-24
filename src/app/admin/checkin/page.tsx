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

  // The "N of M arrived" counter lives inside Scanner: it is the component
  // that knows when a tap lands, so it can keep the count honest without a
  // reload. This server read is only its starting point.
  return (
    <section className="space-y-6">
      <Scanner csrf={csrf} appUrl={getEnv().APP_URL} initialProgress={progress} />
    </section>
  )
}

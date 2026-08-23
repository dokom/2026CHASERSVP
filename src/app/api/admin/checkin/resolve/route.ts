import { cookies } from 'next/headers'
import { prisma } from '@/lib/db'
import { requireRole } from '@/lib/auth/guard'
import { CSRF_COOKIE, verifyCsrfToken } from '@/lib/auth/csrf'
import { resolveSchema } from '@/lib/validation/checkin'
import { resolvePartyByToken } from '@/lib/checkin/repository'

export const dynamic = 'force-dynamic'

export async function POST(request: Request): Promise<Response> {
  await requireRole('STAFF')
  const store = await cookies()
  if (!verifyCsrfToken(store.get(CSRF_COOKIE)?.value, request.headers.get('x-csrf-token'))) {
    return Response.json({ error: 'csrf' }, { status: 403 })
  }
  const parsed = resolveSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return Response.json({ error: 'invalid' }, { status: 400 })

  // The token is never logged and never echoed back.
  const party = await resolvePartyByToken(prisma, parsed.data.token)
  if (!party) return Response.json({ error: 'not_found' }, { status: 404, headers: { 'Cache-Control': 'no-store' } })
  return Response.json(party, { headers: { 'Cache-Control': 'no-store' } })
}

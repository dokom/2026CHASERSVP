import { cookies } from 'next/headers'
import { prisma } from '@/lib/db'
import { requireRole } from '@/lib/auth/guard'
import { CSRF_COOKIE, verifyCsrfToken } from '@/lib/auth/csrf'
import { checkInSchema, guestIdSchema } from '@/lib/validation/checkin'
import { checkInGuest, undoCheckIn } from '@/lib/checkin/repository'

export const dynamic = 'force-dynamic'
const NO_STORE = { 'Cache-Control': 'no-store' }

async function guard(request: Request): Promise<{ actorId: string } | Response> {
  const user = await requireRole('STAFF')
  const store = await cookies()
  if (!verifyCsrfToken(store.get(CSRF_COOKIE)?.value, request.headers.get('x-csrf-token'))) {
    return Response.json({ error: 'csrf' }, { status: 403 })
  }
  return { actorId: user.id }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const g = await guard(request)
  if (g instanceof Response) return g
  const { id } = await params
  if (!guestIdSchema.safeParse(id).success) return Response.json({ error: 'invalid' }, { status: 400 })
  const parsed = checkInSchema.safeParse(await request.json().catch(() => ({})))
  const at = parsed.success ? parsed.data.at : new Date()
  const result = await checkInGuest(prisma, g.actorId, id, at)
  return Response.json(result, { status: result.ok ? 200 : 404, headers: NO_STORE })
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const g = await guard(request)
  if (g instanceof Response) return g
  const { id } = await params
  if (!guestIdSchema.safeParse(id).success) return Response.json({ error: 'invalid' }, { status: 400 })
  return Response.json(await undoCheckIn(prisma, g.actorId, id), { headers: NO_STORE })
}

import { prisma } from '@/lib/db'
import { resolveInviteByToken } from '@/lib/guest/resolve'
import { getEvent } from '@/lib/events/repository'
import { buildInviteIcs } from '@/lib/guest/ics'

export const dynamic = 'force-dynamic'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
): Promise<Response> {
  const { token } = await params
  const [invite, event] = await Promise.all([
    resolveInviteByToken(prisma, token),
    getEvent(prisma),
  ])
  if (!invite || !event) {
    return new Response('Not found', { status: 404 })
  }

  return new Response(buildInviteIcs(event, invite.id, new Date()), {
    status: 200,
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'attachment; filename="gala.ics"',
      // The URL carries a credential; never let an intermediary keep the body.
      'Cache-Control': 'no-store',
    },
  })
}

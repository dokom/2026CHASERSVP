import { z } from 'zod'
import { prisma } from '@/lib/db'
import { getEnv } from '@/lib/env'
import { requireRole } from '@/lib/auth/guard'
import { listInviteTokens } from '@/lib/invites/repository'
import { inviteUrl, buildQrPdf, buildQrZip } from '@/lib/invites/qr'

// Never cache: every response embeds live invite tokens, which double as
// each party's RSVP credential.
export const dynamic = 'force-dynamic'

const querySchema = z.object({
  format: z.enum(['pdf', 'zip']),
  status: z.enum(['PENDING', 'ATTENDING', 'DECLINED', 'PARTIAL']).optional(),
})

export async function GET(request: Request): Promise<Response> {
  // Must run before any query — an unauthenticated request must never reach
  // listInviteTokens. Redirects to /admin/login for anonymous callers.
  await requireRole('ADMIN')

  const url = new URL(request.url)
  const parsed = querySchema.safeParse({
    format: url.searchParams.get('format'),
    status: url.searchParams.get('status') ?? undefined,
  })
  if (!parsed.success) {
    return Response.json({ error: 'format must be "pdf" or "zip"' }, { status: 400 })
  }

  const { APP_URL } = getEnv()
  const invites = await listInviteTokens(
    prisma,
    parsed.data.status ? { status: parsed.data.status } : {},
  )
  const items = invites.map((invite) => ({
    label: invite.label,
    url: inviteUrl(invite.token, APP_URL),
  }))

  const isPdf = parsed.data.format === 'pdf'
  const body = isPdf ? await buildQrPdf(items) : await buildQrZip(items)

  return new Response(new Uint8Array(body), {
    status: 200,
    headers: {
      'Content-Type': isPdf ? 'application/pdf' : 'application/zip',
      'Content-Disposition': `attachment; filename="gala-qr-codes.${isPdf ? 'pdf' : 'zip'}"`,
      'Cache-Control': 'no-store',
    },
  })
}

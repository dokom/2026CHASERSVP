import { z } from 'zod'
import { prisma } from '@/lib/db'
import { getEnv } from '@/lib/env'
import { requireRole } from '@/lib/auth/guard'
import { listInviteTokens } from '@/lib/invites/repository'
import { formatInviteNumber } from '@/lib/invites/numbering'
import { inviteUrl, buildQrPdf, buildQrZip, buildQrCsv, type QrItem } from '@/lib/invites/qr'

// Never cache: every response embeds live invite tokens, which double as
// each party's RSVP credential.
export const dynamic = 'force-dynamic'

const querySchema = z.object({
  format: z.enum(['pdf', 'zip', 'csv']),
  status: z.enum(['PENDING', 'ATTENDING', 'DECLINED', 'PARTIAL']).optional(),
})

const CONTENT_TYPES = {
  pdf: 'application/pdf',
  zip: 'application/zip',
  csv: 'text/csv; charset=utf-8',
} as const

async function render(format: 'pdf' | 'zip' | 'csv', items: QrItem[]): Promise<Buffer> {
  if (format === 'pdf') return buildQrPdf(items)
  if (format === 'zip') return buildQrZip(items)
  return Buffer.from(buildQrCsv(items), 'utf8')
}

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
    return Response.json({ error: 'format must be "pdf", "zip" or "csv"' }, { status: 400 })
  }

  const { APP_URL } = getEnv()
  const invites = await listInviteTokens(
    prisma,
    parsed.data.status ? { status: parsed.data.status } : {},
  )
  // Pad every number to the width of the highest one in THIS export, so a
  // sheet never mixes "007" with "1007".
  const highest = invites.reduce((max, invite) => Math.max(max, invite.number), 0)
  const items = invites.map((invite) => ({
    number: formatInviteNumber(invite.number, highest),
    label: invite.label,
    url: inviteUrl(invite.token, APP_URL),
  }))

  const { format } = parsed.data
  const body = await render(format, items)

  return new Response(new Uint8Array(body), {
    status: 200,
    headers: {
      'Content-Type': CONTENT_TYPES[format],
      'Content-Disposition': `attachment; filename="gala-qr-codes.${format}"`,
      'Cache-Control': 'no-store',
    },
  })
}

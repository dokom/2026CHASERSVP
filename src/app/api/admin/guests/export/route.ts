import { prisma } from '@/lib/db'
import { requireRole } from '@/lib/auth/guard'
import { allGuestsForExport } from '@/lib/guests/repository'
import { csvHeader, guestsToCsvRows } from '@/lib/guests/export'

export const dynamic = 'force-dynamic'

export async function GET(): Promise<Response> {
  await requireRole('ADMIN')
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(encoder.encode('﻿' + csvHeader() + '\r\n'))
      for await (const row of allGuestsForExport(prisma)) {
        controller.enqueue(encoder.encode(guestsToCsvRows([row])[0] + '\r\n'))
      }
      controller.close()
    },
  })
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="guests-${new Date().toISOString().slice(0, 10)}.csv"`,
      'Cache-Control': 'no-store',
    },
  })
}

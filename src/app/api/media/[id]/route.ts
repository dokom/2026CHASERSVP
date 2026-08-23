import { prisma } from '@/lib/db'
import { readFloorplanImage } from '@/lib/media/repository'

// Unauthenticated by design (a guest holding an invite link has no session
// and must still see the floorplan) but scoped to only the current event's
// floorplan asset — see readFloorplanImage for why every other id 404s.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params
  const asset = await readFloorplanImage(prisma, id)
  if (!asset) return new Response('Not found', { status: 404 })

  return new Response(new Uint8Array(asset.bytes), {
    status: 200,
    headers: {
      // From the STORED value that inspectImage derived — never from the request.
      'Content-Type': asset.mimeType,
      'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': 'inline',
      // Immutable content at an immutable id; guests fetch this on every visit.
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  })
}

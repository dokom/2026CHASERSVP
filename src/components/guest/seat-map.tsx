import type { TableMarkerRow } from '@/lib/events/repository'
import type { Seat } from '@/lib/guest/page-data'
import { SeatMapViewer } from './seat-map-viewer'

const MARKER =
  'absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[var(--on-accent)] bg-[var(--color-accent)] seat-pulse'

/** One marker per distinct table, in party order, skipping tables the organiser has not placed. */
function distinctMarkers(seats: Seat[]): TableMarkerRow[] {
  const seen = new Set<string>()
  return seats.flatMap((seat) => {
    if (!seat.marker || seen.has(seat.table)) return []
    seen.add(seat.table)
    return [seat.marker]
  })
}

/**
 * The plan plus the party's markers. Marker coordinates are normalised 0–1
 * against the floorplan, so the position stays correct at every rendered
 * size: percentage offsets against a box that is exactly the image's box.
 *
 * Inline, the image fills its frame's width and the stage carries
 * [data-seat-map] for SeatAct's scroll zoom toward the FIRST marker (the
 * primary guest's table). Full screen, the image is bounded by the viewport
 * instead and the box shrink-wraps it, so the percentages still land.
 */
function FloorplanStage({ floorplanAssetId, markers, variant }: {
  floorplanAssetId: string
  markers: TableMarkerRow[]
  variant: 'inline' | 'fullscreen'
}) {
  const isInline = variant === 'inline'
  const origin = markers[0]
  return (
    <div
      className={isInline ? 'relative' : 'relative inline-block'}
      data-seat-map={isInline ? true : undefined}
      style={isInline && origin ? { transformOrigin: `${origin.x * 100}% ${origin.y * 100}%` } : undefined}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- served from our own
          route handler at unknown intrinsic size; next/image adds no value here */}
      <img
        src={`/api/media/${floorplanAssetId}`}
        alt="Floorplan of the venue"
        className={isInline ? 'block w-full' : 'block h-auto max-h-[calc(100dvh-5rem)] w-auto max-w-[calc(100vw-2rem)]'}
      />
      {markers.map((marker) => (
        <span
          key={marker.tableNumber}
          className={MARKER}
          style={{ left: `${marker.x * 100}%`, top: `${marker.y * 100}%` }}
          aria-label={`Table ${marker.tableNumber}`}
          data-testid={isInline ? 'table-marker' : undefined}
        />
      ))}
    </div>
  )
}

export function SeatMap({ floorplanAssetId, seats }: {
  floorplanAssetId: string | null
  seats: Seat[]
}) {
  if (seats.length === 0) return null
  const markers = distinctMarkers(seats)

  return (
    <div className="space-y-4">
      <ul data-testid="seat-list" className="space-y-1 font-serif text-2xl">
        {seats.map((seat) => (
          <li key={seat.guestId}>
            {seat.name}
            <span className="text-[var(--color-text-muted)]"> · </span>
            <span className="text-[var(--accent-ink)]">Table {seat.table}</span>
          </li>
        ))}
      </ul>

      {floorplanAssetId ? (
        <SeatMapViewer
          inline={<FloorplanStage floorplanAssetId={floorplanAssetId} markers={markers} variant="inline" />}
          fullscreen={<FloorplanStage floorplanAssetId={floorplanAssetId} markers={markers} variant="fullscreen" />}
        />
      ) : null}
    </div>
  )
}

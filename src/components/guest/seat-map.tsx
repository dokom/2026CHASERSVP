import type { TableMarkerRow } from '@/lib/events/repository'
import { SeatMapViewer } from './seat-map-viewer'

const MARKER =
  'absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[var(--on-accent)] bg-[var(--color-accent)] seat-pulse'

/**
 * The plan plus the guest's marker. Marker coordinates are normalised 0–1
 * against the floorplan, so the position stays correct at every rendered
 * size: percentage offsets against a box that is exactly the image's box.
 *
 * Inline, the image fills its frame's width and the stage carries
 * [data-seat-map] for SeatAct's scroll zoom toward the marker. Full screen,
 * the image is bounded by the viewport instead and the box shrink-wraps it,
 * so the marker's percentages still land on the same table.
 */
function FloorplanStage({ floorplanAssetId, marker, table, variant }: {
  floorplanAssetId: string
  marker: TableMarkerRow | null
  table: string
  variant: 'inline' | 'fullscreen'
}) {
  const isInline = variant === 'inline'
  return (
    <div
      className={isInline ? 'relative' : 'relative inline-block'}
      data-seat-map={isInline ? true : undefined}
      style={isInline && marker ? { transformOrigin: `${marker.x * 100}% ${marker.y * 100}%` } : undefined}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- served from our own
          route handler at unknown intrinsic size; next/image adds no value here */}
      <img
        src={`/api/media/${floorplanAssetId}`}
        alt="Floorplan of the venue"
        className={isInline ? 'block w-full' : 'block h-auto max-h-[calc(100dvh-5rem)] w-auto max-w-[calc(100vw-2rem)]'}
      />
      {marker ? (
        <span
          className={MARKER}
          style={{ left: `${marker.x * 100}%`, top: `${marker.y * 100}%` }}
          aria-label={`Table ${table}`}
          data-testid={isInline ? 'table-marker' : undefined}
        />
      ) : null}
    </div>
  )
}

export function SeatMap({
  floorplanAssetId, marker, table,
}: {
  floorplanAssetId: string | null
  marker: TableMarkerRow | null
  table: string | null
}) {
  if (!table) return null

  return (
    <div className="space-y-4">
      <p className="font-serif text-2xl">
        You&rsquo;re at <span className="text-[var(--accent-ink)]">Table {table}</span>
      </p>

      {floorplanAssetId ? (
        <SeatMapViewer
          inline={<FloorplanStage floorplanAssetId={floorplanAssetId} marker={marker} table={table} variant="inline" />}
          fullscreen={<FloorplanStage floorplanAssetId={floorplanAssetId} marker={marker} table={table} variant="fullscreen" />}
        />
      ) : null}
    </div>
  )
}

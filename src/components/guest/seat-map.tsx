import type { TableMarkerRow } from '@/lib/events/repository'

/**
 * Marker coordinates are normalised 0–1 against the floorplan, so the position
 * stays correct at every rendered size. Percentage offsets, not pixels.
 */
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
        You&rsquo;re at <span className="text-[var(--brass-ink)]">Table {table}</span>
      </p>

      {floorplanAssetId ? (
        <div
          className="relative overflow-hidden rounded border border-[var(--color-border)] lg:max-w-md"
          data-seat-map
          style={marker ? { transformOrigin: `${marker.x * 100}% ${marker.y * 100}%` } : undefined}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- served from our own
              route handler at unknown intrinsic size; next/image adds no value here */}
          <img
            src={`/api/media/${floorplanAssetId}`}
            alt="Floorplan of the venue"
            className="block w-full"
          />
          {marker ? (
            <span
              className="absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[var(--color-ink-deep)] bg-[var(--color-brass)] seat-pulse"
              style={{ left: `${marker.x * 100}%`, top: `${marker.y * 100}%` }}
              aria-label={`Table ${table}`}
              data-testid="table-marker"
            />
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

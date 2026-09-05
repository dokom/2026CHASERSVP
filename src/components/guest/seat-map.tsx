import type { TableMarkerRow } from '@/lib/events/repository'
import type { Seat } from '@/lib/guest/page-data'
import { SeatMapViewer } from './seat-map-viewer'

/** A hollow ring, so the table number printed on the plan stays legible inside it. */
const MARKER =
  'absolute h-7 w-7 -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-[var(--accent)] seat-pulse'

type TableGroup = { table: string; marker: TableMarkerRow | null; names: string[] }

/** The party by table, in party order (the primary guest's table first). */
function byTable(seats: Seat[]): TableGroup[] {
  return seats.reduce<TableGroup[]>((groups, seat) => {
    const existing = groups.find((group) => group.table === seat.table)
    if (existing) {
      return groups.map((group) =>
        group === existing ? { ...group, names: [...group.names, seat.name] } : group)
    }
    return [...groups, { table: seat.table, marker: seat.marker, names: [seat.name] }]
  }, [])
}

/**
 * The plan plus the party's markers. Marker coordinates are normalised 0–1
 * against the floorplan, so the position stays correct at every rendered
 * size: percentage offsets against a box that is exactly the image's box.
 * Full screen, the image is bounded by the viewport instead and the box
 * shrink-wraps it, so the percentages still land.
 */
function FloorplanStage({ floorplanAssetId, markers, variant }: {
  floorplanAssetId: string
  markers: TableMarkerRow[]
  variant: 'inline' | 'fullscreen'
}) {
  const isInline = variant === 'inline'
  return (
    <div className={isInline ? 'relative' : 'relative inline-block'}>
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

/**
 * Place cards, one per table, then the plan. A party seated together gets
 * one card with every name on it; a split party gets a card per table, so
 * each person can find their own number at a glance.
 */
export function SeatMap({ floorplanAssetId, seats }: {
  floorplanAssetId: string | null
  seats: Seat[]
}) {
  if (seats.length === 0) return null
  const groups = byTable(seats)
  const markers = groups.flatMap((group) => (group.marker ? [group.marker] : []))
  // Two cards side by side only when each is short; a table with a long
  // guest list gets the full width so no name has to wrap awkwardly.
  const twoUp = groups.length > 1 && groups.every((group) => group.names.length <= 2)

  return (
    <div className="space-y-6">
      <ul data-testid="seat-list" className={`grid gap-3 ${twoUp ? 'sm:grid-cols-2' : ''}`}>
        {groups.map((group) => (
          <li
            key={group.table}
            data-table={group.table}
            className="flex items-start gap-5 rounded-2xl border border-[var(--color-border)] bg-[color-mix(in_oklab,var(--accent)_6%,transparent)] p-5"
          >
            <span className="flex shrink-0 flex-col items-center">
              <span className="font-serif text-[3.25rem] leading-none text-[var(--accent-ink)]" aria-hidden="true">
                {group.table}
              </span>
              <span className="mt-1 text-xs text-[var(--color-text-muted)]">Table {group.table}</span>
            </span>
            <ul className="min-w-0 space-y-1 self-center font-serif text-xl leading-snug">
              {group.names.map((name) => (
                <li key={name}>{name}</li>
              ))}
            </ul>
          </li>
        ))}
      </ul>

      {floorplanAssetId ? (
        <div className="space-y-2">
          <SeatMapViewer
            inline={<FloorplanStage floorplanAssetId={floorplanAssetId} markers={markers} variant="inline" />}
            fullscreen={<FloorplanStage floorplanAssetId={floorplanAssetId} markers={markers} variant="fullscreen" />}
          />
          <p className="text-sm text-[var(--color-text-muted)]">Tap the plan to see it full screen.</p>
        </div>
      ) : null}
    </div>
  )
}

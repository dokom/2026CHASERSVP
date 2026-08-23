'use client'

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { Party, PartyGuest } from '@/lib/checkin/repository'
import { markSynced, markFailed, nextBatch, type QueuedCheckIn } from '@/lib/checkin/queue'
import { loadQueue, saveQueue } from '@/lib/checkin/idb'
import { extractToken } from '@/lib/validation/checkin'
import { PartyCard } from './party-card'

const FLUSH_INTERVAL_MS = 15_000
const FLUSH_BATCH = 10

type Detector = { detect: (source: ImageBitmapSource) => Promise<{ rawValue: string }[]> }

/**
 * A queued item plus the invite token that scopes its eventual write (see
 * I3 in repository.ts: the token, not the session, proves which party a
 * guest belongs to). `queue.ts` is a shared pure module outside this
 * task's file set, so the token is carried as a local structural
 * extension rather than a change to `QueuedCheckIn` itself — every
 * `queue.ts` helper still operates on it unchanged (extra fields survive
 * their spreads at runtime; only the return type needs re-asserting).
 */
type QueuedItem = QueuedCheckIn & { token: string }
const asQueuedItems = (items: QueuedCheckIn[]): QueuedItem[] => items as QueuedItem[]

function enqueueWithToken(queue: QueuedItem[], guestId: string, at: string, token: string): QueuedItem[] {
  if (queue.some((item) => item.guestId === guestId)) return queue
  return [...queue, { guestId, at, attempts: 0, token }]
}

function guestDisplayName(guest: PartyGuest): string {
  return guest.badgeName || `${guest.firstName} ${guest.lastName}`
}

/** Subscribes to the browser's connectivity signal without touching React state directly. */
function subscribeOnline(callback: () => void): () => void {
  window.addEventListener('online', callback)
  window.addEventListener('offline', callback)
  return () => {
    window.removeEventListener('online', callback)
    window.removeEventListener('offline', callback)
  }
}
const getOnlineSnapshot = () => navigator.onLine
const getServerOnlineSnapshot = () => true

export function Scanner({ csrf, appUrl }: { csrf: string; appUrl: string }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const linkInputRef = useRef<HTMLInputElement>(null)
  const [party, setParty] = useState<Party | null>(null)
  const [queue, setQueue] = useState<QueuedItem[]>([])
  const [status, setStatus] = useState<string>('Point the camera at an invitation')
  const [mounted, setMounted] = useState(false)
  const online = useSyncExternalStore(subscribeOnline, getOnlineSnapshot, getServerOnlineSnapshot)
  const lastScan = useRef<string>('')
  const partyTokenRef = useRef<string | null>(null)
  const isFlushingRef = useRef(false)
  // Serializes every queue mutation (taps and flush writes alike) so a
  // read-modify-write cycle can never interleave with another one — the
  // fix for C1: a tap that lands mid-flush is queued behind the flush's
  // own writes, never raced and overwritten by them.
  const queueMutexRef = useRef<Promise<unknown>>(Promise.resolve())

  useEffect(() => {
    const id = requestAnimationFrame(() => setMounted(true))
    return () => cancelAnimationFrame(id)
  }, [])

  const headers = { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }

  // ---------------------------------------------------------------- queue
  /**
   * Every queue change — a tap, an undo, a flush outcome — goes through
   * here: load the current persisted queue, apply the reducer, save it.
   * Never read from the `queue` React state to decide what to write; that
   * state can be stale the instant another mutation (a flush in flight)
   * has written since it was captured.
   */
  const mutateQueue = useCallback((reducer: (current: QueuedItem[]) => QueuedItem[]): Promise<QueuedItem[]> => {
    const run = queueMutexRef.current.catch(() => undefined).then(async () => {
      const current = asQueuedItems(await loadQueue().catch(() => [] as QueuedCheckIn[]))
      const next = reducer(current)
      await saveQueue(next).catch(() => undefined)
      setQueue(next)
      return next
    })
    queueMutexRef.current = run.catch(() => undefined)
    return run
  }, [])

  const flush = useCallback(async () => {
    if (isFlushingRef.current) return // C1: never run two flushes concurrently
    isFlushingRef.current = true
    try {
      const snapshot = asQueuedItems(await loadQueue().catch(() => [] as QueuedCheckIn[]))
      for (const item of asQueuedItems(nextBatch(snapshot, FLUSH_BATCH))) {
        let ok = false
        try {
          const res = await fetch(`/api/admin/checkin/guests/${item.guestId}`, {
            method: 'POST', headers, body: JSON.stringify({ at: item.at, token: item.token }),
          })
          ok = res.ok
        } catch {
          ok = false // network is down; stop hammering after this item
        }
        await mutateQueue((current) => (
          ok ? asQueuedItems(markSynced(current, item.guestId)) : asQueuedItems(markFailed(current, item.guestId))
        ))
        if (!ok) break
      }
    } finally {
      isFlushingRef.current = false
    }
  }, [mutateQueue]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    loadQueue().then((items) => setQueue(asQueuedItems(items))).catch(() => undefined)
  }, [])

  useEffect(() => {
    const onOnline = () => void flush()
    window.addEventListener('online', onOnline)
    const timer = setInterval(() => { if (navigator.onLine) void flush() }, FLUSH_INTERVAL_MS)
    return () => {
      window.removeEventListener('online', onOnline)
      clearInterval(timer)
    }
  }, [flush])

  // ---------------------------------------------------------------- resolve
  const resolve = useCallback(async (scanned: string) => {
    const token = extractToken(scanned, appUrl)
    if (!token) { setStatus('That is not an invitation for this event'); return }
    if (token === lastScan.current) return
    lastScan.current = token
    setStatus('Looking up…')
    try {
      const res = await fetch('/api/admin/checkin/resolve', {
        method: 'POST', headers, body: JSON.stringify({ token }),
      })
      if (res.status === 404) { setStatus('Invitation not found — it may have been regenerated'); return }
      if (!res.ok) { setStatus('Not signed in — reload the page'); return }
      const resolved = (await res.json()) as Party
      setParty(resolved)
      // The token from THIS successful resolve is what scopes every
      // check-in/undo write for this party (I3) — including queued items
      // replayed after a reload, so it travels with each queue entry too.
      partyTokenRef.current = token
      setStatus(`Found ${resolved.label} — tap a guest to check in`)
    } catch {
      setStatus(online ? 'Could not reach the server' : 'Offline — check-ins will sync later')
    }
  }, [appUrl, online]) // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------------------------------------------------------- camera
  useEffect(() => {
    const video = videoRef.current
    if (!video || !navigator.mediaDevices?.getUserMedia) return undefined
    let stream: MediaStream | null = null
    let stop = false
    let detector: Detector | null = null

    const loop = async () => {
      while (!stop) {
        if (detector && video.readyState >= 2) {
          try {
            const codes = await detector.detect(video)
            if (codes[0]?.rawValue) await resolve(codes[0].rawValue)
          } catch { /* a frame failed to decode; keep going */ }
        }
        await new Promise((r) => setTimeout(r, 250))
      }
    }

    ;(async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
        video.srcObject = stream
        await video.play()
        const Native = (window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => Detector }).BarcodeDetector
        if (Native) {
          detector = new Native({ formats: ['qr_code'] })
        } else {
          // iOS Safari path only — loaded on demand so Chrome never pays for it.
          const { BrowserQRCodeReader } = await import('@zxing/browser')
          const reader = new BrowserQRCodeReader()
          detector = {
            detect: async (source) => {
              try {
                const result = await reader.decodeOnceFromVideoElement(source as HTMLVideoElement)
                return [{ rawValue: result.getText() }]
              } catch { return [] }
            },
          }
        }
        void loop()
      } catch {
        setStatus('Camera unavailable — paste the invitation link below')
      }
    })()

    return () => {
      stop = true
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [resolve])

  // ---------------------------------------------------------------- actions
  const pending = new Set(queue.map((q) => q.guestId))

  const checkIn = async (guest: PartyGuest) => {
    const token = partyTokenRef.current
    if (!token) return
    const at = new Date().toISOString()
    setParty((p) => p && { ...p, guests: p.guests.map((g) => (g.id === guest.id ? { ...g, checkedInAt: new Date(at) } : g)) })
    await mutateQueue((current) => enqueueWithToken(current, guest.id, at, token))
    setStatus(`Checked in ${guestDisplayName(guest)}`)
    if (navigator.onLine) void flush()
  }

  const undo = async (guest: PartyGuest) => {
    const token = partyTokenRef.current
    if (!token) return
    setParty((p) => p && { ...p, guests: p.guests.map((g) => (g.id === guest.id ? { ...g, checkedInAt: null } : g)) })
    await mutateQueue((current) => asQueuedItems(markSynced(current, guest.id)))
    setStatus(`Undid check-in for ${guestDisplayName(guest)}`)
    await fetch(`/api/admin/checkin/guests/${guest.id}`, {
      method: 'DELETE', headers, body: JSON.stringify({ token }),
    }).catch(() => undefined)
  }

  return (
    <div className="space-y-6">
      <div className="relative overflow-hidden rounded-lg bg-black">
        <video ref={videoRef} muted playsInline className="block aspect-[4/3] w-full object-cover" data-testid="scanner-video" />
        {!online ? (
          <span className="absolute left-3 top-3 rounded bg-[var(--danger)] px-2 py-1 text-xs text-white">Offline</span>
        ) : null}
        {queue.length > 0 ? (
          <span className="absolute right-3 top-3 rounded bg-[var(--brass)] px-2 py-1 text-xs text-[var(--on-brass)]" data-testid="unsynced-count">
            {queue.length} to sync
          </span>
        ) : null}
      </div>

      {/*
        No <form> element: before hydration (or if this chunk fails to
        load) a native <form> with no action/method does a plain GET to
        this page with the invite token in the query string — a party
        credential in the URL, browser history, and every access log
        (C2). An input plus explicit handlers can never submit natively.
      */}
      <div className="flex gap-2">
        <label className="sr-only" htmlFor="invite-link">Invitation link</label>
        <input
          id="invite-link"
          ref={linkInputRef}
          disabled={!mounted}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return
            e.preventDefault()
            void resolve(linkInputRef.current?.value ?? '')
          }}
          placeholder="Or paste an invitation link"
          className="min-h-12 flex-1 rounded border border-[var(--color-border)] bg-[var(--surface)] px-3 disabled:opacity-60"
        />
        <button
          type="button"
          disabled={!mounted}
          onClick={() => void resolve(linkInputRef.current?.value ?? '')}
          className="min-h-12 rounded bg-[var(--brass)] px-4 font-medium text-[var(--on-brass)] disabled:opacity-60"
        >
          Find
        </button>
      </div>

      {/* Permanently mounted so every state change is reliably announced (I10), including a successful check-in. */}
      <p aria-live="polite" className="text-sm text-[var(--text-muted)]">{status}</p>

      {party ? <PartyCard party={party} pending={pending} onCheckIn={checkIn} onUndo={undo} /> : null}
    </div>
  )
}

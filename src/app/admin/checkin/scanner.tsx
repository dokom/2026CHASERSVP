'use client'

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { Party, PartyGuest } from '@/lib/checkin/repository'
import { enqueue, markFailed, markSynced, nextBatch, type QueuedCheckIn } from '@/lib/checkin/queue'
import { loadQueue, saveQueue } from '@/lib/checkin/idb'
import { extractToken } from '@/lib/validation/checkin'
import { PartyCard } from './party-card'

const FLUSH_INTERVAL_MS = 15_000
const FLUSH_BATCH = 10

type Detector = { detect: (source: ImageBitmapSource) => Promise<{ rawValue: string }[]> }

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
  const [party, setParty] = useState<Party | null>(null)
  const [queue, setQueue] = useState<QueuedCheckIn[]>([])
  const [status, setStatus] = useState<string>('Point the camera at an invitation')
  const online = useSyncExternalStore(subscribeOnline, getOnlineSnapshot, getServerOnlineSnapshot)
  const lastScan = useRef<string>('')

  const headers = { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }

  // ---------------------------------------------------------------- queue
  const persist = useCallback(async (next: QueuedCheckIn[]) => {
    setQueue(next)
    await saveQueue(next).catch(() => undefined)
  }, [])

  const flush = useCallback(async () => {
    let current = await loadQueue().catch(() => [] as QueuedCheckIn[])
    for (const item of nextBatch(current, FLUSH_BATCH)) {
      try {
        const res = await fetch(`/api/admin/checkin/guests/${item.guestId}`, {
          method: 'POST', headers, body: JSON.stringify({ at: item.at }),
        })
        current = res.ok ? markSynced(current, item.guestId) : markFailed(current, item.guestId)
        if (!res.ok) break
      } catch {
        current = markFailed(current, item.guestId)
        break // network is down; stop hammering
      }
    }
    await persist(current)
  }, [persist]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    loadQueue().then(setQueue).catch(() => undefined)
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
      setParty(await res.json())
      setStatus('')
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
    const at = new Date().toISOString()
    setParty((p) => p && { ...p, guests: p.guests.map((g) => (g.id === guest.id ? { ...g, checkedInAt: new Date(at) } : g)) })
    await persist(enqueue(queue, guest.id, at))
    if (navigator.onLine) void flush()
  }

  const undo = async (guest: PartyGuest) => {
    setParty((p) => p && { ...p, guests: p.guests.map((g) => (g.id === guest.id ? { ...g, checkedInAt: null } : g)) })
    await persist(markSynced(queue, guest.id))
    await fetch(`/api/admin/checkin/guests/${guest.id}`, { method: 'DELETE', headers }).catch(() => undefined)
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

      <form
        onSubmit={(e) => { e.preventDefault(); void resolve(String(new FormData(e.currentTarget).get('link') ?? '')) }}
        className="flex gap-2"
      >
        <label className="sr-only" htmlFor="invite-link">Invitation link</label>
        <input id="invite-link" name="link" placeholder="Or paste an invitation link" className="min-h-12 flex-1 rounded border border-[var(--color-border)] bg-[var(--surface)] px-3" />
        <button type="submit" className="min-h-12 rounded bg-[var(--brass)] px-4 font-medium text-[var(--on-brass)]">Find</button>
      </form>

      {status ? <p role="status" className="text-sm text-[var(--text-muted)]">{status}</p> : null}

      {party ? <PartyCard party={party} pending={pending} onCheckIn={checkIn} onUndo={undo} /> : null}
    </div>
  )
}

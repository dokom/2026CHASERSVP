import type { QueuedCheckIn } from './queue'

const DB = 'gala-checkin'
const STORE = 'queue'
const KEY = 'pending'

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

/** Browser-only. Covered by the offline end-to-end test, not by Vitest. */
export async function loadQueue(): Promise<QueuedCheckIn[]> {
  const db = await open()
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(KEY)
    req.onsuccess = () => resolve((req.result as QueuedCheckIn[] | undefined) ?? [])
    req.onerror = () => reject(req.error)
  })
}

export async function saveQueue(queue: QueuedCheckIn[]): Promise<void> {
  const db = await open()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(queue, KEY)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

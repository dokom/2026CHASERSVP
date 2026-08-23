# Check-in, Analytics & Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the system operable on the night — door staff check guests in from a phone, organisers watch responses and meal counts live, every list exports, every change is auditable — and close the hardening items three reviews deferred.

**Architecture:** Same shape as Plans 1–3: framework-free modules under `src/lib/` that take a `PrismaClient`, thin route handlers and pages that validate with Zod, call a lib function, and audit inside the transaction. Two new ideas: the **check-in scanner** is a client component that talks to two small JSON routes and keeps an **offline queue** in IndexedDB, because venue Wi-Fi is assumed to fail; and the **dashboard** is computed by one lib function from the data already there, rendered as CSS bars — no chart library.

**Tech Stack:** Unchanged, plus `@zxing/browser@0.2.1` (QR decoding where the native `BarcodeDetector` is absent — iOS Safari; the spec names it) and `@axe-core/playwright@4.13.0` (devDependency; automated accessibility checks). Nothing else.

**Spec:** `docs/superpowers/specs/2026-08-21-gala-rsvp-portal-design.md` — §10 (the `/admin/guests`, `/admin/audit`, `/admin/checkin` and dashboard rows), §10.3 (check-in scanner), §11 (security), §12 (testing), §4 (success criteria), §13 phases 6–8.

**Plans 1–3:** each carries an **AS-BUILT DIVERGENCES** section. The working tree is the source of truth.

**A note on specificity.** Tasks 6 and 7 specify their repositories and integration tests by an enumerated assertion list rather than verbatim code. Both mirror `src/lib/invites/repository.ts` and `tests/integration/invites.test.ts` from Plan 1 line for line in shape — read those first and follow them. Every other task carries its code.

---

## Two Plan 1 gaps this plan closes

`src/app/admin/nav.tsx` links to `/admin/guests` and `/admin/audit`. **Neither page exists** — an ADMIN or OWNER clicking either link gets a 404 today. Both were spec §10 routes scheduled for this phase; Tasks 6 and 7 build them.

## Global Constraints

Everything binding in Plans 1–3 still binds. Specific to this plan:

- **The scanner is STAFF-reachable and nothing else is.** Every check-in route calls `requireRole('STAFF')`; every other new route calls `requireRole('ADMIN')`, and `/admin/audit` calls `requireRole('OWNER')`. STAFF must never be able to read the guest list, the dashboard, or an export.
- **Invite tokens arrive in a POST body, never a URL.** The scanner decodes a URL from the QR code, extracts the token, and POSTs it. A token in a query string lands in access logs.
- **Check-in is idempotent.** Re-checking-in an already-checked-in guest is a no-op that reports the original time — never an error, never a second audit row. The offline queue will replay, so this is load-bearing.
- **Offline is the normal case, not the error case.** A check-in tapped with no network is queued in IndexedDB, shown as unsynced, and flushed when `online` fires. The UI never blocks on the network.
- **CSV output is injection-safe.** Any cell beginning with `=`, `+`, `-`, `@`, tab or CR is prefixed with `'` before quoting. Guest-supplied names and notes go into spreadsheets that open in Excel.
- **No chart library.** The dashboard is stat tiles and horizontal bars in CSS, sized by data, labelled in text, one accent, legible in both themes. Data visualisation is part of the design system, not a dependency.
- **Camera needs a secure context.** `getUserMedia` works on `localhost` and on HTTPS only. The README must say so; production must be HTTPS.
- **Every task runs `npm run typecheck` and `npm run lint`.** Tasks touching pages also run `npm run build` — one agent at a time. Dependencies: only the two named above, at exactly those versions.

---

## File Structure

**Check-in**
- `src/lib/checkin/repository.ts` — resolve a party, check in, undo, progress
- `src/lib/checkin/queue.ts` — pure offline-queue reducer
- `src/lib/checkin/idb.ts` — tiny IndexedDB adapter (browser-only, E2E-covered)
- `src/lib/validation/checkin.ts` — Zod
- `src/app/api/admin/checkin/resolve/route.ts`, `src/app/api/admin/checkin/guests/[id]/route.ts`
- `src/app/admin/checkin/page.tsx` *(replaces the placeholder)*, `scanner.tsx`, `party-card.tsx`

**Analytics and lists**
- `src/lib/stats/rsvp.ts` — dashboard numbers
- `src/lib/guests/repository.ts`, `src/lib/guests/export.ts`
- `src/lib/audit/query.ts`
- `src/app/admin/page.tsx` *(replaces the placeholder)*, `src/components/admin/stat-tile.tsx`, `bar-list.tsx`
- `src/app/admin/guests/page.tsx`, `src/app/api/admin/guests/export/route.ts`
- `src/app/admin/audit/page.tsx`

**Hardening**
- `src/proxy.ts` *(renamed from `middleware.ts`; adds the per-request CSP nonce)*
- `next.config.ts` *(CSP comment removed; static headers stay)*
- `src/app/i/[token]/page.tsx` — desktop composition at `lg`
- `tests/e2e/checkin.spec.ts`, `dashboard.spec.ts`, `a11y.spec.ts`, `csp.spec.ts`, `perf.spec.ts`
- `README.md`, `.github/workflows/ci.yml`

---

## Task 1: Check-in repository

**Files:**
- Create: `src/lib/checkin/repository.ts`
- Test: `tests/integration/checkin.test.ts`

**Interfaces:**
- Consumes: `hashToken`, `writeAudit`
- Produces:
  - `type PartyGuest = { id, firstName, lastName, badgeName, company, tableNumber, attending, checkedInAt }`
  - `type Party = { inviteId, label, tableNumber, guests: PartyGuest[] }`
  - `resolvePartyByToken(db, token): Promise<Party | null>`
  - `checkInGuest(db, actorId, guestId, at): Promise<CheckInResult>` — `{ ok: true; checkedInAt: Date; alreadyCheckedIn: boolean; wasDeclined: boolean } | { ok: false; reason: 'NOT_FOUND' }`
  - `undoCheckIn(db, actorId, guestId): Promise<{ ok: boolean }>`
  - `checkInProgress(db): Promise<{ attending: number; checkedIn: number }>`

**A declined guest who turns up is checked in, not refused.** Reality at the door beats the RSVP. The result flags `wasDeclined` so the UI can say so, and the audit row records it.

- [ ] **Step 1: Write the failing test**

`tests/integration/checkin.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { testDb, resetDb } from '../helpers/db'
import { resolvePartyByToken, checkInGuest, undoCheckIn, checkInProgress } from '@/lib/checkin/repository'
import { createInvite } from '@/lib/invites/repository'

const AT = new Date('2026-11-14T18:12:00Z')

beforeEach(resetDb)
afterAll(() => testDb.$disconnect())

async function seed() {
  const staff = await testDb.adminUser.create({
    data: { email: 'door@example.com', name: 'Door', passwordHash: 'x', role: 'STAFF' },
  })
  const { invite, token } = await createInvite(testDb, null, {
    label: 'Reyes Party', seatsAllotted: 2, tableNumber: '12',
    primaryGuest: { firstName: 'Jordan', lastName: 'Reyes' },
  })
  const sam = await testDb.guest.create({
    data: { inviteId: invite.id, firstName: 'Sam', lastName: 'Reyes', attending: true },
  })
  await testDb.guest.updateMany({ where: { inviteId: invite.id, isPrimary: true }, data: { attending: true } })
  return { staff, invite, token, sam }
}

describe('resolvePartyByToken', () => {
  it('returns the party with check-in state', async () => {
    const { token } = await seed()
    const party = await resolvePartyByToken(testDb, token)
    expect(party?.label).toBe('Reyes Party')
    expect(party?.tableNumber).toBe('12')
    expect(party?.guests).toHaveLength(2)
    expect(party?.guests.every((g) => g.checkedInAt === null)).toBe(true)
  })

  it('returns null for an unknown or empty token', async () => {
    expect(await resolvePartyByToken(testDb, 'nope')).toBeNull()
    expect(await resolvePartyByToken(testDb, '')).toBeNull()
  })

  it('never exposes the token hash', async () => {
    const { token } = await seed()
    expect(JSON.stringify(await resolvePartyByToken(testDb, token))).not.toContain('tokenHash')
  })
})

describe('checkInGuest', () => {
  it('checks a guest in and audits it with the staff actor', async () => {
    const { staff, sam } = await seed()
    const result = await checkInGuest(testDb, staff.id, sam.id, AT)
    expect(result).toMatchObject({ ok: true, alreadyCheckedIn: false, wasDeclined: false })
    const fresh = await testDb.guest.findUniqueOrThrow({ where: { id: sam.id } })
    expect(fresh.checkedInAt).toEqual(AT)
    expect(fresh.checkedInById).toBe(staff.id)
    const log = await testDb.auditLog.findFirst({ where: { action: 'guest.checkIn' } })
    expect(log?.actorId).toBe(staff.id)
  })

  it('is IDEMPOTENT: a second check-in reports the original time and writes nothing', async () => {
    const { staff, sam } = await seed()
    await checkInGuest(testDb, staff.id, sam.id, AT)
    const later = new Date('2026-11-14T19:00:00Z')
    const second = await checkInGuest(testDb, staff.id, sam.id, later)
    expect(second).toMatchObject({ ok: true, alreadyCheckedIn: true })
    if (second.ok) expect(second.checkedInAt).toEqual(AT)
    expect(await testDb.auditLog.count({ where: { action: 'guest.checkIn' } })).toBe(1)
  })

  it('checks in a guest who had declined, and says so', async () => {
    const { staff, sam } = await seed()
    await testDb.guest.update({ where: { id: sam.id }, data: { attending: false } })
    const result = await checkInGuest(testDb, staff.id, sam.id, AT)
    expect(result).toMatchObject({ ok: true, wasDeclined: true })
    const log = await testDb.auditLog.findFirst({ where: { action: 'guest.checkIn' } })
    expect((log?.meta as Record<string, unknown>).wasDeclined).toBe(true)
  })

  it('returns NOT_FOUND for an unknown id', async () => {
    const { staff } = await seed()
    expect(await checkInGuest(testDb, staff.id, '0'.repeat(24), AT)).toEqual({ ok: false, reason: 'NOT_FOUND' })
  })

  it('returns NOT_FOUND rather than throwing for a malformed id', async () => {
    const { staff } = await seed()
    await expect(checkInGuest(testDb, staff.id, 'not-an-objectid', AT))
      .resolves.toEqual({ ok: false, reason: 'NOT_FOUND' })
  })
})

describe('undoCheckIn', () => {
  it('clears the check-in and audits it', async () => {
    const { staff, sam } = await seed()
    await checkInGuest(testDb, staff.id, sam.id, AT)
    expect(await undoCheckIn(testDb, staff.id, sam.id)).toEqual({ ok: true })
    const fresh = await testDb.guest.findUniqueOrThrow({ where: { id: sam.id } })
    expect(fresh.checkedInAt).toBeNull()
    expect(fresh.checkedInById).toBeNull()
    expect(await testDb.auditLog.count({ where: { action: 'guest.undoCheckIn' } })).toBe(1)
  })

  it('is a no-op on a guest who was never checked in', async () => {
    const { staff, sam } = await seed()
    expect(await undoCheckIn(testDb, staff.id, sam.id)).toEqual({ ok: true })
    expect(await testDb.auditLog.count({ where: { action: 'guest.undoCheckIn' } })).toBe(0)
  })
})

describe('checkInProgress', () => {
  it('counts attending guests and how many have arrived', async () => {
    const { staff, sam } = await seed()
    await checkInGuest(testDb, staff.id, sam.id, AT)
    expect(await checkInProgress(testDb)).toEqual({ attending: 2, checkedIn: 1 })
  })
})
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `DATABASE_URL_TEST="mongodb://127.0.0.1:27018/gala_test_p4a?replicaSet=rs0" npx vitest run tests/integration/checkin.test.ts`
Expected: FAIL — cannot resolve `@/lib/checkin/repository`.

- [ ] **Step 3: Implement `src/lib/checkin/repository.ts`**

```ts
import type { PrismaClient } from '@prisma/client'
import { hashToken } from '@/lib/crypto/tokens'
import { writeAudit } from '@/lib/audit'

export type PartyGuest = {
  id: string
  firstName: string
  lastName: string
  badgeName: string | null
  company: string | null
  tableNumber: string | null
  attending: boolean | null
  checkedInAt: Date | null
}

export type Party = {
  inviteId: string
  label: string
  tableNumber: string | null
  guests: PartyGuest[]
}

export type CheckInResult =
  | { ok: true; checkedInAt: Date; alreadyCheckedIn: boolean; wasDeclined: boolean }
  | { ok: false; reason: 'NOT_FOUND' }

function isMalformedIdError(error: unknown): boolean {
  return error instanceof Error && /malformed objectid/i.test(error.message)
}

/** What the door sees after a scan. Lookup is by tokenHash, never by id. */
export async function resolvePartyByToken(db: PrismaClient, token: string): Promise<Party | null> {
  if (!token) return null
  const invite = await db.invite.findUnique({
    where: { tokenHash: hashToken(token) },
    select: {
      id: true, label: true, tableNumber: true,
      guests: {
        select: {
          id: true, firstName: true, lastName: true, badgeName: true, company: true,
          tableNumber: true, attending: true, checkedInAt: true,
        },
        orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
      },
    },
  })
  if (!invite) return null
  return { inviteId: invite.id, label: invite.label, tableNumber: invite.tableNumber, guests: invite.guests }
}

/**
 * Idempotent by design: the offline queue replays, and a staff member will
 * double-tap. A second check-in reports the ORIGINAL time and writes nothing.
 * A guest who declined and turned up anyway is checked in — reality at the
 * door beats the RSVP — and the result says so.
 */
export async function checkInGuest(
  db: PrismaClient, actorId: string, guestId: string, at: Date,
): Promise<CheckInResult> {
  const guest = await db.guest
    .findUnique({ where: { id: guestId }, select: { id: true, attending: true, checkedInAt: true } })
    .catch((error: unknown) => { if (isMalformedIdError(error)) return null; throw error })
  if (!guest) return { ok: false, reason: 'NOT_FOUND' }

  const wasDeclined = guest.attending === false
  if (guest.checkedInAt) {
    return { ok: true, checkedInAt: guest.checkedInAt, alreadyCheckedIn: true, wasDeclined }
  }

  await db.$transaction(async (tx) => {
    await tx.guest.update({ where: { id: guestId }, data: { checkedInAt: at, checkedInById: actorId } })
    await writeAudit(tx, {
      actorId, action: 'guest.checkIn', entity: 'Guest', entityId: guestId,
      meta: { at: at.toISOString(), wasDeclined },
    })
  })
  return { ok: true, checkedInAt: at, alreadyCheckedIn: false, wasDeclined }
}

export async function undoCheckIn(db: PrismaClient, actorId: string, guestId: string): Promise<{ ok: boolean }> {
  const guest = await db.guest
    .findUnique({ where: { id: guestId }, select: { checkedInAt: true } })
    .catch((error: unknown) => { if (isMalformedIdError(error)) return null; throw error })
  if (!guest) return { ok: false }
  if (!guest.checkedInAt) return { ok: true }

  await db.$transaction(async (tx) => {
    await tx.guest.update({ where: { id: guestId }, data: { checkedInAt: null, checkedInById: null } })
    await writeAudit(tx, { actorId, action: 'guest.undoCheckIn', entity: 'Guest', entityId: guestId })
  })
  return { ok: true }
}

export async function checkInProgress(db: PrismaClient): Promise<{ attending: number; checkedIn: number }> {
  const [attending, checkedIn] = await Promise.all([
    db.guest.count({ where: { attending: true } }),
    db.guest.count({ where: { checkedInAt: { not: null } } }),
  ])
  return { attending, checkedIn }
}
```

- [ ] **Step 4: Run it and confirm it passes**

Run: `DATABASE_URL_TEST="mongodb://127.0.0.1:27018/gala_test_p4a?replicaSet=rs0" npx vitest run tests/integration/checkin.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 5: Verify and commit**

```bash
npm run typecheck 2>&1 | grep -v "^>"
npm run lint
git add src/lib/checkin/repository.ts tests/integration/checkin.test.ts
git commit -m "feat: check-in repository, idempotent by design"
```

---

## Task 2: Offline queue

**Files:**
- Create: `src/lib/checkin/queue.ts`, `src/lib/checkin/idb.ts`
- Test: `tests/unit/checkin-queue.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `type QueuedCheckIn = { guestId: string; at: string; attempts: number }`
  - `enqueue(queue, guestId, at): QueuedCheckIn[]` — deduped by `guestId`; the first `at` wins
  - `markSynced(queue, guestId): QueuedCheckIn[]`
  - `markFailed(queue, guestId): QueuedCheckIn[]` — increments `attempts`
  - `nextBatch(queue, max): QueuedCheckIn[]` — oldest first, skipping items past `MAX_ATTEMPTS`
  - `MAX_ATTEMPTS = 5`
  - `idb.ts`: `loadQueue(): Promise<QueuedCheckIn[]>`, `saveQueue(q): Promise<void>` — browser only, a dozen lines over `indexedDB`

The reducer is pure and immutable — every function returns a new array. That is what makes the queue testable in Node without a browser, and what keeps React state honest.

- [ ] **Step 1: Write the failing test**

`tests/unit/checkin-queue.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { enqueue, markSynced, markFailed, nextBatch, MAX_ATTEMPTS } from '@/lib/checkin/queue'

const T1 = '2026-11-14T18:00:00.000Z'
const T2 = '2026-11-14T18:05:00.000Z'

describe('offline check-in queue', () => {
  it('enqueues a check-in', () => {
    expect(enqueue([], 'g1', T1)).toEqual([{ guestId: 'g1', at: T1, attempts: 0 }])
  })

  it('dedupes by guest and keeps the FIRST time — a double-tap is one arrival', () => {
    const q = enqueue(enqueue([], 'g1', T1), 'g1', T2)
    expect(q).toHaveLength(1)
    expect(q[0]?.at).toBe(T1)
  })

  it('never mutates its input', () => {
    const before = enqueue([], 'g1', T1)
    const snapshot = JSON.stringify(before)
    enqueue(before, 'g2', T2)
    markFailed(before, 'g1')
    markSynced(before, 'g1')
    expect(JSON.stringify(before)).toBe(snapshot)
  })

  it('removes a synced item', () => {
    const q = enqueue(enqueue([], 'g1', T1), 'g2', T2)
    expect(markSynced(q, 'g1').map((i) => i.guestId)).toEqual(['g2'])
  })

  it('counts failures', () => {
    const q = markFailed(markFailed(enqueue([], 'g1', T1), 'g1'), 'g1')
    expect(q[0]?.attempts).toBe(2)
  })

  it('flushes oldest first, up to the batch size', () => {
    const q = enqueue(enqueue(enqueue([], 'g1', T1), 'g2', T2), 'g3', T2)
    expect(nextBatch(q, 2).map((i) => i.guestId)).toEqual(['g1', 'g2'])
  })

  it('gives up on an item past the attempt cap, but keeps it for inspection', () => {
    let q = enqueue([], 'g1', T1)
    for (let i = 0; i < MAX_ATTEMPTS; i++) q = markFailed(q, 'g1')
    expect(nextBatch(q, 10)).toEqual([])
    expect(q).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run tests/unit/checkin-queue.test.ts`
Expected: FAIL — cannot resolve `@/lib/checkin/queue`.

- [ ] **Step 3: Implement both files**

`src/lib/checkin/queue.ts`:

```ts
export type QueuedCheckIn = { guestId: string; at: string; attempts: number }

export const MAX_ATTEMPTS = 5

/** A double-tap is one arrival: the first time wins and the duplicate is dropped. */
export function enqueue(queue: QueuedCheckIn[], guestId: string, at: string): QueuedCheckIn[] {
  if (queue.some((item) => item.guestId === guestId)) return queue
  return [...queue, { guestId, at, attempts: 0 }]
}

export function markSynced(queue: QueuedCheckIn[], guestId: string): QueuedCheckIn[] {
  return queue.filter((item) => item.guestId !== guestId)
}

export function markFailed(queue: QueuedCheckIn[], guestId: string): QueuedCheckIn[] {
  return queue.map((item) => (item.guestId === guestId ? { ...item, attempts: item.attempts + 1 } : item))
}

/** Oldest first; items past the cap stay in the queue for inspection but are not retried. */
export function nextBatch(queue: QueuedCheckIn[], max: number): QueuedCheckIn[] {
  return queue.filter((item) => item.attempts < MAX_ATTEMPTS).slice(0, max)
}
```

`src/lib/checkin/idb.ts`:

```ts
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
```

- [ ] **Step 4: Run it and confirm it passes**

Run: `npx vitest run tests/unit/checkin-queue.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Verify and commit**

```bash
npm run typecheck 2>&1 | grep -v "^>"
npm run lint
git add src/lib/checkin/queue.ts src/lib/checkin/idb.ts tests/unit/checkin-queue.test.ts
git commit -m "feat: offline check-in queue"
```

---

## Task 3: Check-in API routes

**Files:**
- Create: `src/lib/validation/checkin.ts`, `src/app/api/admin/checkin/resolve/route.ts`, `src/app/api/admin/checkin/guests/[id]/route.ts`
- Test: typecheck, lint; behaviour covered by Task 9's end-to-end suite

**Interfaces:**
- Consumes: Task 1; `requireRole`; `verifyCsrfToken`, `CSRF_COOKIE`
- Produces:
  - `POST /api/admin/checkin/resolve` — body `{ token }` → `Party` JSON or 404
  - `POST /api/admin/checkin/guests/[id]` — body `{ at }` → `CheckInResult`
  - `DELETE /api/admin/checkin/guests/[id]` → `{ ok }`
  - `extractToken(scanned: string, appUrl: string): string | null` in `validation/checkin.ts` — pulls the token out of a scanned `https://host/i/<token>` URL and rejects anything else

**CSRF for JSON routes.** Server Actions carry the CSRF field in the form; these are `fetch` calls, so they carry it in an `X-CSRF-Token` header, verified against the same `gala_csrf` cookie with the same `verifyCsrfToken`. The cookie is httpOnly, so the page must pass the value to the client component as a prop (read-only, as every other page does).

- [ ] **Step 1: Implement `src/lib/validation/checkin.ts`**

```ts
import { z } from 'zod'

export const resolveSchema = z.object({ token: z.string().min(1).max(64) })
export const checkInSchema = z.object({ at: z.coerce.date() })
export const guestIdSchema = z.string().regex(/^[0-9a-f]{24}$/)

/**
 * A QR code encodes https://<host>/i/<token>. Accept only that shape, on our
 * own host, so a scanned code for some other site cannot be posted as a token.
 */
export function extractToken(scanned: string, appUrl: string): string | null {
  let url: URL
  try { url = new URL(scanned.trim()) } catch { return null }
  const app = new URL(appUrl)
  if (url.origin !== app.origin) return null
  const match = /^\/i\/([A-Za-z0-9_-]{32})\/?$/.exec(url.pathname)
  return match?.[1] ?? null
}
```

`tests/unit/extract-token.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { extractToken } from '@/lib/validation/checkin'

const APP = 'https://gala.example.com'
const TOKEN = 'A'.repeat(32)

describe('extractToken', () => {
  it('pulls the token out of a valid invite URL', () => {
    expect(extractToken(`${APP}/i/${TOKEN}`, APP)).toBe(TOKEN)
  })
  it('tolerates a trailing slash and surrounding whitespace', () => {
    expect(extractToken(`  ${APP}/i/${TOKEN}/ `, APP)).toBe(TOKEN)
  })
  it('REJECTS a foreign origin — a QR code for another site is not a token', () => {
    expect(extractToken(`https://evil.example/i/${TOKEN}`, APP)).toBeNull()
  })
  it('rejects a different port on the same host', () => {
    expect(extractToken(`https://gala.example.com:8443/i/${TOKEN}`, APP)).toBeNull()
  })
  it('rejects plain text that is not a URL', () => {
    expect(extractToken(TOKEN, APP)).toBeNull()
  })
  it('rejects a path that is not /i/', () => {
    expect(extractToken(`${APP}/admin/invites/${TOKEN}`, APP)).toBeNull()
  })
  it('rejects a token of the wrong length', () => {
    expect(extractToken(`${APP}/i/${'A'.repeat(31)}`, APP)).toBeNull()
    expect(extractToken(`${APP}/i/${'A'.repeat(33)}`, APP)).toBeNull()
  })
  it('rejects a token with characters outside base64url', () => {
    expect(extractToken(`${APP}/i/${'A'.repeat(31)}!`, APP)).toBeNull()
  })
})
```

- [ ] **Step 2: Implement the resolve route**

`src/app/api/admin/checkin/resolve/route.ts`:

```ts
import { cookies } from 'next/headers'
import { prisma } from '@/lib/db'
import { requireRole } from '@/lib/auth/guard'
import { CSRF_COOKIE, verifyCsrfToken } from '@/lib/auth/csrf'
import { resolveSchema } from '@/lib/validation/checkin'
import { resolvePartyByToken } from '@/lib/checkin/repository'

export const dynamic = 'force-dynamic'

export async function POST(request: Request): Promise<Response> {
  await requireRole('STAFF')
  const store = await cookies()
  if (!verifyCsrfToken(store.get(CSRF_COOKIE)?.value, request.headers.get('x-csrf-token'))) {
    return Response.json({ error: 'csrf' }, { status: 403 })
  }
  const parsed = resolveSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return Response.json({ error: 'invalid' }, { status: 400 })

  // The token is never logged and never echoed back.
  const party = await resolvePartyByToken(prisma, parsed.data.token)
  if (!party) return Response.json({ error: 'not_found' }, { status: 404, headers: { 'Cache-Control': 'no-store' } })
  return Response.json(party, { headers: { 'Cache-Control': 'no-store' } })
}
```

- [ ] **Step 3: Implement the guest route**

`src/app/api/admin/checkin/guests/[id]/route.ts`:

```ts
import { cookies } from 'next/headers'
import { prisma } from '@/lib/db'
import { requireRole } from '@/lib/auth/guard'
import { CSRF_COOKIE, verifyCsrfToken } from '@/lib/auth/csrf'
import { checkInSchema, guestIdSchema } from '@/lib/validation/checkin'
import { checkInGuest, undoCheckIn } from '@/lib/checkin/repository'

export const dynamic = 'force-dynamic'
const NO_STORE = { 'Cache-Control': 'no-store' }

async function guard(request: Request): Promise<{ actorId: string } | Response> {
  const user = await requireRole('STAFF')
  const store = await cookies()
  if (!verifyCsrfToken(store.get(CSRF_COOKIE)?.value, request.headers.get('x-csrf-token'))) {
    return Response.json({ error: 'csrf' }, { status: 403 })
  }
  return { actorId: user.id }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const g = await guard(request)
  if (g instanceof Response) return g
  const { id } = await params
  if (!guestIdSchema.safeParse(id).success) return Response.json({ error: 'invalid' }, { status: 400 })
  const parsed = checkInSchema.safeParse(await request.json().catch(() => ({})))
  const at = parsed.success ? parsed.data.at : new Date()
  const result = await checkInGuest(prisma, g.actorId, id, at)
  return Response.json(result, { status: result.ok ? 200 : 404, headers: NO_STORE })
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const g = await guard(request)
  if (g instanceof Response) return g
  const { id } = await params
  if (!guestIdSchema.safeParse(id).success) return Response.json({ error: 'invalid' }, { status: 400 })
  return Response.json(await undoCheckIn(prisma, g.actorId, id), { headers: NO_STORE })
}
```

Note `requireRole` redirects anonymous callers; for a `fetch` caller that surfaces as a redirect response. The scanner treats any non-2xx as "not signed in — reload".

- [ ] **Step 4: Verify and commit**

```bash
npx vitest run tests/unit/extract-token.test.ts
npm run typecheck 2>&1 | grep -v "^>"
npm run lint
git add src/lib/validation/checkin.ts src/app/api/admin/checkin tests/unit/extract-token.test.ts
git commit -m "feat: check-in API routes"
```

---

## Task 4: The scanner

**Files:**
- Create: `src/app/admin/checkin/scanner.tsx`, `src/app/admin/checkin/party-card.tsx`
- Modify: `src/app/admin/checkin/page.tsx` *(replace the placeholder)*
- Test: typecheck, lint, build; behaviour covered by Task 10

**Interfaces:**
- Consumes: Tasks 1–3; `useMotionMode` is NOT used — the scanner has no motion layer
- Produces: `<Scanner csrf appUrl />` client component; `<PartyCard party onCheckIn onUndo pending />`

**Design for a dim venue and one thumb.** Black ground, large type, tap targets at least 56px tall, the whole guest row is the button. Already-checked-in guests are visibly different (brass check, time) and the button becomes "Undo". A declined guest who appears shows "Declined on RSVP" above the button and is still checkable. The camera view is the top third; the party fills the rest. A text field under the camera accepts a pasted or typed invite URL for when the camera cannot be used.

**Decoding.** `BarcodeDetector` with `formats: ['qr_code']` where the browser has it (Chrome, Android). Otherwise `@zxing/browser`'s `BrowserQRCodeReader`, loaded with a dynamic `import()` **only in that branch** so Chrome never downloads it. Both feed the same `onDecoded(text)`.

**Offline.** On tap: update UI optimistically, `enqueue`, `saveQueue`, then try to flush. Flush POSTs each queued item; on success `markSynced`, on network failure `markFailed` and stop. Flush again on `window` `online` and every 15s while anything is queued. An unsynced row shows a small "will sync" tag. The queue survives reloads via IndexedDB.

- [ ] **Step 1: Implement `party-card.tsx`**

```tsx
'use client'

import type { Party, PartyGuest } from '@/lib/checkin/repository'

function formatTime(iso: string): string {
  return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(new Date(iso))
}

export function PartyCard({
  party, pending, onCheckIn, onUndo,
}: {
  party: Party
  /** guest ids queued but not yet confirmed by the server */
  pending: Set<string>
  onCheckIn: (guest: PartyGuest) => void
  onUndo: (guest: PartyGuest) => void
}) {
  return (
    <section aria-labelledby="party-heading" className="space-y-3">
      <h2 id="party-heading" className="font-serif text-2xl">
        {party.label}
        {party.tableNumber ? <span className="ml-3 text-[var(--brass-ink)]">Table {party.tableNumber}</span> : null}
      </h2>
      <ul className="space-y-2">
        {party.guests.map((guest) => {
          const arrived = guest.checkedInAt !== null
          const queued = pending.has(guest.id)
          return (
            <li key={guest.id}>
              <button
                type="button"
                onClick={() => (arrived ? onUndo(guest) : onCheckIn(guest))}
                aria-pressed={arrived}
                className={`flex min-h-14 w-full items-center justify-between rounded-lg border px-4 py-3 text-left ${
                  arrived ? 'border-[var(--brass)] bg-[var(--surface)]' : 'border-[var(--color-border)]'
                }`}
              >
                <span>
                  <span className="block text-lg">{guest.badgeName || `${guest.firstName} ${guest.lastName}`}</span>
                  {guest.company ? <span className="block text-sm text-[var(--text-muted)]">{guest.company}</span> : null}
                  {guest.attending === false ? (
                    <span className="block text-xs text-[var(--danger)]">Declined on RSVP</span>
                  ) : null}
                </span>
                <span className="text-right text-sm">
                  {arrived ? (
                    <>
                      <span className="block text-[var(--brass-ink)]">✓ {formatTime(guest.checkedInAt!.toString())}</span>
                      <span className="block text-xs text-[var(--text-muted)]">{queued ? 'will sync' : 'tap to undo'}</span>
                    </>
                  ) : (
                    <span className="text-[var(--text-muted)]">Tap to check in</span>
                  )}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
```

- [ ] **Step 2: Implement `scanner.tsx`**

```tsx
'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { Party, PartyGuest } from '@/lib/checkin/repository'
import { enqueue, markFailed, markSynced, nextBatch, type QueuedCheckIn } from '@/lib/checkin/queue'
import { loadQueue, saveQueue } from '@/lib/checkin/idb'
import { extractToken } from '@/lib/validation/checkin'
import { PartyCard } from './party-card'

const FLUSH_INTERVAL_MS = 15_000
const FLUSH_BATCH = 10

type Detector = { detect: (source: ImageBitmapSource) => Promise<{ rawValue: string }[]> }

export function Scanner({ csrf, appUrl }: { csrf: string; appUrl: string }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [party, setParty] = useState<Party | null>(null)
  const [queue, setQueue] = useState<QueuedCheckIn[]>([])
  const [status, setStatus] = useState<string>('Point the camera at an invitation')
  const [online, setOnline] = useState(true)
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
    const onOnline = () => { setOnline(true); void flush() }
    const onOffline = () => setOnline(false)
    setOnline(navigator.onLine)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    const timer = setInterval(() => { if (navigator.onLine) void flush() }, FLUSH_INTERVAL_MS)
    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
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
                const result = await reader.decodeFromVideoElement(source as HTMLVideoElement)
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
```

- [ ] **Step 3: Replace `src/app/admin/checkin/page.tsx`**

```tsx
import { cookies } from 'next/headers'
import { prisma } from '@/lib/db'
import { getEnv } from '@/lib/env'
import { requireRole } from '@/lib/auth/guard'
import { CSRF_COOKIE } from '@/lib/auth/csrf'
import { checkInProgress } from '@/lib/checkin/repository'
import { Scanner } from './scanner'

export const dynamic = 'force-dynamic'

export default async function CheckinPage() {
  await requireRole('STAFF')
  const store = await cookies()
  const csrf = store.get(CSRF_COOKIE)?.value
  if (!csrf) throw new Error('CSRF cookie missing — check that src/proxy.ts matches this route')
  const progress = await checkInProgress(prisma)

  return (
    <section className="space-y-6">
      <div className="flex items-baseline justify-between">
        <h1 className="font-serif text-2xl">Check-in</h1>
        <p className="text-sm text-[var(--text-muted)]" data-testid="checkin-progress">
          {progress.checkedIn} of {progress.attending} arrived
        </p>
      </div>
      <Scanner csrf={csrf} appUrl={getEnv().APP_URL} />
    </section>
  )
}
```

- [ ] **Step 4: Install the decoder and verify**

```bash
npm install @zxing/browser@0.2.1
grep -rn "@zxing" src/ | grep -v "import('@zxing/browser')" && echo "LEAK: static import" || echo "zxing loaded only dynamically"
npm run typecheck 2>&1 | grep -v "^>"
npm run lint
npm run build && git checkout tsconfig.json
git add package.json package-lock.json src/app/admin/checkin
git commit -m "feat: door check-in scanner with offline queue"
```

---

## Task 5: Dashboard

**Files:**
- Create: `src/lib/stats/rsvp.ts`, `src/components/admin/stat-tile.tsx`, `src/components/admin/bar-list.tsx`
- Modify: `src/app/admin/page.tsx` *(replace the placeholder)*
- Test: `tests/integration/stats.test.ts`

**Interfaces:**
- Consumes: `checkInProgress` (Task 1)
- Produces:
  - `type Dashboard = { invites: { total, responded, attending, declined, partial, pending }; guests: { attending, checkedIn }; meals: { label, count, isActive }[]; responsesByDay: { date, count }[]; pendingExtraSeats: number }`
  - `dashboard(db, now): Promise<Dashboard>`

The numbers an organiser actually needs: how many parties have answered, how many people are coming, what the caterer should cook, how the responses arrived over time, who is waiting on an extra-seat decision, and — on the night — how many have walked in.

**Meal tallies include retired options.** A guest who chose a meal before it was retired still eats. Counting only active options under-orders.

- [ ] **Step 1: Write the failing test**

`tests/integration/stats.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { testDb, resetDb } from '../helpers/db'
import { dashboard } from '@/lib/stats/rsvp'

const NOW = new Date('2026-09-10T12:00:00Z')

beforeEach(resetDb)
afterAll(() => testDb.$disconnect())

async function seed() {
  const event = await testDb.event.create({
    data: {
      name: 'Gala', startsAt: new Date('2026-11-14T18:00:00Z'), venueName: 'Hall', address: 'x',
      rsvpDeadline: new Date('2026-10-24T23:59:00Z'),
      mealOptions: { create: [{ label: 'Beef', sortOrder: 0 }, { label: 'Fish', sortOrder: 1, isActive: false }] },
    },
    include: { mealOptions: true },
  })
  const [beef, fish] = event.mealOptions
  const mk = (label: string, status: 'PENDING' | 'ATTENDING' | 'DECLINED' | 'PARTIAL', respondedAt: Date | null, extra = 'NONE' as const) =>
    testDb.invite.create({ data: { tokenHash: label, tokenCipher: 'c', label, status, respondedAt, extraSeatsStatus: extra, seatsAllotted: 2 } })

  const a = await mk('A', 'ATTENDING', new Date('2026-09-01T10:00:00Z'))
  const b = await mk('B', 'ATTENDING', new Date('2026-09-01T15:00:00Z'))
  const c = await mk('C', 'DECLINED', new Date('2026-09-03T10:00:00Z'))
  const d = await mk('D', 'PARTIAL', new Date('2026-09-05T10:00:00Z'), 'PENDING')
  await mk('E', 'PENDING', null)

  await testDb.guest.createMany({ data: [
    { inviteId: a.id, firstName: 'A1', lastName: 'x', attending: true, mealOptionId: beef!.id, checkedInAt: NOW },
    { inviteId: a.id, firstName: 'A2', lastName: 'x', attending: true, mealOptionId: fish!.id },
    { inviteId: b.id, firstName: 'B1', lastName: 'x', attending: true, mealOptionId: beef!.id },
    { inviteId: c.id, firstName: 'C1', lastName: 'x', attending: false },
    { inviteId: d.id, firstName: 'D1', lastName: 'x', attending: true },
    { inviteId: d.id, firstName: 'D2', lastName: 'x', attending: false },
  ] })
}

describe('dashboard', () => {
  it('counts invites by status', async () => {
    await seed()
    const d = await dashboard(testDb, NOW)
    expect(d.invites).toEqual({ total: 5, responded: 4, attending: 2, declined: 1, partial: 1, pending: 1 })
  })

  it('counts people coming and arrived', async () => {
    await seed()
    const d = await dashboard(testDb, NOW)
    expect(d.guests).toEqual({ attending: 4, checkedIn: 1 })
  })

  it('tallies meals INCLUDING retired options — a retired choice still eats', async () => {
    await seed()
    const d = await dashboard(testDb, NOW)
    expect(d.meals).toEqual(expect.arrayContaining([
      { label: 'Beef', count: 2, isActive: true },
      { label: 'Fish', count: 1, isActive: false },
    ]))
  })

  it('counts only ATTENDING guests toward meals', async () => {
    await seed()
    // C1 declined; if it had a meal it must not count.
    const invite = await testDb.invite.findFirstOrThrow({ where: { label: 'C' } })
    const meal = await testDb.mealOption.findFirstOrThrow({ where: { label: 'Beef' } })
    await testDb.guest.updateMany({ where: { inviteId: invite.id }, data: { mealOptionId: meal.id } })
    const d = await dashboard(testDb, NOW)
    expect(d.meals.find((m) => m.label === 'Beef')?.count).toBe(2)
  })

  it('buckets responses by UTC day in ascending order', async () => {
    await seed()
    const d = await dashboard(testDb, NOW)
    expect(d.responsesByDay).toEqual([
      { date: '2026-09-01', count: 2 },
      { date: '2026-09-03', count: 1 },
      { date: '2026-09-05', count: 1 },
    ])
  })

  it('counts pending extra-seat requests', async () => {
    await seed()
    expect((await dashboard(testDb, NOW)).pendingExtraSeats).toBe(1)
  })

  it('is all zeros on an empty database rather than throwing', async () => {
    const d = await dashboard(testDb, NOW)
    expect(d.invites.total).toBe(0)
    expect(d.meals).toEqual([])
    expect(d.responsesByDay).toEqual([])
  })
})
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `DATABASE_URL_TEST="mongodb://127.0.0.1:27018/gala_test_p4b?replicaSet=rs0" npx vitest run tests/integration/stats.test.ts`
Expected: FAIL — cannot resolve `@/lib/stats/rsvp`.

- [ ] **Step 3: Implement `src/lib/stats/rsvp.ts`**

```ts
import type { PrismaClient } from '@prisma/client'
import { checkInProgress } from '@/lib/checkin/repository'

export type Dashboard = {
  invites: { total: number; responded: number; attending: number; declined: number; partial: number; pending: number }
  guests: { attending: number; checkedIn: number }
  meals: { label: string; count: number; isActive: boolean }[]
  responsesByDay: { date: string; count: number }[]
  pendingExtraSeats: number
}

const day = (d: Date) => d.toISOString().slice(0, 10)

export async function dashboard(db: PrismaClient, _now: Date): Promise<Dashboard> {
  const [byStatus, guests, meals, mealCounts, responded, pendingExtraSeats] = await Promise.all([
    db.invite.groupBy({ by: ['status'], _count: { _all: true } }),
    checkInProgress(db),
    db.mealOption.findMany({ select: { id: true, label: true, isActive: true }, orderBy: { sortOrder: 'asc' } }),
    // Only people who are coming eat. Retired options still count: the choice was made.
    db.guest.groupBy({ by: ['mealOptionId'], where: { attending: true, mealOptionId: { not: null } }, _count: { _all: true } }),
    db.invite.findMany({ where: { respondedAt: { not: null } }, select: { respondedAt: true }, orderBy: { respondedAt: 'asc' } }),
    db.invite.count({ where: { extraSeatsStatus: 'PENDING' } }),
  ])

  const count = (status: string) => byStatus.find((s) => s.status === status)?._count._all ?? 0
  const attending = count('ATTENDING'), declined = count('DECLINED'), partial = count('PARTIAL'), pending = count('PENDING')

  const countsByMeal = new Map(mealCounts.map((m) => [m.mealOptionId, m._count._all]))
  const byDay = new Map<string, number>()
  for (const r of responded) {
    const key = day(r.respondedAt!)
    byDay.set(key, (byDay.get(key) ?? 0) + 1)
  }

  return {
    invites: { total: attending + declined + partial + pending, responded: attending + declined + partial, attending, declined, partial, pending },
    guests,
    meals: meals.map((m) => ({ label: m.label, count: countsByMeal.get(m.id) ?? 0, isActive: m.isActive })),
    responsesByDay: [...byDay.entries()].map(([date, c]) => ({ date, count: c })),
    pendingExtraSeats,
  }
}
```

- [ ] **Step 4: Run it and confirm it passes**

Run: `DATABASE_URL_TEST="mongodb://127.0.0.1:27018/gala_test_p4b?replicaSet=rs0" npx vitest run tests/integration/stats.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: The two display components**

`src/components/admin/stat-tile.tsx`:

```tsx
export function StatTile({ label, value, hint }: { label: string; value: number | string; hint?: string }) {
  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--surface)] p-4">
      <p className="type-eyebrow">{label}</p>
      <p className="mt-1 font-serif text-4xl" data-stat={label}>{value}</p>
      {hint ? <p className="mt-1 text-xs text-[var(--text-muted)]">{hint}</p> : null}
    </div>
  )
}
```

`src/components/admin/bar-list.tsx` — one bar per row, width proportional to the max, the number always printed (the bar is a second reading, never the only one):

```tsx
export function BarList({ title, rows }: { title: string; rows: { label: string; count: number; muted?: boolean }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.count))
  return (
    <section aria-labelledby={`bars-${title}`} className="space-y-3">
      <h2 id={`bars-${title}`} className="font-serif text-xl">{title}</h2>
      {rows.length === 0 ? <p className="text-sm text-[var(--text-muted)]">Nothing yet.</p> : null}
      <ul className="space-y-2">
        {rows.map((row) => (
          <li key={row.label} className="grid grid-cols-[8rem_1fr_3rem] items-center gap-3 text-sm">
            <span className={row.muted ? 'text-[var(--text-muted)]' : ''}>{row.label}</span>
            <span className="h-2 rounded bg-[var(--color-border)]" role="img" aria-label={`${row.label}: ${row.count}`}>
              <span className="block h-full rounded bg-[var(--brass)]" style={{ width: `${(row.count / max) * 100}%` }} />
            </span>
            <span className="text-right tabular-nums">{row.count}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}
```

- [ ] **Step 6: Replace `src/app/admin/page.tsx`**

```tsx
import { prisma } from '@/lib/db'
import { requireRole } from '@/lib/auth/guard'
import { dashboard } from '@/lib/stats/rsvp'
import { StatTile } from '@/components/admin/stat-tile'
import { BarList } from '@/components/admin/bar-list'

export const dynamic = 'force-dynamic'

export default async function AdminDashboard() {
  await requireRole('ADMIN')
  const d = await dashboard(prisma, new Date())
  const rate = d.invites.total ? Math.round((d.invites.responded / d.invites.total) * 100) : 0

  return (
    <section className="space-y-10">
      <h1 className="font-serif text-2xl">Dashboard</h1>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Invited" value={d.invites.total} hint="parties" />
        <StatTile label="Responded" value={`${rate}%`} hint={`${d.invites.responded} of ${d.invites.total}`} />
        <StatTile label="Coming" value={d.guests.attending} hint="people" />
        <StatTile label="Arrived" value={d.guests.checkedIn} hint={`of ${d.guests.attending}`} />
      </div>

      {d.pendingExtraSeats > 0 ? (
        <p className="rounded border border-[var(--brass)] px-4 py-3 text-sm">
          {d.pendingExtraSeats} extra-seat request{d.pendingExtraSeats === 1 ? '' : 's'} waiting for a decision.
        </p>
      ) : null}

      <div className="grid gap-10 lg:grid-cols-2">
        <BarList title="Responses" rows={[
          { label: 'Attending', count: d.invites.attending },
          { label: 'Partial', count: d.invites.partial },
          { label: 'Declined', count: d.invites.declined },
          { label: 'No reply', count: d.invites.pending, muted: true },
        ]} />
        <BarList title="Meals" rows={d.meals.map((m) => ({ label: m.isActive ? m.label : `${m.label} (retired)`, count: m.count, muted: !m.isActive }))} />
      </div>

      <BarList title="Responses by day" rows={d.responsesByDay.map((r) => ({ label: r.date, count: r.count }))} />
    </section>
  )
}
```

- [ ] **Step 7: Verify and commit**

```bash
npm run typecheck 2>&1 | grep -v "^>"
npm run lint
npm run build && git checkout tsconfig.json
git add src/lib/stats src/components/admin/stat-tile.tsx src/components/admin/bar-list.tsx src/app/admin/page.tsx tests/integration/stats.test.ts
git commit -m "feat: live RSVP dashboard"
```

---

## Task 6: Guest list and CSV export

**Files:**
- Create: `src/lib/guests/repository.ts`, `src/lib/guests/export.ts`, `src/app/admin/guests/page.tsx`, `src/app/api/admin/guests/export/route.ts`
- Test: `tests/unit/guest-export.test.ts`, `tests/integration/guests.test.ts`

**Interfaces:**
- Produces:
  - `listGuests(db, query): Promise<{ rows: GuestListRow[]; total: number }>` — query `{ search?, attending?: 'yes'|'no'|'unanswered', mealOptionId?, checkedIn?: boolean, page, pageSize }`; rows carry `inviteLabel` and the resolved table
  - `allGuestsForExport(db): AsyncIterable<GuestListRow>` — batched, never the whole table in memory
  - `guestsToCsvRows(rows): string[]` and `csvHeader(): string` in `export.ts` — pure, injection-safe
  - `GET /api/admin/guests/export` → streamed `text/csv`, ADMIN only

**The export is the file that opens in Excel.** A guest whose "accessibility needs" begins with `=HYPERLINK(...)` — or more realistically `-` or `+` — would execute or misparse. Every cell that starts with `=`, `+`, `-`, `@`, tab or carriage return is prefixed with a single quote before quoting. Test it with each character.

- [ ] **Step 1: Write the failing unit test for the CSV**

`tests/unit/guest-export.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { csvHeader, guestsToCsvRows, escapeCsvCell } from '@/lib/guests/export'

describe('escapeCsvCell', () => {
  it('quotes a plain value', () => expect(escapeCsvCell('Reyes')).toBe('"Reyes"'))
  it('doubles embedded quotes', () => expect(escapeCsvCell('Jo "JJ" Reyes')).toBe('"Jo ""JJ"" Reyes"'))
  it('keeps embedded newlines inside the quotes', () => expect(escapeCsvCell('a\nb')).toBe('"a\nb"'))
  it('renders null as empty', () => expect(escapeCsvCell(null)).toBe('""'))

  it.each(['=', '+', '-', '@', '\t', '\r'])('neutralises a cell starting with %j (formula injection)', (ch) => {
    expect(escapeCsvCell(`${ch}HYPERLINK("x")`)).toBe(`"'${ch}HYPERLINK(""x"")"`)
  })

  it('does not touch a negative-looking value that is genuinely text', () => {
    // Prefixing is the whole defence; a leading apostrophe is the accepted cost.
    expect(escapeCsvCell('-5')).toBe('"\'-5"')
  })
})

describe('guestsToCsvRows', () => {
  it('emits one line per guest in header order', () => {
    const rows = guestsToCsvRows([{
      inviteLabel: 'Reyes Party', firstName: 'Jordan', lastName: 'Reyes', badgeName: null,
      company: 'Northwind', title: 'VP', email: 'j@x.test', phone: null, attending: true,
      meal: 'Beef', dietary: ['nut-free', 'vegan'], accessibilityNeeds: null, table: '12',
      checkedInAt: new Date('2026-11-14T18:12:00Z'),
    }])
    expect(rows).toHaveLength(1)
    const cols = rows[0]!.split('","').map((c) => c.replace(/^"|"$/g, ''))
    expect(cols.length).toBe(csvHeader().split(',').length)
    expect(cols).toContain('nut-free; vegan')
    expect(cols).toContain('2026-11-14T18:12:00.000Z')
    expect(cols).toContain('yes')
  })

  it('renders unanswered attendance as blank, not "null"', () => {
    const [row] = guestsToCsvRows([{ inviteLabel: 'P', firstName: 'A', lastName: 'B', badgeName: null, company: null, title: null, email: null, phone: null, attending: null, meal: null, dietary: [], accessibilityNeeds: null, table: null, checkedInAt: null }])
    expect(row).not.toContain('null')
  })
})
```

- [ ] **Step 2: Implement `src/lib/guests/export.ts`**

```ts
export type ExportRow = {
  inviteLabel: string; firstName: string; lastName: string; badgeName: string | null
  company: string | null; title: string | null; email: string | null; phone: string | null
  attending: boolean | null; meal: string | null; dietary: string[]; accessibilityNeeds: string | null
  table: string | null; checkedInAt: Date | null
}

const COLUMNS = ['invite', 'firstName', 'lastName', 'badgeName', 'company', 'title', 'email', 'phone',
  'attending', 'meal', 'dietary', 'accessibilityNeeds', 'table', 'checkedInAt'] as const

/** Characters that make a spreadsheet treat a cell as a formula. */
const FORMULA_TRIGGERS = new Set(['=', '+', '-', '@', '\t', '\r'])

/**
 * RFC 4180 quoting plus formula-injection neutralisation: guest-supplied text
 * goes into a file that opens in Excel. A leading apostrophe on a cell like
 * "-5" is the accepted cost of never executing "=HYPERLINK(...)".
 */
export function escapeCsvCell(value: string | null | undefined): string {
  const text = value ?? ''
  const safe = FORMULA_TRIGGERS.has(text.charAt(0)) ? `'${text}` : text
  return `"${safe.replace(/"/g, '""')}"`
}

export function csvHeader(): string {
  return COLUMNS.join(',')
}

export function guestsToCsvRows(rows: ExportRow[]): string[] {
  return rows.map((r) => [
    r.inviteLabel, r.firstName, r.lastName, r.badgeName, r.company, r.title, r.email, r.phone,
    r.attending === null ? '' : r.attending ? 'yes' : 'no',
    r.meal, r.dietary.join('; '), r.accessibilityNeeds, r.table,
    r.checkedInAt ? r.checkedInAt.toISOString() : '',
  ].map(escapeCsvCell).join(','))
}
```

- [ ] **Step 3: Write the failing integration test and implement the repository**

`tests/integration/guests.test.ts` — seed two invites with three guests across meals and check-in states; assert: search by last name and by invite label (case-insensitive); `attending: 'no'` returns only declined; `attending: 'unanswered'` returns `null`s; `checkedIn: true` filters; pagination; `allGuestsForExport` yields every guest exactly once across batches (seed 120 guests with a batch size of 50 to prove batching); the resolved `table` prefers the guest's own over the invite's.

`src/lib/guests/repository.ts` — `listGuests` with a Prisma `where` built from the query (`mode: 'insensitive'` on `firstName`, `lastName`, `email`, `company`, and `invite.label`), `include: { invite: { select: { label, tableNumber } }, mealOption: { select: { label } } }`, ordered by `lastName, firstName`; map to `GuestListRow` with `table = guest.tableNumber ?? invite.tableNumber`. `allGuestsForExport` is an `async function*` paging by `skip/take` of 500 until a short page.

- [ ] **Step 4: The page and the export route**

`src/app/admin/guests/page.tsx` — `requireRole('ADMIN')`; a filter form (search, attending select, meal select from `getEvent(prisma)?.mealOptions`, checked-in checkbox); the `Table` from Plan 1 with columns Name · Invite · Company · Attending · Meal · Table · Arrived; `Pagination`; a link to `/api/admin/guests/export`.

`src/app/api/admin/guests/export/route.ts`:

```ts
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
```

The BOM makes Excel read UTF-8 names correctly. Tokens never appear: `GuestListRow` has no token field, by construction.

- [ ] **Step 5: Verify and commit**

```bash
npx vitest run tests/unit/guest-export.test.ts
DATABASE_URL_TEST="mongodb://127.0.0.1:27018/gala_test_p4c?replicaSet=rs0" npx vitest run tests/integration/guests.test.ts
npm run typecheck 2>&1 | grep -v "^>"
npm run lint
npm run build && git checkout tsconfig.json
git add src/lib/guests src/app/admin/guests src/app/api/admin/guests tests/unit/guest-export.test.ts tests/integration/guests.test.ts
git commit -m "feat: guest list with filters and injection-safe CSV export"
```

---

## Task 7: Audit log screen

**Files:**
- Create: `src/lib/audit/query.ts`, `src/app/admin/audit/page.tsx`
- Test: `tests/integration/audit-query.test.ts`

**Interfaces:**
- Produces: `listAudit(db, query): Promise<{ rows: AuditRow[]; total: number }>` — query `{ actorId?, entity?, action?, from?: Date, to?: Date, page, pageSize }`; `AuditRow = { id, createdAt, actor: { name, email } | null, action, entity, entityId, meta, ip }`; `distinctEntities(db): Promise<string[]>`

OWNER-only. This is the screen that answers "who changed this, and when" — it must be filterable by person, by thing, and by time, and `meta` renders as formatted JSON text, never as HTML.

- [ ] **Step 1: Write the failing test**

`tests/integration/audit-query.test.ts` — seed two admin users and eight audit rows across three entities over four days (some with `actorId: null`); assert: newest first; filter by `actorId`; filter by `entity`; filter by `action` prefix (`'invite.'` matches `invite.create` and `invite.update`); `from`/`to` inclusive of the day; pagination total unaffected by page; a deleted actor renders as `actor: null` (delete a user after writing their row — `onDelete: SetNull`); `distinctEntities` sorted.

- [ ] **Step 2: Implement `src/lib/audit/query.ts` and the page**

`listAudit` builds a `where` from the query (`action: { startsWith }` for the prefix), `include: { actor: { select: { name: true, email: true } } }`, `orderBy: { createdAt: 'desc' }`, `skip/take`, plus a `count` in the same `Promise.all`.

`src/app/admin/audit/page.tsx` — `requireRole('OWNER')`; a filter form (actor select from `listAdminUsers`, entity select from `distinctEntities`, action text, from/to dates); `Table` with columns When · Who · Action · Entity · Details; Details is `<pre className="whitespace-pre-wrap text-xs">{JSON.stringify(meta, null, 1)}</pre>` — **text, never HTML**; `Pagination`.

- [ ] **Step 3: Verify and commit**

```bash
DATABASE_URL_TEST="mongodb://127.0.0.1:27018/gala_test_p4d?replicaSet=rs0" npx vitest run tests/integration/audit-query.test.ts
npm run typecheck 2>&1 | grep -v "^>"
npm run lint
npm run build && git checkout tsconfig.json
git add src/lib/audit src/app/admin/audit tests/integration/audit-query.test.ts
git commit -m "feat: audit log screen"
```

---

## Task 8: Content-Security-Policy with nonces, and the `proxy` rename

**Files:**
- Rename: `src/middleware.ts` → `src/proxy.ts` (export `proxy` instead of `middleware`)
- Modify: `next.config.ts` (remove the commented-out CSP; keep the other headers), `src/app/admin/invites/[id]/page.tsx` (the `next/script` marker — confirm it receives the nonce)
- Test: `tests/e2e/csp.spec.ts`

**Interfaces:**
- Produces: a per-request `Content-Security-Policy` header on every matched route, a nonce on the `x-nonce` request header that Next applies to its own scripts, and `buildCsp(nonce, isDev): string` exported from `src/lib/security/csp.ts` so the policy string is unit-testable

**Why `style-src` keeps `'unsafe-inline'`.** Next's own guide uses a nonce for styles, but inline *style attributes* — the seat marker's `left`/`top`, the bar widths, the seal's transform-origin — are governed by `style-src-attr` and cannot carry a nonce. Blocking them would break the floorplan. Scripts get the strict policy (`'nonce-…' 'strict-dynamic'`); styles get `'self' 'unsafe-inline'`. That is the documented spec §11 shape and an honest tradeoff — say so in a comment.

- [ ] **Step 1: `src/lib/security/csp.ts`**

```ts
/**
 * Builds the per-request policy. Scripts are nonce-gated with strict-dynamic
 * so Next's own chunks load without listing hosts. Styles keep 'unsafe-inline'
 * because inline style ATTRIBUTES (marker positions, bar widths, transform
 * origins) are governed by style-src-attr and cannot carry a nonce.
 */
export function buildCsp(nonce: string, isDev: boolean): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "media-src 'self' blob:",
    "worker-src 'self' blob:",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    'upgrade-insecure-requests',
  ].join('; ')
}
```

`tests/unit/csp.test.ts`: the nonce appears in `script-src` exactly once; `'unsafe-eval'` only in dev; no `'unsafe-inline'` in `script-src`; `frame-ancestors 'none'`; the string contains no newline.

- [ ] **Step 2: Rename and extend the proxy**

`git mv src/middleware.ts src/proxy.ts`. Rename the exported function to `proxy`. Keep the CSRF logic exactly as it is. Add, before `NextResponse.next({ request })`:

```ts
const nonce = btoa(crypto.getRandomValues(new Uint8Array(16)).reduce((s, b) => s + String.fromCharCode(b), ''))
const csp = buildCsp(nonce, process.env.NODE_ENV === 'development')
request.headers.set('x-nonce', nonce)
request.headers.set('Content-Security-Policy', csp)
```

and after creating the response: `response.headers.set('Content-Security-Policy', csp)`. Web Crypto and `btoa` only — this runs on the Edge runtime. Widen `config.matcher` to cover every page route (`'/((?!_next/static|_next/image|favicon.ico).*)'`) so the policy applies to `/` and `/api/*` too; the CSRF cookie logic still keys off its own route predicates.

- [ ] **Step 3: Remove the stale comment from `next.config.ts`**

Delete the commented CSP block and its explanatory comment; leave the five static headers.

- [ ] **Step 4: `tests/e2e/csp.spec.ts`**

```ts
import { test, expect } from '@playwright/test'
import { E2E_GUEST_TOKEN, ADMIN_CREDENTIALS } from './global-setup'
import { signIn } from './sign-in'

const PAGES = [
  { name: 'guest portal', path: () => `/i/${E2E_GUEST_TOKEN}`, auth: false },
  { name: 'login', path: () => '/admin/login', auth: false },
  { name: 'dashboard', path: () => '/admin', auth: true },
  { name: 'invites', path: () => '/admin/invites', auth: true },
  { name: 'event', path: () => '/admin/event', auth: true },
  { name: 'check-in', path: () => '/admin/checkin', auth: true },
]

for (const page of PAGES) {
  test(`CSP is enforced and violation-free on the ${page.name}`, async ({ page: p }) => {
    const violations: string[] = []
    p.on('console', (m) => { if (/Content Security Policy|Refused to/.test(m.text())) violations.push(m.text()) })
    if (page.auth) await signIn(p, ADMIN_CREDENTIALS.email, ADMIN_CREDENTIALS.password)
    const response = await p.goto(page.path())
    const csp = response?.headers()['content-security-policy'] ?? ''
    expect(csp).toMatch(/script-src [^;]*'nonce-[A-Za-z0-9+/=]+'/)
    expect(csp).toContain("frame-ancestors 'none'")
    await p.waitForLoadState('networkidle')
    // The page must actually work under the policy, not merely carry the header.
    await expect(p.locator('h1').first()).toBeVisible()
    expect(violations).toEqual([])
  })
}

test('the nonce differs between requests', async ({ page }) => {
  const a = (await page.goto('/admin/login'))?.headers()['content-security-policy']
  const b = (await page.goto('/admin/login'))?.headers()['content-security-policy']
  expect(a).not.toBe(b)
})

test('the invite-token reveal script still runs under the policy', async ({ page }) => {
  await signIn(page, ADMIN_CREDENTIALS.email, ADMIN_CREDENTIALS.password)
  await page.goto('/admin/invites')
  await page.getByRole('link', { name: 'Open' }).first().click()
  const violations: string[] = []
  page.on('console', (m) => { if (/Content Security Policy/.test(m.text())) violations.push(m.text()) })
  await page.getByRole('button', { name: 'Regenerate QR token' }).click()
  await expect(page.getByTestId('invite-url')).toBeVisible()
  expect(violations).toEqual([])
})
```

The last test is the one that matters: the one-time token reveal uses a `next/script` marker, and a CSP that silently kills it would re-open the "token shown forever" problem. A violation in the console is a test failure.

- [ ] **Step 5: Verify and commit**

```bash
npx vitest run tests/unit/csp.test.ts
npm run typecheck 2>&1 | grep -v "^>"
npm run lint
npm run build && git checkout tsconfig.json      # the build log must no longer warn about "middleware"
npm run test:e2e -- tests/e2e/csp.spec.ts
git add src/proxy.ts src/lib/security next.config.ts tests/unit/csp.test.ts tests/e2e/csp.spec.ts
git rm --cached src/middleware.ts 2>/dev/null; git commit -m "feat: nonce-based CSP; middleware renamed to proxy per Next 16"
```

---

## Task 9: Desktop composition

**Files:**
- Modify: `src/app/i/[token]/page.tsx`, `src/components/guest/seat-map.tsx` (classes only)
- Test: regenerate `guest-1440-*` baselines in Task 10

**Interfaces:** none new

At 1440 the guest page is a phone column with ~400px of dead margin on each side — the one design finding deferred from Plan 3. The fix is composition, not a redesign: at `lg` the column widens to `max-w-4xl`, the agenda and the seat act sit side by side in a two-column grid, and the RSVP form stays single-column because forms read better narrow. The brass line keeps its channel — it measures headings, so a wider column changes nothing about it. Nothing changes below `lg`; the 375 and 768 baselines must be byte-identical after this task.

- [ ] **Step 1: Apply the classes**

In `page.tsx`: `<main>` gets `lg:max-w-4xl`; wrap the evening and seat sections in a `div className="lg:grid lg:grid-cols-2 lg:gap-12"` (wrapping two sections in a `div` adds no heading, landmark or list — the markup contract holds). In `seat-map.tsx`: the floorplan container gets `lg:max-w-md`.

- [ ] **Step 2: Verify the narrow baselines did not move**

```bash
npm run typecheck 2>&1 | grep -v "^>"
npm run lint
npm run build && git checkout tsconfig.json
npm run test:e2e -- tests/e2e/visual.spec.ts
```

Expected: the 375 and 768 specs PASS against their existing baselines (nothing moved below `lg`); the 1440 specs FAIL (they changed on purpose). Do not update snapshots here — Task 10 regenerates them after looking.

- [ ] **Step 3: Commit**

```bash
git add src/app/i/[token]/page.tsx src/components/guest/seat-map.tsx
git commit -m "feat: desktop composition for the guest page"
```

---

## Task 10: End-to-end, accessibility and performance proof

**Files:**
- Create: `tests/e2e/checkin.spec.ts`, `tests/e2e/dashboard.spec.ts`, `tests/e2e/a11y.spec.ts`, `tests/e2e/perf.spec.ts`
- Modify: `tests/e2e/visual.spec.ts` (add a light-mode admin baseline), `tests/e2e/global-setup.ts` (seed a second party and one checked-in guest), regenerate the 1440 baselines
- Test: itself. Serial — owns the build and the browser.

**Interfaces:**
- Consumes: everything above; `@axe-core/playwright`

**Each spec proves a property a green unit suite cannot see.**

- [ ] **Step 1: `checkin.spec.ts`** — as STAFF:
  - paste the seeded invite URL into the manual field → the party appears with its table number
  - tap a guest → the row shows the check and time; the progress line on reload reads `1 of N arrived`
  - tap the same guest again → it undoes; tap again → it re-checks; the audit log (as OWNER) shows `guest.checkIn`, `guest.undoCheckIn`, `guest.checkIn`
  - **offline:** `context.setOffline(true)`, tap a second guest → the row shows "will sync" and the unsynced badge reads `1 to sync`; reload the page while still offline → the badge persists (IndexedDB survived); `setOffline(false)` and wait → the badge disappears and a fresh `/api/admin/checkin/resolve` shows the guest checked in
  - a STAFF request to `/api/admin/guests/export` is refused (status ≥ 300, and the body is not CSV)
  - an ADMIN posting to `/api/admin/checkin/resolve` **without** the `X-CSRF-Token` header gets 403

- [ ] **Step 2: `dashboard.spec.ts`** — as ADMIN: the four stat tiles render numbers consistent with the seed (assert on `data-stat` values, computed from what global setup inserted, not hard-coded); the Meals bars list both seeded options; `/admin/guests` lists the seeded guests, filtering by `attending=no` shows only the declined one, and the export link downloads a CSV whose first line is the header and whose BOM is present; `/admin/audit` as OWNER shows rows and filters by entity; `/admin/audit` as ADMIN redirects away.

- [ ] **Step 3: `a11y.spec.ts`** — with `@axe-core/playwright`, run `new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()` on: the guest page in full motion, the guest page with reduced motion, login, dashboard, invites, event, check-in. Assert `violations` is empty; print each violation's `id`, `impact` and first node `html` on failure so it is actionable. Then the **keyboard-only RSVP**: from the guest page, using only `Tab`, `Space`, `Enter` and arrow keys, accept, continue through all five steps, and submit; assert the confirmation appears and that focus was never lost (after each `Tab`, `document.activeElement` is not `body`).

- [ ] **Step 4: `perf.spec.ts`** — Chromium only. Open a CDP session, `Network.enable`, collect `Network.loadingFinished` events; load the guest page as a **lite**-tier visitor (`deviceMemory` spoofed to 2) and sum `encodedDataLength` for `resourceType === 'Script'`. Assert the total is **under 150 KB** (spec §4: "guest JS bundle, motion layer excluded"). Then load as full tier and assert the total grew (three.js loaded) but the *difference* is attributable to one additional chunk. Report both numbers in the test output via `test.info().annotations.push(...)` so CI logs show the real figures over time. Also assert `document.documentElement.scrollWidth <= clientWidth` at 375 on the check-in page, which has a video element that can overflow.

- [ ] **Step 5: Baselines** — add `admin-event-1440-light.png` and `admin-dashboard-1440-dark.png` to `visual.spec.ts`; regenerate the three `guest-1440-*` baselines and the new ones with `--update-snapshots`; **open each PNG** and confirm: at 1440 the agenda and seat sit side by side with the line still in its channel; the light admin screens have legible brass text; the dashboard bars read at a glance. Then run the full suite **twice**.

- [ ] **Step 6: Commit**

```bash
npm install -D @axe-core/playwright@4.13.0
npx vitest run
npm run typecheck 2>&1 | grep -v "^>"
npm run lint
npm run test:e2e && npm run test:e2e
git add package.json package-lock.json tests/e2e
git commit -m "test: check-in, dashboard, accessibility, CSP and performance proof"
```

---

## Task 11: README, CI and the deployment checklist

**Files:**
- Modify: `README.md`, `.github/workflows/ci.yml`

- [ ] **Step 1: README** — add a **Door check-in** section: STAFF role, the scanner URL, that the camera requires HTTPS (or `localhost`), that check-ins queue offline and sync when the venue Wi-Fi returns, and how to undo a mistap. Add a **Going live** checklist: a hosted MongoDB replica set, a real `SESSION_SECRET` (and the warning that rotating it strands printed QR codes), `APP_URL` set to the public HTTPS origin (the scanner rejects QR codes from any other origin), upload the real floorplan, configure the event, then run the seed only once. Add the export and audit screens to the commands/routes table.

- [ ] **Step 2: CI** — nothing structural changes; confirm the workflow still installs Playwright with `--with-deps chromium` (axe and the CDP perf test need Chromium) and that the `perf.spec.ts` annotations appear in the job log.

- [ ] **Step 3: Commit**

```bash
git add README.md .github/workflows/ci.yml
git commit -m "docs: door check-in and going-live checklist"
```

---

## Definition of done

- [ ] `npx vitest run`, `npm run typecheck`, `npm run lint`, `npm run build` clean; the build log no longer warns about `middleware`
- [ ] `npm run test:e2e` green **twice back to back**, including check-in, dashboard, a11y, CSP and perf
- [ ] A STAFF user can scan (or paste) an invitation, see the party, check guests in by tapping, undo a mistap, and keep working with the network off — and everything syncs when it returns
- [ ] Every check-in is idempotent and audited with the staff member who did it
- [ ] An ADMIN sees live counts, meal tallies including retired options, and can export every guest to a CSV that cannot execute a formula
- [ ] An OWNER can answer "who changed this and when" from `/admin/audit`; an ADMIN cannot reach it
- [ ] `/admin/guests` and `/admin/audit` no longer 404 — the two Plan 1 gaps are closed
- [ ] Every page carries a per-request nonce CSP and logs zero violations, including the one-time token reveal
- [ ] axe reports zero WCAG 2.x A/AA violations on every screen; the RSVP completes by keyboard alone
- [ ] The guest route ships under 150 KB of script on a low-tier device, measured, with the number in the CI log
- [ ] The 1440 guest page is composed, not a phone column in a wide frame; 375 and 768 are byte-identical to before

---

## AS-BUILT DIVERGENCES — read before re-running any task from this plan

The working tree is the source of truth, not this document.

| Module | Plan text is stale because | Read instead |
| --- | --- | --- |
| `src/lib/audit-log/query.ts` (Task 7) | The plan said `src/lib/audit/query.ts`. `src/lib/audit.ts` already exists as a file, and a sibling directory of the same name makes `@/lib/audit` ambiguous. | the file |
| `src/app/admin/checkin/scanner.tsx` (Task 4) | The plan's zxing snippet used `decodeFromVideoElement` / `.getText()`, which do not match the installed `@zxing/browser@0.2.1`; the real API is `decodeOnceFromVideoElement`. **Then the security review found two Critical defects in the plan's own code:** `flush()` persisted a stale IndexedDB snapshot, silently erasing any tap made during a flush; and the manual-entry `<form>` had no `action`/`method`, so a pre-hydration Enter did a native GET that put the invite token in the URL. Both rewritten: read-modify-write against IndexedDB under an in-flight guard, and no `<form>` at all. | the file |
| `src/app/api/admin/checkin/guests/[id]/route.ts`, `src/lib/validation/checkin.ts` (Task 3) | The plan validated only that the guest id was 24 hex and never tied it to a party — a STAFF session could enumerate ObjectIds and check in, undo, or probe any guest. The POST/DELETE bodies now carry the invite token and the route verifies membership before any write. | the files |
| `src/lib/checkin/repository.ts` (Task 1) | The plan's idempotency was read-then-write; two overlapping replays both audited. Now `updateMany` on `checkedInAt: null` with the audit row written only when `count === 1`. | the file |
| `src/lib/stats/rsvp.ts` (Task 5) | `dashboard()` took a `now` it never read. Removed. | the file |
| `src/app/i/[token]/page.tsx` (Task 9) | The `lg:grid` wrapper silently dropped the inter-section gap below `lg`; restored with a flex column. | the file |
| `src/components/admin/status-pill.tsx`, `globals.css` | The light-theme "declined" pill failed WCAG AA at 3.19:1. New `--danger-ink` / `--success-ink` tokens. | the files |
| `tests/e2e/{checkin,perf,visual}.spec.ts` (Task 10) | Four tests certified properties they did not test: the offline test never reloaded while offline; a badge assertion resolved before the badge could exist; the perf budget subtracted an uncapped, signature-matched chunk; and the dashboard baseline encoded whatever earlier specs left behind, reproducing identically because spec order is fixed — "green twice" proved consistency, not correctness. All rewritten. | the files |

### Packages

Both new dependencies were installed by the controller before dispatch, not by Tasks 4 and 10 as written: an `npm install` running while sibling agents typecheck corrupts `node_modules`.

### What the plan got right

The "two numbers I want in your return" instruction. The proof agent reported 139,874 bytes and zero axe violations rather than "under budget" and "clean" — and the number is what let the reviewer notice the budget's subtraction was escapable.

## Deliberately not in this plan

- **Email-scoped login lockout.** The targeted-DoS finding stands; the spec specifies the behaviour; the owner has not ruled. Not changed.
- **Decoding uploaded image payloads.** A known, documented limitation: a header-only PNG passes validation and renders broken. Serving is safe. Adding a native image decoder was rejected as a larger supply-chain surface than the risk it removes.
- **Email sending.** Spec §3 excludes it.

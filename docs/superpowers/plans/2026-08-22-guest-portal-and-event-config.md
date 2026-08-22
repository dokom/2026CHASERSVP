# Guest Portal & Event Configuration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A guest scans their QR code, lands on a page that already knows who they are, sees the evening's agenda and their table, and completes an RSVP for themselves and their party — plus the admin screens that configure all of that content.

**Architecture:** Continues the Plan 1 structure. Business logic lives in framework-free modules under `src/lib/` that take a `PrismaClient` as their first parameter; route handlers, pages, and Server Actions are thin wrappers that validate with Zod, call a lib function, and write an audit row. The guest portal has no session: the opaque token in the URL is the credential, re-resolved on every request against its stored `sha256`. This plan builds **semantic, accessible, unanimated** markup — Plan 3 layers motion onto exactly these elements, so heading structure, landmarks, and form semantics matter more here than appearance.

**Tech Stack:** Unchanged from Plan 1 — Next.js 16, React 19, TypeScript 5.9, Tailwind v4, MongoDB 8 (replica set), Prisma 6.19.3, Zod 3.25, Vitest 4, Playwright 1.62. One addition: no new runtime dependency. `.ics` generation and image magic-byte sniffing are both written by hand rather than pulled in, because each is a few dozen lines and every dependency is a supply-chain surface on a project that handles PII.

**Spec:** `docs/superpowers/specs/2026-08-21-gala-rsvp-portal-design.md` (sections 7.1, 8, 9, 9.1, 10, 11)

**Plan 1:** `docs/superpowers/plans/2026-08-21-foundation-and-admin-backend.md` — read its **AS-BUILT DIVERGENCES** section before assuming any Plan 1 code sample is current.

## Global Constraints

Everything binding in Plan 1 still binds. Repeated here because a task's implementer sees only its own brief:

- Node >= 20.11, package manager `npm`. Database is **MongoDB** via Prisma's `mongodb` connector; schema changes ship with `npx prisma db push`, never `migrate`.
- Every module under `src/lib/` must be importable in a plain Node test — no `next/*`, no React, no `server-only`. The sole exception remains `src/lib/auth/guard.ts`.
- **Never call `cookies().set()` inside a Server Component render.** Next.js forbids it and the page 500s in production while every unit and integration test stays green. This shipped once already. Cookie writes belong in a Server Action, a Route Handler, or `src/middleware.ts`.
- All external input is validated with Zod at the boundary. A value that crosses a request boundary is untrusted even if this application produced it one request earlier.
- Every mutation writes an `AuditLog` row inside the same transaction as the change.
- Guest-supplied text renders as text nodes only. No `dangerouslySetInnerHTML` — ESLint enforces `react/no-danger` as an error.
- Invite tokens are never logged, never placed in a URL query string, and never written into an audit row.
- **MongoDB ids are ObjectIds.** `findUnique({ where: { id } })` THROWS `Malformed ObjectID` rather than returning null for an unparseable id. Ids arriving from URLs must be validated (`/^[0-9a-f]{24}$/`) or the lookup guarded.
- Files under 400 lines, functions under 50. Coverage floor 80%.
- Secrets come from `src/lib/env.ts` only.
- **Every task runs `npm run typecheck` and `npm run lint` as verification, not just its tests.** Vitest transpiles without typechecking; in Plan 1 that let type errors accumulate across eight tasks while the suite stayed green and `npm run build` would have failed.
- **A test that would pass against a broken implementation is a defect.** Plan 1 shipped five. Where a task's test guards a security or integrity property, prove it fails when that property is removed.

---

## File Structure

**Guest portal — new**
- `src/lib/guest/resolve.ts` — resolve an invite from a plaintext token
- `src/lib/guest/deadline.ts` — pure RSVP-window logic
- `src/lib/guest/rsvp.ts` — the transactional RSVP submission
- `src/lib/guest/ics.ts` — calendar file generation
- `src/lib/validation/guest.ts` — Zod schemas for the RSVP payload
- `src/app/i/[token]/page.tsx` — the guest page (server component)
- `src/app/i/[token]/actions.ts` — `submitRsvpAction`
- `src/app/i/[token]/rsvp-form.tsx` — multi-step client form
- `src/app/i/[token]/calendar/route.ts` — serves the `.ics`
- `src/components/guest/` — `agenda-timeline.tsx`, `seat-map.tsx`, `guest-card.tsx`

**Event configuration — new**
- `src/lib/events/repository.ts` — event details, agenda items, meal options
- `src/lib/events/markers.ts` — table markers
- `src/lib/media/images.ts` — magic-byte validation and dimension probing
- `src/lib/media/repository.ts` — `MediaAsset` storage and retrieval
- `src/lib/validation/event.ts` — Zod schemas for event configuration
- `src/app/admin/event/page.tsx`, `actions.ts`, `floorplan-editor.tsx`
- `src/app/api/media/[id]/route.ts` — serves a stored image

**Modified**
- `src/middleware.ts` — extend the CSRF matcher to cover `/i/*`
- `src/app/layout.tsx` — `robots: noindex` already set; verify it covers `/i/*`

**Tests**
- `tests/unit/` — deadline, ics, images, guest validation
- `tests/integration/` — resolve, rsvp, events, markers, media
- `tests/e2e/guest-rsvp.spec.ts`, `tests/e2e/event-config.spec.ts`

---

## Task 1: Guest token resolution

**Files:**
- Create: `src/lib/guest/resolve.ts`
- Test: `tests/integration/guest-resolve.test.ts`

**Interfaces:**
- Consumes: `hashToken` from `@/lib/crypto/tokens`, `prisma`
- Produces:
  - `type GuestInvite` — `{ id, label, seatsAllotted, status, tableNumber, extraSeatsRequested, extraSeatsStatus, extraSeatsReason, respondedAt, guests: GuestRow[] }` where `GuestRow` is `{ id, firstName, lastName, badgeName, company, title, email, phone, isPrimary, attending, mealOptionId, dietary, accessibilityNeeds, tableNumber }`
  - `resolveInviteByToken(db: PrismaClient, token: string): Promise<GuestInvite | null>`

The lookup is by `tokenHash`, never by id, so a malformed value is simply a miss rather than a thrown ObjectId error. The token is never logged and never returned.

- [ ] **Step 1: Write the failing test**

`tests/integration/guest-resolve.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { testDb, resetDb } from '../helpers/db'
import { resolveInviteByToken } from '@/lib/guest/resolve'
import { createInvite } from '@/lib/invites/repository'

beforeEach(resetDb)
afterAll(() => testDb.$disconnect())

const base = {
  label: 'Reyes Party',
  seatsAllotted: 2,
  tableNumber: '12',
  primaryGuest: { firstName: 'Jordan', lastName: 'Reyes', email: 'jordan@example.com' },
}

describe('resolveInviteByToken', () => {
  it('resolves an invite from its plaintext token', async () => {
    const { token } = await createInvite(testDb, null, base)
    const invite = await resolveInviteByToken(testDb, token)
    expect(invite).toMatchObject({ label: 'Reyes Party', seatsAllotted: 2, tableNumber: '12' })
  })

  it('includes the party, primary guest first', async () => {
    const { invite, token } = await createInvite(testDb, null, base)
    await testDb.guest.create({
      data: { inviteId: invite.id, firstName: 'Sam', lastName: 'Reyes' },
    })
    const resolved = await resolveInviteByToken(testDb, token)
    expect(resolved?.guests).toHaveLength(2)
    expect(resolved?.guests[0]?.isPrimary).toBe(true)
  })

  it('returns null for an unknown token', async () => {
    expect(await resolveInviteByToken(testDb, 'not-a-real-token')).toBeNull()
  })

  it('returns null for an empty token', async () => {
    expect(await resolveInviteByToken(testDb, '')).toBeNull()
  })

  it('returns null for a token that looks like an ObjectId', async () => {
    // Guards the MongoDB trap: lookup must be by tokenHash, never by id.
    await expect(resolveInviteByToken(testDb, 'a'.repeat(24))).resolves.toBeNull()
  })

  it('never exposes the token hash or cipher', async () => {
    const { token } = await createInvite(testDb, null, base)
    const invite = await resolveInviteByToken(testDb, token)
    expect(invite).not.toHaveProperty('tokenHash')
    expect(invite).not.toHaveProperty('tokenCipher')
    expect(JSON.stringify(invite)).not.toContain(token)
  })

  it('stops resolving once the token is regenerated', async () => {
    const { invite, token } = await createInvite(testDb, null, base)
    const { regenerateInviteToken } = await import('@/lib/invites/repository')
    const next = await regenerateInviteToken(testDb, null, invite.id)
    expect(await resolveInviteByToken(testDb, token)).toBeNull()
    expect(await resolveInviteByToken(testDb, next)).not.toBeNull()
  })
})
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `DATABASE_URL_TEST="mongodb://127.0.0.1:27018/gala_test_p2a?replicaSet=rs0" npx vitest run tests/integration/guest-resolve.test.ts`
Expected: FAIL — cannot resolve `@/lib/guest/resolve`.

- [ ] **Step 3: Implement `src/lib/guest/resolve.ts`**

```ts
import type { PrismaClient, Prisma } from '@prisma/client'
import { hashToken } from '@/lib/crypto/tokens'
import type { InviteStatus } from '@/lib/invites/status'

export type GuestRow = {
  id: string
  firstName: string
  lastName: string
  badgeName: string | null
  company: string | null
  title: string | null
  email: string | null
  phone: string | null
  isPrimary: boolean
  attending: boolean | null
  mealOptionId: string | null
  dietary: string[]
  accessibilityNeeds: string | null
  tableNumber: string | null
}

export type GuestInvite = {
  id: string
  label: string
  seatsAllotted: number
  status: InviteStatus
  tableNumber: string | null
  extraSeatsRequested: number
  extraSeatsStatus: 'NONE' | 'PENDING' | 'APPROVED' | 'DENIED'
  extraSeatsReason: string | null
  respondedAt: Date | null
  guests: GuestRow[]
}

/**
 * Selects exactly what the guest page needs. `tokenHash` and `tokenCipher` are
 * deliberately absent: nothing the guest sees should carry credential material,
 * and an explicit select is the only way to keep that true as the schema grows.
 */
const SELECT = {
  id: true,
  label: true,
  seatsAllotted: true,
  status: true,
  tableNumber: true,
  extraSeatsRequested: true,
  extraSeatsStatus: true,
  extraSeatsReason: true,
  respondedAt: true,
  guests: {
    select: {
      id: true, firstName: true, lastName: true, badgeName: true, company: true,
      title: true, email: true, phone: true, isPrimary: true, attending: true,
      mealOptionId: true, dietary: true, accessibilityNeeds: true, tableNumber: true,
    },
    orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
  },
} satisfies Prisma.InviteSelect

/**
 * Resolves an invite from the plaintext token a QR code carries.
 *
 * Lookup is by `tokenHash`, never by id — so a malformed or hostile value is a
 * plain miss rather than a thrown `Malformed ObjectID`. The token itself is
 * never logged and never returned.
 */
export async function resolveInviteByToken(
  db: PrismaClient,
  token: string,
): Promise<GuestInvite | null> {
  if (!token) return null
  const invite = await db.invite.findUnique({
    where: { tokenHash: hashToken(token) },
    select: SELECT,
  })
  return invite as GuestInvite | null
}
```

- [ ] **Step 4: Run it and confirm it passes**

Run: `DATABASE_URL_TEST="mongodb://127.0.0.1:27018/gala_test_p2a?replicaSet=rs0" npx vitest run tests/integration/guest-resolve.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Verify and commit**

```bash
npm run typecheck 2>&1 | grep -v "^>"   # must be empty
npm run lint                             # must exit 0
git add src/lib/guest/resolve.ts tests/integration/guest-resolve.test.ts
git commit -m "feat: resolve a guest invite from its QR token"
```

---

## Task 2: RSVP deadline window

**Files:**
- Create: `src/lib/guest/deadline.ts`
- Test: `tests/unit/deadline.test.ts`

**Interfaces:**
- Consumes: nothing — pure
- Produces:
  - `type RsvpWindow = { isOpen: boolean; closesAt: Date; hasClosed: boolean }`
  - `rsvpWindow(deadline: Date, now: Date): RsvpWindow`
  - `assertRsvpOpen(deadline: Date, now: Date): void` — throws `RsvpClosedError`
  - `RsvpClosedError`

Time is passed in, never read from the clock inside the module. That is what makes the boundary testable at all.

- [ ] **Step 1: Write the failing test**

`tests/unit/deadline.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { rsvpWindow, assertRsvpOpen, RsvpClosedError } from '@/lib/guest/deadline'

const deadline = new Date('2026-10-24T23:59:00Z')

describe('rsvpWindow', () => {
  it('is open well before the deadline', () => {
    expect(rsvpWindow(deadline, new Date('2026-09-01T00:00:00Z')).isOpen).toBe(true)
  })

  it('is open one second before the deadline', () => {
    expect(rsvpWindow(deadline, new Date('2026-10-24T23:58:59Z')).isOpen).toBe(true)
  })

  it('is CLOSED exactly at the deadline', () => {
    // The deadline is the moment it shuts, not the last moment it is open.
    const window = rsvpWindow(deadline, deadline)
    expect(window.isOpen).toBe(false)
    expect(window.hasClosed).toBe(true)
  })

  it('is closed after the deadline', () => {
    expect(rsvpWindow(deadline, new Date('2026-10-25T00:00:00Z')).isOpen).toBe(false)
  })

  it('reports when it closes', () => {
    expect(rsvpWindow(deadline, new Date('2026-09-01T00:00:00Z')).closesAt).toEqual(deadline)
  })
})

describe('assertRsvpOpen', () => {
  it('passes while open', () => {
    expect(() => assertRsvpOpen(deadline, new Date('2026-09-01T00:00:00Z'))).not.toThrow()
  })

  it('throws RsvpClosedError once closed', () => {
    expect(() => assertRsvpOpen(deadline, new Date('2026-10-25T00:00:00Z')))
      .toThrow(RsvpClosedError)
  })

  it('throws exactly at the deadline', () => {
    expect(() => assertRsvpOpen(deadline, deadline)).toThrow(RsvpClosedError)
  })

  it('names the deadline in its message so a guest can be told when it shut', () => {
    try {
      assertRsvpOpen(deadline, new Date('2026-10-25T00:00:00Z'))
      expect.unreachable('should have thrown')
    } catch (error) {
      expect((error as Error).message).toContain('2026')
    }
  })
})
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run tests/unit/deadline.test.ts`
Expected: FAIL — cannot resolve `@/lib/guest/deadline`.

- [ ] **Step 3: Implement `src/lib/guest/deadline.ts`**

```ts
export class RsvpClosedError extends Error {
  readonly closedAt: Date

  constructor(closedAt: Date) {
    super(`RSVPs closed on ${closedAt.toISOString()}`)
    this.name = 'RsvpClosedError'
    this.closedAt = closedAt
  }
}

export type RsvpWindow = {
  isOpen: boolean
  hasClosed: boolean
  closesAt: Date
}

/**
 * The deadline is the instant the window shuts, not the last instant it is
 * open — `now === deadline` is closed. Both callers (the page, which renders
 * read-only, and the action, which refuses the write) must agree on that, so
 * the comparison lives here rather than in either of them.
 */
export function rsvpWindow(deadline: Date, now: Date): RsvpWindow {
  const hasClosed = now.getTime() >= deadline.getTime()
  return { isOpen: !hasClosed, hasClosed, closesAt: deadline }
}

export function assertRsvpOpen(deadline: Date, now: Date): void {
  if (rsvpWindow(deadline, now).hasClosed) throw new RsvpClosedError(deadline)
}
```

- [ ] **Step 4: Run it and confirm it passes**

Run: `npx vitest run tests/unit/deadline.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Verify and commit**

```bash
npm run typecheck 2>&1 | grep -v "^>"
npm run lint
git add src/lib/guest/deadline.ts tests/unit/deadline.test.ts
git commit -m "feat: RSVP deadline window"
```

---

## Task 3: Calendar (.ics) generation

**Files:**
- Create: `src/lib/guest/ics.ts`
- Test: `tests/unit/ics.test.ts`

**Interfaces:**
- Consumes: nothing — pure
- Produces:
  - `type IcsEvent = { uid: string; startsAt: Date; endsAt: Date; title: string; description?: string; location?: string; stamp: Date }`
  - `buildIcs(event: IcsEvent): string`
  - `escapeIcsText(value: string): string`
  - `foldIcsLine(line: string): string`

No dependency for this. RFC 5545 is fussy in exactly three ways — escaping, 75-octet line folding, and CRLF — and all three are testable.

- [ ] **Step 1: Write the failing test**

`tests/unit/ics.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { buildIcs, escapeIcsText, foldIcsLine } from '@/lib/guest/ics'

const base = {
  uid: 'invite-123@gala.example.com',
  startsAt: new Date('2026-11-14T18:00:00Z'),
  endsAt: new Date('2026-11-15T00:00:00Z'),
  stamp: new Date('2026-08-22T12:00:00Z'),
  title: 'The 2026 Annual Gala',
  location: 'The Grand Hall, 1 Placeholder Avenue',
  description: 'Black tie. Cocktails at 6.',
}

describe('escapeIcsText', () => {
  it('escapes commas, semicolons and backslashes', () => {
    expect(escapeIcsText('a,b;c\\d')).toBe('a\\,b\\;c\\\\d')
  })

  it('escapes newlines as literal \\n', () => {
    expect(escapeIcsText('line1\nline2')).toBe('line1\\nline2')
  })

  it('normalises CRLF to a single escaped newline', () => {
    expect(escapeIcsText('line1\r\nline2')).toBe('line1\\nline2')
  })

  it('escapes the backslash before the comma, not after', () => {
    // Escaping in the wrong order double-escapes and corrupts the file.
    expect(escapeIcsText('\\,')).toBe('\\\\\\,')
  })
})

describe('foldIcsLine', () => {
  it('leaves a short line alone', () => {
    expect(foldIcsLine('SUMMARY:short')).toBe('SUMMARY:short')
  })

  it('folds a long line with CRLF and a leading space', () => {
    const folded = foldIcsLine('SUMMARY:' + 'x'.repeat(200))
    expect(folded).toContain('\r\n ')
    folded.split('\r\n').forEach((segment) => {
      expect(segment.length).toBeLessThanOrEqual(75)
    })
  })
})

describe('buildIcs', () => {
  it('produces a complete VCALENDAR', () => {
    const ics = buildIcs(base)
    expect(ics).toContain('BEGIN:VCALENDAR')
    expect(ics).toContain('VERSION:2.0')
    expect(ics).toContain('BEGIN:VEVENT')
    expect(ics).toContain('END:VEVENT')
    expect(ics).toContain('END:VCALENDAR')
  })

  it('uses CRLF line endings throughout', () => {
    const ics = buildIcs(base)
    expect(ics).toContain('\r\n')
    expect(ics.split('\r\n').join('')).not.toContain('\n')
  })

  it('formats timestamps as UTC basic format', () => {
    expect(buildIcs(base)).toContain('DTSTART:20261114T180000Z')
    expect(buildIcs(base)).toContain('DTEND:20261115T000000Z')
    expect(buildIcs(base)).toContain('DTSTAMP:20260822T120000Z')
  })

  it('carries the uid', () => {
    expect(buildIcs(base)).toContain('UID:invite-123@gala.example.com')
  })

  it('escapes a title containing a comma', () => {
    const ics = buildIcs({ ...base, title: 'Gala, 2026' })
    expect(ics).toContain('SUMMARY:Gala\\, 2026')
  })

  it('omits optional fields rather than emitting empty ones', () => {
    const ics = buildIcs({ ...base, description: undefined, location: undefined })
    expect(ics).not.toContain('DESCRIPTION:')
    expect(ics).not.toContain('LOCATION:')
  })

  it('never emits a line longer than 75 octets', () => {
    const ics = buildIcs({ ...base, description: 'y'.repeat(500) })
    ics.split('\r\n').forEach((line) => {
      expect(Buffer.byteLength(line, 'utf8')).toBeLessThanOrEqual(75)
    })
  })
})
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run tests/unit/ics.test.ts`
Expected: FAIL — cannot resolve `@/lib/guest/ics`.

- [ ] **Step 3: Implement `src/lib/guest/ics.ts`**

```ts
export type IcsEvent = {
  uid: string
  startsAt: Date
  endsAt: Date
  stamp: Date
  title: string
  description?: string | undefined
  location?: string | undefined
}

const MAX_OCTETS = 75

/** RFC 5545 §3.3.11. Backslash MUST be escaped first or later escapes double up. */
export function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\r\n/g, '\\n')
    .replace(/\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;')
}

/**
 * RFC 5545 §3.1: no line may exceed 75 octets. Continuations begin with a
 * single space. Measured in octets, not characters, so multi-byte content
 * folds correctly.
 */
export function foldIcsLine(line: string): string {
  if (Buffer.byteLength(line, 'utf8') <= MAX_OCTETS) return line

  const segments: string[] = []
  let current = ''
  let limit = MAX_OCTETS

  for (const char of line) {
    if (Buffer.byteLength(current + char, 'utf8') > limit) {
      segments.push(current)
      current = ' '
      limit = MAX_OCTETS
    }
    current += char
  }
  segments.push(current)
  return segments.join('\r\n')
}

/** UTC basic format: 20261114T180000Z */
function formatUtc(date: Date): string {
  return `${date.toISOString().replace(/[-:]/g, '').split('.')[0]}Z`
}

export function buildIcs(event: IcsEvent): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Gala RSVP//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${event.uid}`,
    `DTSTAMP:${formatUtc(event.stamp)}`,
    `DTSTART:${formatUtc(event.startsAt)}`,
    `DTEND:${formatUtc(event.endsAt)}`,
    `SUMMARY:${escapeIcsText(event.title)}`,
  ]

  if (event.location) lines.push(`LOCATION:${escapeIcsText(event.location)}`)
  if (event.description) lines.push(`DESCRIPTION:${escapeIcsText(event.description)}`)

  lines.push('END:VEVENT', 'END:VCALENDAR')
  return lines.map(foldIcsLine).join('\r\n')
}
```

- [ ] **Step 4: Run it and confirm it passes**

Run: `npx vitest run tests/unit/ics.test.ts`
Expected: PASS, 14 tests.

- [ ] **Step 5: Verify and commit**

```bash
npm run typecheck 2>&1 | grep -v "^>"
npm run lint
git add src/lib/guest/ics.ts tests/unit/ics.test.ts
git commit -m "feat: RFC 5545 calendar generation"
```

---

## Task 4: RSVP payload validation

**Files:**
- Create: `src/lib/validation/guest.ts`
- Test: `tests/unit/guest-validation.test.ts`

**Interfaces:**
- Consumes: nothing — pure Zod
- Produces:
  - `guestEntrySchema` → `{ id?: string; firstName: string; lastName: string; badgeName?: string; company?: string; title?: string; email?: string; phone?: string; mealOptionId?: string; dietary: string[]; accessibilityNeeds?: string }`
  - `rsvpSubmissionSchema` → `{ attending: boolean; guests: GuestEntry[]; extraSeatsRequested: number; extraSeatsReason?: string }`
  - `type RsvpSubmission = z.infer<typeof rsvpSubmissionSchema>`
  - `MAX_DIETARY_ENTRIES = 12`, `MAX_NOTE_LENGTH = 1000`

This is the outermost boundary of the whole system: unauthenticated input from a person holding a QR code. Bounds here are what stop a hostile payload from reaching the database.

- [ ] **Step 1: Write the failing test**

`tests/unit/guest-validation.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  rsvpSubmissionSchema, guestEntrySchema, MAX_DIETARY_ENTRIES, MAX_NOTE_LENGTH,
} from '@/lib/validation/guest'

const guest = { firstName: 'Jordan', lastName: 'Reyes', dietary: [] }

describe('guestEntrySchema', () => {
  it('accepts a minimal guest', () => {
    expect(guestEntrySchema.safeParse(guest).success).toBe(true)
  })

  it('requires a first and last name', () => {
    expect(guestEntrySchema.safeParse({ ...guest, firstName: '' }).success).toBe(false)
    expect(guestEntrySchema.safeParse({ ...guest, lastName: '  ' }).success).toBe(false)
  })

  it('trims surrounding whitespace', () => {
    const parsed = guestEntrySchema.parse({ ...guest, firstName: '  Jordan  ' })
    expect(parsed.firstName).toBe('Jordan')
  })

  it('rejects a malformed email but accepts an absent one', () => {
    expect(guestEntrySchema.safeParse({ ...guest, email: 'nope' }).success).toBe(false)
    expect(guestEntrySchema.safeParse({ ...guest, email: '' }).success).toBe(true)
    expect(guestEntrySchema.safeParse(guest).success).toBe(true)
  })

  it('lowercases an email', () => {
    expect(guestEntrySchema.parse({ ...guest, email: 'A@B.COM' }).email).toBe('a@b.com')
  })

  it('caps the number of dietary entries', () => {
    const tooMany = Array.from({ length: MAX_DIETARY_ENTRIES + 1 }, (_, i) => `d${i}`)
    expect(guestEntrySchema.safeParse({ ...guest, dietary: tooMany }).success).toBe(false)
  })

  it('caps the length of free text', () => {
    const long = 'x'.repeat(MAX_NOTE_LENGTH + 1)
    expect(guestEntrySchema.safeParse({ ...guest, accessibilityNeeds: long }).success).toBe(false)
  })

  it('rejects a mealOptionId that is not an ObjectId', () => {
    expect(guestEntrySchema.safeParse({ ...guest, mealOptionId: 'nope' }).success).toBe(false)
    expect(guestEntrySchema.safeParse({ ...guest, mealOptionId: 'a'.repeat(24) }).success).toBe(true)
  })

  it('rejects an id that is not an ObjectId', () => {
    // Ids arrive from the client and go straight into a Prisma where clause.
    expect(guestEntrySchema.safeParse({ ...guest, id: '../../etc' }).success).toBe(false)
  })
})

describe('rsvpSubmissionSchema', () => {
  const submission = { attending: true, guests: [guest], extraSeatsRequested: 0 }

  it('accepts a valid submission', () => {
    expect(rsvpSubmissionSchema.safeParse(submission).success).toBe(true)
  })

  it('requires at least one guest when attending', () => {
    expect(rsvpSubmissionSchema.safeParse({ ...submission, guests: [] }).success).toBe(false)
  })

  it('allows an empty guest list when declining', () => {
    const declined = { attending: false, guests: [], extraSeatsRequested: 0 }
    expect(rsvpSubmissionSchema.safeParse(declined).success).toBe(true)
  })

  it('rejects a negative extra-seat request', () => {
    expect(rsvpSubmissionSchema.safeParse({ ...submission, extraSeatsRequested: -1 }).success)
      .toBe(false)
  })

  it('rejects an absurd extra-seat request', () => {
    expect(rsvpSubmissionSchema.safeParse({ ...submission, extraSeatsRequested: 999 }).success)
      .toBe(false)
  })

  it('rejects more guests than any invite could hold', () => {
    const many = Array.from({ length: 41 }, () => guest)
    expect(rsvpSubmissionSchema.safeParse({ ...submission, guests: many }).success).toBe(false)
  })

  it('coerces the numeric field from a form string', () => {
    const parsed = rsvpSubmissionSchema.parse({ ...submission, extraSeatsRequested: '2' })
    expect(parsed.extraSeatsRequested).toBe(2)
  })
})
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run tests/unit/guest-validation.test.ts`
Expected: FAIL — cannot resolve `@/lib/validation/guest`.

- [ ] **Step 3: Implement `src/lib/validation/guest.ts`**

```ts
import { z } from 'zod'

export const MAX_DIETARY_ENTRIES = 12
export const MAX_NOTE_LENGTH = 1000
/** No invite may exceed 20 seats; 40 leaves headroom for an approved extra-seat request. */
const MAX_GUESTS_PER_SUBMISSION = 40
const MAX_EXTRA_SEATS = 20

const objectId = z.string().regex(/^[0-9a-f]{24}$/, 'Not a valid identifier')
const optionalText = (max: number) => z.string().trim().max(max).optional().or(z.literal(''))

export const guestEntrySchema = z.object({
  id: objectId.optional(),
  firstName: z.string().trim().min(1, 'First name is required').max(80),
  lastName: z.string().trim().min(1, 'Last name is required').max(80),
  badgeName: optionalText(80),
  company: optionalText(160),
  title: optionalText(160),
  email: z.string().trim().toLowerCase().email('Enter a valid email').optional().or(z.literal('')),
  phone: optionalText(40),
  mealOptionId: objectId.optional().or(z.literal('')),
  dietary: z.array(z.string().trim().min(1).max(120)).max(MAX_DIETARY_ENTRIES).default([]),
  accessibilityNeeds: optionalText(MAX_NOTE_LENGTH),
})

export type GuestEntry = z.infer<typeof guestEntrySchema>

export const rsvpSubmissionSchema = z
  .object({
    attending: z.coerce.boolean(),
    guests: z.array(guestEntrySchema).max(MAX_GUESTS_PER_SUBMISSION),
    extraSeatsRequested: z.coerce.number().int().min(0).max(MAX_EXTRA_SEATS).default(0),
    extraSeatsReason: optionalText(MAX_NOTE_LENGTH),
  })
  .refine((value) => !value.attending || value.guests.length > 0, {
    message: 'Tell us who is coming',
    path: ['guests'],
  })

export type RsvpSubmission = z.infer<typeof rsvpSubmissionSchema>
```

- [ ] **Step 4: Run it and confirm it passes**

Run: `npx vitest run tests/unit/guest-validation.test.ts`
Expected: PASS, 16 tests.

- [ ] **Step 5: Verify and commit**

```bash
npm run typecheck 2>&1 | grep -v "^>"
npm run lint
git add src/lib/validation/guest.ts tests/unit/guest-validation.test.ts
git commit -m "feat: RSVP payload validation"
```

---

## Task 5: RSVP submission

**Files:**
- Create: `src/lib/guest/rsvp.ts`
- Test: `tests/integration/rsvp.test.ts`

**Interfaces:**
- Consumes: `resolveInviteByToken` (Task 1), `assertRsvpOpen`/`RsvpClosedError` (Task 2), `RsvpSubmission` (Task 4), `deriveInviteStatus` from `@/lib/invites/status`, `writeAudit`, `hashToken`
- Produces:
  - `submitRsvp(db, token, submission, now: Date, deadline: Date): Promise<RsvpResult>` — both
    times are parameters, never read from the clock or the database inside the module
  - `RsvpResult` = `{ ok: true; inviteId: string; status: InviteStatus }` or `{ ok: false; reason: 'NOT_FOUND' | 'CLOSED' | 'SEAT_LIMIT' | 'FOREIGN_GUEST' }`
  - `SeatAllowanceError`, `ForeignGuestError`

**The property that makes or breaks this task.** A guest submits guest ids in the payload. Those ids go into a `where` clause. If the code does not verify every id belongs to *this* invite, a guest can rewrite another party's details by pasting their id — a horizontal privilege escalation across the entire guest list. The check is not optional and it must be tested with a genuinely foreign id.

- [ ] **Step 1: Write the failing test**

`tests/integration/rsvp.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { testDb, resetDb } from '../helpers/db'
import { submitRsvp } from '@/lib/guest/rsvp'
import { createInvite } from '@/lib/invites/repository'

const OPEN = new Date('2026-09-01T00:00:00Z')
const DEADLINE = new Date('2026-10-24T23:59:00Z')
const CLOSED = new Date('2026-11-01T00:00:00Z')

beforeEach(resetDb)
afterAll(() => testDb.$disconnect())

async function seedInvite(seats = 2) {
  return createInvite(testDb, null, {
    label: 'Reyes Party',
    seatsAllotted: seats,
    primaryGuest: { firstName: 'Jordan', lastName: 'Reyes', email: 'jordan@example.com' },
  })
}

const entry = (over: Record<string, unknown> = {}) => ({
  firstName: 'Jordan', lastName: 'Reyes', dietary: [], ...over,
})

describe('submitRsvp', () => {
  it('records an acceptance and marks the invite ATTENDING', async () => {
    const { invite, token } = await seedInvite()
    const primary = await testDb.guest.findFirstOrThrow({ where: { inviteId: invite.id } })

    const result = await submitRsvp(testDb, token, {
      attending: true,
      guests: [entry({ id: primary.id, company: 'Northwind', title: 'VP' })],
      extraSeatsRequested: 0,
    }, OPEN, DEADLINE)

    expect(result).toMatchObject({ ok: true, status: 'ATTENDING' })
    const fresh = await testDb.guest.findUniqueOrThrow({ where: { id: primary.id } })
    expect(fresh).toMatchObject({ attending: true, company: 'Northwind', title: 'VP' })
  })

  it('records a decline and marks the invite DECLINED', async () => {
    const { invite, token } = await seedInvite()
    const result = await submitRsvp(testDb, token,
      { attending: false, guests: [], extraSeatsRequested: 0 }, OPEN, DEADLINE)
    expect(result).toMatchObject({ ok: true, status: 'DECLINED' })
    const guests = await testDb.guest.findMany({ where: { inviteId: invite.id } })
    expect(guests.every((g) => g.attending === false)).toBe(true)
  })

  it('stamps respondedAt', async () => {
    const { invite, token } = await seedInvite()
    await submitRsvp(testDb, token,
      { attending: false, guests: [], extraSeatsRequested: 0 }, OPEN, DEADLINE)
    const fresh = await testDb.invite.findUniqueOrThrow({ where: { id: invite.id } })
    expect(fresh.respondedAt).not.toBeNull()
  })

  it('creates additional guests up to the seat allowance', async () => {
    const { invite, token } = await seedInvite(2)
    const primary = await testDb.guest.findFirstOrThrow({ where: { inviteId: invite.id } })
    await submitRsvp(testDb, token, {
      attending: true,
      guests: [entry({ id: primary.id }), entry({ firstName: 'Sam', lastName: 'Reyes' })],
      extraSeatsRequested: 0,
    }, OPEN, DEADLINE)
    expect(await testDb.guest.count({ where: { inviteId: invite.id } })).toBe(2)
  })

  it('refuses more guests than the seat allowance', async () => {
    const { token } = await seedInvite(1)
    const result = await submitRsvp(testDb, token, {
      attending: true,
      guests: [entry(), entry({ firstName: 'Sam' })],
      extraSeatsRequested: 0,
    }, OPEN, DEADLINE)
    expect(result).toEqual({ ok: false, reason: 'SEAT_LIMIT' })
  })

  it('REFUSES a guest id belonging to another invite', async () => {
    // Horizontal privilege escalation: without this check a guest could rewrite
    // any other party's details by pasting their guest id into the payload.
    const { token } = await seedInvite()
    const other = await createInvite(testDb, null, {
      label: 'Okafor Party', seatsAllotted: 1,
      primaryGuest: { firstName: 'Ada', lastName: 'Okafor' },
    })
    const victim = await testDb.guest.findFirstOrThrow({ where: { inviteId: other.invite.id } })

    const result = await submitRsvp(testDb, token, {
      attending: true,
      guests: [entry({ id: victim.id, firstName: 'Hijacked' })],
      extraSeatsRequested: 0,
    }, OPEN, DEADLINE)

    expect(result).toEqual({ ok: false, reason: 'FOREIGN_GUEST' })
    const untouched = await testDb.guest.findUniqueOrThrow({ where: { id: victim.id } })
    expect(untouched.firstName).toBe('Ada')
  })

  it('writes nothing at all when a foreign guest id is present', async () => {
    const { invite, token } = await seedInvite()
    const other = await createInvite(testDb, null, {
      label: 'Okafor Party', seatsAllotted: 1,
      primaryGuest: { firstName: 'Ada', lastName: 'Okafor' },
    })
    const victim = await testDb.guest.findFirstOrThrow({ where: { inviteId: other.invite.id } })
    const primary = await testDb.guest.findFirstOrThrow({ where: { inviteId: invite.id } })

    await submitRsvp(testDb, token, {
      attending: true,
      guests: [entry({ id: primary.id, company: 'Should not persist' }), entry({ id: victim.id })],
      extraSeatsRequested: 0,
    }, OPEN, DEADLINE)

    const fresh = await testDb.guest.findUniqueOrThrow({ where: { id: primary.id } })
    expect(fresh.company).toBeNull()
  })

  it('refuses once the deadline has passed', async () => {
    const { token } = await seedInvite()
    const result = await submitRsvp(testDb, token,
      { attending: false, guests: [], extraSeatsRequested: 0 }, CLOSED, DEADLINE)
    expect(result).toEqual({ ok: false, reason: 'CLOSED' })
  })

  it('refuses an unknown token', async () => {
    const result = await submitRsvp(testDb, 'nope',
      { attending: false, guests: [], extraSeatsRequested: 0 }, OPEN, DEADLINE)
    expect(result).toEqual({ ok: false, reason: 'NOT_FOUND' })
  })

  it('records an extra-seat request as PENDING without creating seats', async () => {
    const { invite, token } = await seedInvite(1)
    await submitRsvp(testDb, token, {
      attending: true,
      guests: [entry()],
      extraSeatsRequested: 2,
      extraSeatsReason: 'Bringing my parents',
    }, OPEN, DEADLINE)

    const fresh = await testDb.invite.findUniqueOrThrow({ where: { id: invite.id } })
    expect(fresh.extraSeatsStatus).toBe('PENDING')
    expect(fresh.extraSeatsRequested).toBe(2)
    expect(fresh.seatsAllotted).toBe(1)
  })

  it('is idempotent — resubmitting replaces rather than duplicates', async () => {
    const { invite, token } = await seedInvite(2)
    const payload = {
      attending: true,
      guests: [entry(), entry({ firstName: 'Sam' })],
      extraSeatsRequested: 0,
    }
    await submitRsvp(testDb, token, payload, OPEN, DEADLINE)
    await submitRsvp(testDb, token, payload, OPEN, DEADLINE)
    expect(await testDb.guest.count({ where: { inviteId: invite.id } })).toBe(2)
  })

  it('audits the submission without recording the token', async () => {
    const { token } = await seedInvite()
    await submitRsvp(testDb, token,
      { attending: false, guests: [], extraSeatsRequested: 0 }, OPEN, DEADLINE)
    const log = await testDb.auditLog.findFirst({ where: { action: 'rsvp.submit' } })
    expect(log).not.toBeNull()
    expect(log?.actorId).toBeNull()
    expect(JSON.stringify(log)).not.toContain(token)
  })
})
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `DATABASE_URL_TEST="mongodb://127.0.0.1:27018/gala_test_p2b?replicaSet=rs0" npx vitest run tests/integration/rsvp.test.ts`
Expected: FAIL — cannot resolve `@/lib/guest/rsvp`.

- [ ] **Step 3: Implement `src/lib/guest/rsvp.ts`**

```ts
import type { PrismaClient } from '@prisma/client'
import { hashToken } from '@/lib/crypto/tokens'
import { deriveInviteStatus, type InviteStatus } from '@/lib/invites/status'
import { writeAudit } from '@/lib/audit'
import { rsvpWindow } from './deadline'
import type { RsvpSubmission } from '@/lib/validation/guest'

export type RsvpResult =
  | { ok: true; inviteId: string; status: InviteStatus }
  | { ok: false; reason: 'NOT_FOUND' | 'CLOSED' | 'SEAT_LIMIT' | 'FOREIGN_GUEST' }

/**
 * Applies a guest's RSVP.
 *
 * The whole thing is one transaction: a party that half-submits is worse than
 * one that fails, because nobody notices. `now` and `deadline` are parameters
 * rather than reads of the clock and the database so the boundary is testable.
 */
export async function submitRsvp(
  db: PrismaClient,
  token: string,
  submission: RsvpSubmission,
  now: Date,
  deadline: Date,
): Promise<RsvpResult> {
  if (!token) return { ok: false, reason: 'NOT_FOUND' }
  if (rsvpWindow(deadline, now).hasClosed) return { ok: false, reason: 'CLOSED' }

  const invite = await db.invite.findUnique({
    where: { tokenHash: hashToken(token) },
    select: { id: true, seatsAllotted: true, guests: { select: { id: true } } },
  })
  if (!invite) return { ok: false, reason: 'NOT_FOUND' }

  if (submission.attending && submission.guests.length > invite.seatsAllotted) {
    return { ok: false, reason: 'SEAT_LIMIT' }
  }

  // Every submitted id must already belong to THIS invite. Without this a guest
  // could rewrite another party's details by pasting their guest id.
  const ownIds = new Set(invite.guests.map((g) => g.id))
  const submittedIds = submission.guests.map((g) => g.id).filter((id): id is string => !!id)
  if (submittedIds.some((id) => !ownIds.has(id))) {
    return { ok: false, reason: 'FOREIGN_GUEST' }
  }

  const status = await db.$transaction(async (tx) => {
    if (!submission.attending) {
      await tx.guest.updateMany({ where: { inviteId: invite.id }, data: { attending: false } })
    } else {
      const keptIds = new Set(submittedIds)

      for (const entry of submission.guests) {
        const data = {
          firstName: entry.firstName,
          lastName: entry.lastName,
          badgeName: entry.badgeName || null,
          company: entry.company || null,
          title: entry.title || null,
          email: entry.email || null,
          phone: entry.phone || null,
          mealOptionId: entry.mealOptionId || null,
          dietary: entry.dietary,
          accessibilityNeeds: entry.accessibilityNeeds || null,
          attending: true,
        }

        if (entry.id) {
          await tx.guest.update({ where: { id: entry.id }, data })
        } else {
          const created = await tx.guest.create({ data: { ...data, inviteId: invite.id } })
          keptIds.add(created.id)
        }
      }

      // Seats the party gave back: previously-known guests they did not resubmit.
      await tx.guest.deleteMany({
        where: { inviteId: invite.id, id: { notIn: [...keptIds] } },
      })
    }

    const guests = await tx.guest.findMany({
      where: { inviteId: invite.id },
      select: { attending: true },
    })
    const nextStatus = deriveInviteStatus(guests)

    await tx.invite.update({
      where: { id: invite.id },
      data: {
        status: nextStatus,
        respondedAt: now,
        ...(submission.extraSeatsRequested > 0
          ? {
              extraSeatsRequested: submission.extraSeatsRequested,
              extraSeatsStatus: 'PENDING' as const,
              extraSeatsReason: submission.extraSeatsReason || null,
            }
          : {}),
      },
    })

    await writeAudit(tx, {
      actorId: null,
      action: 'rsvp.submit',
      entity: 'Invite',
      entityId: invite.id,
      meta: {
        attending: submission.attending,
        partySize: submission.guests.length,
        extraSeatsRequested: submission.extraSeatsRequested,
      },
    })

    return nextStatus
  })

  return { ok: true, inviteId: invite.id, status }
}
```

- [ ] **Step 4: Run it and confirm it passes**

Run: `DATABASE_URL_TEST="mongodb://127.0.0.1:27018/gala_test_p2b?replicaSet=rs0" npx vitest run tests/integration/rsvp.test.ts`
Expected: PASS, 13 tests.

- [ ] **Step 5: Prove the foreign-guest check is load-bearing**

Temporarily delete the `FOREIGN_GUEST` block, re-run, and confirm the two foreign-guest tests FAIL. Restore it with `git checkout src/lib/guest/rsvp.ts` if committed, or by re-adding the block. Record both outputs in your report. A guard whose removal breaks no test is not a guard.

- [ ] **Step 6: Verify and commit**

```bash
npm run typecheck 2>&1 | grep -v "^>"
npm run lint
git add src/lib/guest/rsvp.ts tests/integration/rsvp.test.ts
git commit -m "feat: transactional RSVP submission"
```

---

## Task 6: Extend CSRF coverage to the guest portal

**Files:**
- Create: `src/lib/auth/csrf-routes.ts`
- Modify: `src/middleware.ts`
- Test: `tests/unit/csrf-routes.test.ts`

**Interfaces:**
- Consumes: `CSRF_COOKIE`, `issueCsrfToken` from `@/lib/auth/csrf`
- Produces: `matchesCsrfRoute(pathname: string): boolean` from `@/lib/auth/csrf-routes`

**Why a separate module rather than an export from `middleware.ts`.** `src/middleware.ts`
imports `next/server` at the top level, and it is bundled for the **Edge** runtime. A Vitest
unit test importing it would drag `next/server` into a plain Node environment — and this
project has already shipped one Edge bundling failure that 500'd every `/admin` request
because a Node-only import sat at module scope. The predicate is pure; it belongs in
`src/lib/`, where every other pure module in this codebase lives.

The guest RSVP form is a state-changing POST from an unauthenticated origin. It needs the same double-submit protection every admin form has. Middleware currently matches `/admin/:path*` only, so a `CsrfInput` on the guest page would find no cookie and throw.

- [ ] **Step 1: Write the failing test**

`tests/unit/csrf-routes.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { matchesCsrfRoute } from '@/lib/auth/csrf-routes'

describe('matchesCsrfRoute', () => {
  it('covers the admin panel', () => {
    expect(matchesCsrfRoute('/admin')).toBe(true)
    expect(matchesCsrfRoute('/admin/invites')).toBe(true)
    expect(matchesCsrfRoute('/admin/invites/abc123')).toBe(true)
  })

  it('covers the guest portal', () => {
    expect(matchesCsrfRoute('/i/sometoken')).toBe(true)
    expect(matchesCsrfRoute('/i/sometoken/calendar')).toBe(true)
  })

  it('does not cover the marketing root', () => {
    expect(matchesCsrfRoute('/')).toBe(false)
  })

  it('does not cover unrelated paths that merely start with the same letters', () => {
    expect(matchesCsrfRoute('/administrator')).toBe(false)
    expect(matchesCsrfRoute('/images/logo.png')).toBe(false)
    expect(matchesCsrfRoute('/index')).toBe(false)
  })
})
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run tests/unit/csrf-routes.test.ts`
Expected: FAIL — cannot resolve `@/lib/auth/csrf-routes`.

- [ ] **Step 3: Create `src/lib/auth/csrf-routes.ts`**

```ts
/**
 * Routes that render a state-changing form and therefore need the CSRF cookie
 * in place before render.
 *
 * Pure and framework-free so it can be unit-tested without `next/server`, which
 * `src/middleware.ts` pulls into the Edge bundle. `middleware.ts`'s
 * `config.matcher` must stay in step with this predicate — the test below is
 * what keeps the intent honest.
 *
 * `/administrator` and `/index` must NOT match; a naive prefix test catches both.
 */
export function matchesCsrfRoute(pathname: string): boolean {
  return pathname === '/admin' || pathname.startsWith('/admin/') || pathname.startsWith('/i/')
}
```

- [ ] **Step 4: Widen the matcher in `src/middleware.ts`**

Keep the existing cookie logic exactly as it is — only the matcher changes:

```ts
export const config = {
  matcher: ['/admin/:path*', '/i/:path*'],
}
```

- [ ] **Step 5: Run it and confirm it passes**

Run: `npx vitest run tests/unit/csrf-routes.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 6: Confirm the Edge bundle still loads**

`src/middleware.ts` runs on the Edge runtime, where `node:crypto` and `Buffer` do not exist. A regression here 500s every matched route, and only a real request catches it.

```bash
npm run build
npm run test:e2e          # 56 must still pass
git checkout tsconfig.json
```

- [ ] **Step 7: Commit**

```bash
npm run typecheck 2>&1 | grep -v "^>"
npm run lint
git add src/lib/auth/csrf-routes.ts src/middleware.ts tests/unit/csrf-routes.test.ts
git commit -m "feat: extend CSRF bootstrap to the guest portal"
```

---

## Task 7: Event repository

**Files:**
- Create: `src/lib/events/repository.ts`, `src/lib/validation/event.ts`
- Test: `tests/integration/events.test.ts`

**Interfaces:**
- Consumes: `writeAudit`
- Produces:
  - `type EventDetail = { id, name, tagline, startsAt, timezone, venueName, address, dressCode, rsvpDeadline, floorplanAssetId, agendaItems: AgendaItemRow[], mealOptions: MealOptionRow[], tableMarkers: TableMarkerRow[] }`
  - `AgendaItemRow` = `{ id, startsAt, title, description, icon, sortOrder }`
  - `MealOptionRow` = `{ id, label, description, sortOrder, isActive }`
  - `TableMarkerRow` = `{ id, tableNumber, x, y }`
  - `getEvent(db): Promise<EventDetail | null>` — the singleton, oldest-first so a stray second row cannot shadow it
  - `updateEventDetails(db, actorId, id, patch): Promise<void>`
  - `upsertAgendaItem(db, actorId, eventId, input): Promise<string>`
  - `deleteAgendaItem(db, actorId, id): Promise<void>`
  - `upsertMealOption(db, actorId, eventId, input): Promise<string>`
  - `setMealOptionActive(db, actorId, id, isActive): Promise<void>`
  - `EventNotConfiguredError`
- `src/lib/validation/event.ts` produces `eventDetailsSchema`, `agendaItemSchema`, `mealOptionSchema`

Meal options are **deactivated, never deleted** — a `Guest.mealOptionId` may already point at one, and MongoDB has no foreign keys to stop a delete from stranding it.

- [ ] **Step 1: Write the failing test**

`tests/integration/events.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { testDb, resetDb } from '../helpers/db'
import {
  getEvent, updateEventDetails, upsertAgendaItem, deleteAgendaItem,
  upsertMealOption, setMealOptionActive,
} from '@/lib/events/repository'

beforeEach(resetDb)
afterAll(() => testDb.$disconnect())

async function seedEvent() {
  return testDb.event.create({
    data: {
      name: 'The 2026 Annual Gala',
      startsAt: new Date('2026-11-14T18:00:00Z'),
      venueName: 'The Grand Hall',
      address: '1 Placeholder Avenue',
      rsvpDeadline: new Date('2026-10-24T23:59:00Z'),
    },
  })
}

describe('event repository', () => {
  it('returns null before an event is configured', async () => {
    expect(await getEvent(testDb)).toBeNull()
  })

  it('loads the event with its empty collections', async () => {
    await seedEvent()
    const event = await getEvent(testDb)
    expect(event).toMatchObject({ name: 'The 2026 Annual Gala', venueName: 'The Grand Hall' })
    expect(event?.agendaItems).toEqual([])
    expect(event?.mealOptions).toEqual([])
    expect(event?.tableMarkers).toEqual([])
  })

  it('updates editable details and audits the change', async () => {
    const seeded = await seedEvent()
    await updateEventDetails(testDb, null, seeded.id, { name: 'Renamed', dressCode: 'Black tie' })
    const event = await getEvent(testDb)
    expect(event).toMatchObject({ name: 'Renamed', dressCode: 'Black tie' })
    expect(await testDb.auditLog.count({ where: { action: 'event.update' } })).toBe(1)
  })

  it('adds agenda items and returns them in sortOrder', async () => {
    const seeded = await seedEvent()
    await upsertAgendaItem(testDb, null, seeded.id, {
      title: 'Dinner', startsAt: new Date('2026-11-14T19:00:00Z'), sortOrder: 1,
    })
    await upsertAgendaItem(testDb, null, seeded.id, {
      title: 'Cocktails', startsAt: new Date('2026-11-14T18:00:00Z'), sortOrder: 0,
    })
    const event = await getEvent(testDb)
    expect(event?.agendaItems.map((a) => a.title)).toEqual(['Cocktails', 'Dinner'])
  })

  it('updates an existing agenda item rather than duplicating it', async () => {
    const seeded = await seedEvent()
    const id = await upsertAgendaItem(testDb, null, seeded.id, {
      title: 'Dinner', startsAt: new Date('2026-11-14T19:00:00Z'), sortOrder: 0,
    })
    await upsertAgendaItem(testDb, null, seeded.id, {
      id, title: 'Dinner service', startsAt: new Date('2026-11-14T19:30:00Z'), sortOrder: 0,
    })
    const event = await getEvent(testDb)
    expect(event?.agendaItems).toHaveLength(1)
    expect(event?.agendaItems[0]?.title).toBe('Dinner service')
  })

  it('deletes an agenda item', async () => {
    const seeded = await seedEvent()
    const id = await upsertAgendaItem(testDb, null, seeded.id, {
      title: 'Dinner', startsAt: new Date('2026-11-14T19:00:00Z'), sortOrder: 0,
    })
    await deleteAgendaItem(testDb, null, id)
    expect((await getEvent(testDb))?.agendaItems).toEqual([])
  })

  it('adds meal options', async () => {
    const seeded = await seedEvent()
    await upsertMealOption(testDb, null, seeded.id, { label: 'Beef', sortOrder: 0 })
    expect((await getEvent(testDb))?.mealOptions[0]?.label).toBe('Beef')
  })

  it('DEACTIVATES a meal option instead of deleting it, so a guest choice is never stranded', async () => {
    const seeded = await seedEvent()
    const mealId = await upsertMealOption(testDb, null, seeded.id, { label: 'Beef', sortOrder: 0 })
    const invite = await testDb.invite.create({
      data: { tokenHash: 'h', tokenCipher: 'c', label: 'Party' },
    })
    await testDb.guest.create({
      data: { inviteId: invite.id, firstName: 'A', lastName: 'B', mealOptionId: mealId },
    })

    await setMealOptionActive(testDb, null, mealId, false)

    const event = await getEvent(testDb)
    expect(event?.mealOptions).toHaveLength(1)
    expect(event?.mealOptions[0]?.isActive).toBe(false)
    const guest = await testDb.guest.findFirstOrThrow()
    expect(guest.mealOptionId).toBe(mealId)
  })

  it('returns the oldest event when more than one somehow exists', async () => {
    const first = await seedEvent()
    await testDb.event.create({
      data: {
        name: 'Stray second event',
        startsAt: new Date('2027-01-01T00:00:00Z'),
        venueName: 'Elsewhere',
        address: 'Nowhere',
        rsvpDeadline: new Date('2026-12-01T00:00:00Z'),
      },
    })
    expect((await getEvent(testDb))?.id).toBe(first.id)
  })

  it('audits every mutation', async () => {
    const seeded = await seedEvent()
    const agendaId = await upsertAgendaItem(testDb, null, seeded.id, {
      title: 'Dinner', startsAt: new Date('2026-11-14T19:00:00Z'), sortOrder: 0,
    })
    await deleteAgendaItem(testDb, null, agendaId)
    const mealId = await upsertMealOption(testDb, null, seeded.id, { label: 'Beef', sortOrder: 0 })
    await setMealOptionActive(testDb, null, mealId, false)
    const actions = (await testDb.auditLog.findMany()).map((l) => l.action)
    expect(actions).toEqual(expect.arrayContaining([
      'agendaItem.upsert', 'agendaItem.delete', 'mealOption.upsert', 'mealOption.setActive',
    ]))
  })
})
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `DATABASE_URL_TEST="mongodb://127.0.0.1:27018/gala_test_p2c?replicaSet=rs0" npx vitest run tests/integration/events.test.ts`
Expected: FAIL — cannot resolve `@/lib/events/repository`.

- [ ] **Step 3: Implement `src/lib/validation/event.ts`**

```ts
import { z } from 'zod'

const objectId = z.string().regex(/^[0-9a-f]{24}$/, 'Not a valid identifier')
const optionalText = (max: number) => z.string().trim().max(max).optional().or(z.literal(''))

export const eventDetailsSchema = z.object({
  name: z.string().trim().min(1, 'Event name is required').max(160),
  tagline: optionalText(200),
  startsAt: z.coerce.date(),
  timezone: z.string().trim().min(1).max(64).default('UTC'),
  venueName: z.string().trim().min(1, 'Venue is required').max(160),
  address: z.string().trim().min(1, 'Address is required').max(400),
  dressCode: optionalText(120),
  rsvpDeadline: z.coerce.date(),
}).refine((v) => v.rsvpDeadline.getTime() < v.startsAt.getTime(), {
  message: 'The RSVP deadline must fall before the event starts',
  path: ['rsvpDeadline'],
})

export const agendaItemSchema = z.object({
  id: objectId.optional(),
  title: z.string().trim().min(1, 'Title is required').max(160),
  description: optionalText(1000),
  icon: optionalText(40),
  startsAt: z.coerce.date(),
  sortOrder: z.coerce.number().int().min(0).max(999).default(0),
})

export const mealOptionSchema = z.object({
  id: objectId.optional(),
  label: z.string().trim().min(1, 'Label is required').max(80),
  description: optionalText(400),
  sortOrder: z.coerce.number().int().min(0).max(999).default(0),
})
```

- [ ] **Step 4: Implement `src/lib/events/repository.ts`**

```ts
import type { PrismaClient, Prisma } from '@prisma/client'
import { writeAudit } from '@/lib/audit'

export class EventNotConfiguredError extends Error {
  constructor() {
    super('No event has been configured yet')
    this.name = 'EventNotConfiguredError'
  }
}

export type AgendaItemRow = {
  id: string; startsAt: Date; title: string
  description: string | null; icon: string | null; sortOrder: number
}
export type MealOptionRow = {
  id: string; label: string; description: string | null; sortOrder: number; isActive: boolean
}
export type TableMarkerRow = { id: string; tableNumber: string; x: number; y: number }

export type EventDetail = {
  id: string; name: string; tagline: string | null
  startsAt: Date; timezone: string; venueName: string; address: string
  dressCode: string | null; rsvpDeadline: Date; floorplanAssetId: string | null
  agendaItems: AgendaItemRow[]
  mealOptions: MealOptionRow[]
  tableMarkers: TableMarkerRow[]
}

const SELECT = {
  id: true, name: true, tagline: true, startsAt: true, timezone: true,
  venueName: true, address: true, dressCode: true, rsvpDeadline: true, floorplanAssetId: true,
  agendaItems: {
    select: { id: true, startsAt: true, title: true, description: true, icon: true, sortOrder: true },
    orderBy: [{ sortOrder: 'asc' }, { startsAt: 'asc' }],
  },
  mealOptions: {
    select: { id: true, label: true, description: true, sortOrder: true, isActive: true },
    orderBy: { sortOrder: 'asc' },
  },
  tableMarkers: {
    select: { id: true, tableNumber: true, x: true, y: true },
    orderBy: { tableNumber: 'asc' },
  },
} satisfies Prisma.EventSelect

/**
 * This deployment serves one event. `findFirst` ordered oldest-first rather
 * than `findUnique` on a known id: the id is not knowable at build time, and
 * ordering means a stray second row can never shadow the real one.
 */
export async function getEvent(db: PrismaClient): Promise<EventDetail | null> {
  const event = await db.event.findFirst({ select: SELECT, orderBy: { createdAt: 'asc' } })
  return event as EventDetail | null
}

export type EventDetailsPatch = Partial<{
  name: string; tagline: string; startsAt: Date; timezone: string
  venueName: string; address: string; dressCode: string; rsvpDeadline: Date
}>

export async function updateEventDetails(
  db: PrismaClient, actorId: string | null, id: string, patch: EventDetailsPatch,
): Promise<void> {
  await db.$transaction(async (tx) => {
    await tx.event.update({
      where: { id },
      data: {
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.tagline !== undefined ? { tagline: patch.tagline || null } : {}),
        ...(patch.startsAt !== undefined ? { startsAt: patch.startsAt } : {}),
        ...(patch.timezone !== undefined ? { timezone: patch.timezone } : {}),
        ...(patch.venueName !== undefined ? { venueName: patch.venueName } : {}),
        ...(patch.address !== undefined ? { address: patch.address } : {}),
        ...(patch.dressCode !== undefined ? { dressCode: patch.dressCode || null } : {}),
        ...(patch.rsvpDeadline !== undefined ? { rsvpDeadline: patch.rsvpDeadline } : {}),
      },
    })
    await writeAudit(tx, {
      actorId, action: 'event.update', entity: 'Event', entityId: id, meta: { ...patch },
    })
  })
}

export type AgendaItemInput = {
  id?: string; title: string; description?: string; icon?: string
  startsAt: Date; sortOrder: number
}

export async function upsertAgendaItem(
  db: PrismaClient, actorId: string | null, eventId: string, input: AgendaItemInput,
): Promise<string> {
  return db.$transaction(async (tx) => {
    const data = {
      title: input.title,
      description: input.description || null,
      icon: input.icon || null,
      startsAt: input.startsAt,
      sortOrder: input.sortOrder,
    }
    const item = input.id
      ? await tx.agendaItem.update({ where: { id: input.id }, data })
      : await tx.agendaItem.create({ data: { ...data, eventId } })

    await writeAudit(tx, {
      actorId, action: 'agendaItem.upsert', entity: 'AgendaItem', entityId: item.id,
      meta: { title: input.title, created: !input.id },
    })
    return item.id
  })
}

export async function deleteAgendaItem(
  db: PrismaClient, actorId: string | null, id: string,
): Promise<void> {
  await db.$transaction(async (tx) => {
    await tx.agendaItem.delete({ where: { id } })
    await writeAudit(tx, { actorId, action: 'agendaItem.delete', entity: 'AgendaItem', entityId: id })
  })
}

export type MealOptionInput = { id?: string; label: string; description?: string; sortOrder: number }

export async function upsertMealOption(
  db: PrismaClient, actorId: string | null, eventId: string, input: MealOptionInput,
): Promise<string> {
  return db.$transaction(async (tx) => {
    const data = {
      label: input.label,
      description: input.description || null,
      sortOrder: input.sortOrder,
    }
    const meal = input.id
      ? await tx.mealOption.update({ where: { id: input.id }, data })
      : await tx.mealOption.create({ data: { ...data, eventId } })

    await writeAudit(tx, {
      actorId, action: 'mealOption.upsert', entity: 'MealOption', entityId: meal.id,
      meta: { label: input.label, created: !input.id },
    })
    return meal.id
  })
}

/**
 * Meal options are deactivated, never deleted. A `Guest.mealOptionId` may
 * already point at one, and MongoDB has no foreign key to stop a delete from
 * stranding that reference — the guest's dinner choice would silently vanish.
 */
export async function setMealOptionActive(
  db: PrismaClient, actorId: string | null, id: string, isActive: boolean,
): Promise<void> {
  await db.$transaction(async (tx) => {
    await tx.mealOption.update({ where: { id }, data: { isActive } })
    await writeAudit(tx, {
      actorId, action: 'mealOption.setActive', entity: 'MealOption', entityId: id,
      meta: { isActive },
    })
  })
}
```

- [ ] **Step 5: Run it and confirm it passes**

Run: `DATABASE_URL_TEST="mongodb://127.0.0.1:27018/gala_test_p2c?replicaSet=rs0" npx vitest run tests/integration/events.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 6: Verify and commit**

```bash
npm run typecheck 2>&1 | grep -v "^>"
npm run lint
git add src/lib/events/repository.ts src/lib/validation/event.ts tests/integration/events.test.ts
git commit -m "feat: event, agenda and meal-option repository"
```

---

## Task 8: Guest portal page

**Files:**
- Create: `src/lib/guest/page-data.ts`, `src/app/i/[token]/page.tsx`, `src/app/i/[token]/not-found.tsx`, `src/components/guest/agenda-timeline.tsx`, `src/components/guest/seat-map.tsx`
- Test: `tests/integration/guest-page-data.test.ts`

**Interfaces:**
- Consumes: `resolveInviteByToken` (Task 1), `getEvent` (Task 7), `rsvpWindow` (Task 2)
- Produces:
  - `type GuestPageData = { invite: GuestInvite; event: EventDetail; window: RsvpWindow; table: string | null; marker: TableMarkerRow | null }`
  - `loadGuestPage(db, token, now): Promise<GuestPageData | null>`
  - `<AgendaTimeline items={AgendaItemRow[]} timezone={string} />`
  - `<SeatMap floorplanAssetId marker table />`
- Renders against: `<RsvpForm token invite mealOptions csrf />`, created in **Task 9**. Its full
  prop contract is fixed here; Task 9 implements exactly that signature and changes nothing in
  `page.tsx`.

**Table resolution:** a guest's own `tableNumber` overrides their invite's, per spec §8. The marker is looked up from the resolved number, so a party split across tables still points each guest at the right one.

**Structure over styling.** Plan 3 animates this markup. Use `<main>`, a single `<h1>`, `<section aria-labelledby>` per act, an ordered list for the agenda, and real `<time datetime>` elements. Do not add motion, transitions, or scroll listeners — that is Plan 3's job and duplicating it here creates conflicts.

- [ ] **Step 1: Write the failing test**

`tests/integration/guest-page-data.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { testDb, resetDb } from '../helpers/db'
import { loadGuestPage } from '@/lib/guest/page-data'
import { createInvite } from '@/lib/invites/repository'

const NOW = new Date('2026-09-01T00:00:00Z')

beforeEach(resetDb)
afterAll(() => testDb.$disconnect())

async function seedEvent() {
  return testDb.event.create({
    data: {
      name: 'Gala', startsAt: new Date('2026-11-14T18:00:00Z'),
      venueName: 'The Grand Hall', address: '1 Placeholder Avenue',
      rsvpDeadline: new Date('2026-10-24T23:59:00Z'),
      tableMarkers: { create: [{ tableNumber: '12', x: 0.4, y: 0.6 }] },
    },
  })
}

describe('loadGuestPage', () => {
  it('returns null for an unknown token', async () => {
    await seedEvent()
    expect(await loadGuestPage(testDb, 'nope', NOW)).toBeNull()
  })

  it('returns null when no event is configured', async () => {
    const { token } = await createInvite(testDb, null, {
      label: 'P', seatsAllotted: 1, primaryGuest: { firstName: 'A', lastName: 'B' },
    })
    expect(await loadGuestPage(testDb, token, NOW)).toBeNull()
  })

  it('assembles the invite, event and open window', async () => {
    await seedEvent()
    const { token } = await createInvite(testDb, null, {
      label: 'Reyes Party', seatsAllotted: 2, tableNumber: '12',
      primaryGuest: { firstName: 'Jordan', lastName: 'Reyes' },
    })
    const data = await loadGuestPage(testDb, token, NOW)
    expect(data?.event.name).toBe('Gala')
    expect(data?.invite.label).toBe('Reyes Party')
    expect(data?.window.isOpen).toBe(true)
  })

  it('resolves the table from the invite and finds its marker', async () => {
    await seedEvent()
    const { token } = await createInvite(testDb, null, {
      label: 'P', seatsAllotted: 1, tableNumber: '12',
      primaryGuest: { firstName: 'A', lastName: 'B' },
    })
    const data = await loadGuestPage(testDb, token, NOW)
    expect(data?.table).toBe('12')
    expect(data?.marker).toMatchObject({ tableNumber: '12', x: 0.4, y: 0.6 })
  })

  it("prefers the primary guest's own table over the invite's", async () => {
    await seedEvent()
    const { invite, token } = await createInvite(testDb, null, {
      label: 'P', seatsAllotted: 1, tableNumber: '12',
      primaryGuest: { firstName: 'A', lastName: 'B' },
    })
    await testDb.guest.updateMany({ where: { inviteId: invite.id }, data: { tableNumber: '3' } })
    const data = await loadGuestPage(testDb, token, NOW)
    expect(data?.table).toBe('3')
  })

  it('returns a null marker when the table has no placed marker', async () => {
    await seedEvent()
    const { token } = await createInvite(testDb, null, {
      label: 'P', seatsAllotted: 1, tableNumber: '99',
      primaryGuest: { firstName: 'A', lastName: 'B' },
    })
    const data = await loadGuestPage(testDb, token, NOW)
    expect(data?.table).toBe('99')
    expect(data?.marker).toBeNull()
  })

  it('reports a closed window after the deadline', async () => {
    await seedEvent()
    const { token } = await createInvite(testDb, null, {
      label: 'P', seatsAllotted: 1, primaryGuest: { firstName: 'A', lastName: 'B' },
    })
    const data = await loadGuestPage(testDb, token, new Date('2026-11-01T00:00:00Z'))
    expect(data?.window.isOpen).toBe(false)
  })

  it('exposes only active meal options', async () => {
    const event = await seedEvent()
    await testDb.mealOption.create({
      data: { eventId: event.id, label: 'Beef', sortOrder: 0 },
    })
    await testDb.mealOption.create({
      data: { eventId: event.id, label: 'Retired', sortOrder: 1, isActive: false },
    })
    const { token } = await createInvite(testDb, null, {
      label: 'P', seatsAllotted: 1, primaryGuest: { firstName: 'A', lastName: 'B' },
    })
    const data = await loadGuestPage(testDb, token, NOW)
    expect(data?.event.mealOptions.map((m) => m.label)).toEqual(['Beef'])
  })
})
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `DATABASE_URL_TEST="mongodb://127.0.0.1:27018/gala_test_p2c?replicaSet=rs0" npx vitest run tests/integration/guest-page-data.test.ts`
Expected: FAIL — cannot resolve `@/lib/guest/page-data`.

- [ ] **Step 3: Implement `src/lib/guest/page-data.ts`**

```ts
import type { PrismaClient } from '@prisma/client'
import { resolveInviteByToken, type GuestInvite } from './resolve'
import { getEvent, type EventDetail, type TableMarkerRow } from '@/lib/events/repository'
import { rsvpWindow, type RsvpWindow } from './deadline'

export type GuestPageData = {
  invite: GuestInvite
  event: EventDetail
  window: RsvpWindow
  table: string | null
  marker: TableMarkerRow | null
}

/**
 * Everything the guest page renders, in one call.
 *
 * Returns null both for an unknown token and for an unconfigured event — the
 * page renders the same "we could not find your invitation" state either way,
 * because distinguishing them for the visitor would leak whether a token is
 * merely wrong or genuinely valid.
 */
export async function loadGuestPage(
  db: PrismaClient,
  token: string,
  now: Date,
): Promise<GuestPageData | null> {
  const [invite, event] = await Promise.all([resolveInviteByToken(db, token), getEvent(db)])
  if (!invite || !event) return null

  // Spec §8: a guest's own table overrides the invite's, so a party split
  // across tables still sends each person to the right one.
  const primary = invite.guests.find((guest) => guest.isPrimary) ?? invite.guests[0]
  const table = primary?.tableNumber ?? invite.tableNumber ?? null

  const marker = table
    ? (event.tableMarkers.find((candidate) => candidate.tableNumber === table) ?? null)
    : null

  return {
    invite,
    event: { ...event, mealOptions: event.mealOptions.filter((meal) => meal.isActive) },
    window: rsvpWindow(event.rsvpDeadline, now),
    table,
    marker,
  }
}
```

- [ ] **Step 4: Run it and confirm it passes**

Run: `DATABASE_URL_TEST="mongodb://127.0.0.1:27018/gala_test_p2c?replicaSet=rs0" npx vitest run tests/integration/guest-page-data.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Build the page and its components**

`src/components/guest/agenda-timeline.tsx`:

```tsx
import type { AgendaItemRow } from '@/lib/events/repository'

function formatTime(value: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric', minute: '2-digit', timeZone: timezone,
  }).format(value)
}

/**
 * Semantic structure Plan 3 animates: an ordered list, one <li> per act, each
 * with a real <time datetime>. Do not add motion here.
 */
export function AgendaTimeline({
  items, timezone,
}: {
  items: AgendaItemRow[]
  timezone: string
}) {
  if (items.length === 0) return null

  return (
    <ol className="space-y-6 border-l border-[var(--color-border)] pl-6" data-agenda>
      {items.map((item) => (
        <li key={item.id} className="relative">
          <span
            aria-hidden="true"
            className="absolute -left-[1.6rem] top-2 h-2 w-2 rounded-full bg-[var(--color-brass)]"
          />
          <time
            dateTime={item.startsAt.toISOString()}
            className="block text-sm tracking-wide text-[var(--color-brass)]"
          >
            {formatTime(item.startsAt, timezone)}
          </time>
          <h3 className="mt-1 font-serif text-xl">{item.title}</h3>
          {item.description ? (
            <p className="mt-1 text-sm text-[var(--color-text-muted)]">{item.description}</p>
          ) : null}
        </li>
      ))}
    </ol>
  )
}
```

`src/components/guest/seat-map.tsx`:

```tsx
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
        You&rsquo;re at <span className="text-[var(--color-brass)]">Table {table}</span>
      </p>

      {floorplanAssetId ? (
        <div className="relative overflow-hidden rounded border border-[var(--color-border)]">
          {/* eslint-disable-next-line @next/next/no-img-element -- served from our own
              route handler at unknown intrinsic size; next/image adds no value here */}
          <img
            src={`/api/media/${floorplanAssetId}`}
            alt="Floorplan of the venue"
            className="block w-full"
          />
          {marker ? (
            <span
              className="absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[var(--color-ink-deep)] bg-[var(--color-brass)]"
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
```

`src/app/i/[token]/not-found.tsx`:

```tsx
export default function InviteNotFound() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 text-center">
      <h1 className="font-serif text-3xl">We couldn&rsquo;t find that invitation</h1>
      <p className="mt-4 text-[var(--color-text-muted)]">
        The link may have expired or been replaced. Please contact the event organiser.
      </p>
    </main>
  )
}
```

`src/app/i/[token]/page.tsx`:

```tsx
import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import { notFound } from 'next/navigation'
import { prisma } from '@/lib/db'
import { CSRF_COOKIE } from '@/lib/auth/csrf'
import { loadGuestPage } from '@/lib/guest/page-data'
import { AgendaTimeline } from '@/components/guest/agenda-timeline'
import { SeatMap } from '@/components/guest/seat-map'
import { RsvpForm } from './rsvp-form'

/** The URL carries a credential: never index it, never leak it in a referrer. */
export const metadata: Metadata = {
  robots: { index: false, follow: false, nocache: true },
  referrer: 'no-referrer',
}

export const dynamic = 'force-dynamic'

export default async function GuestPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  const data = await loadGuestPage(prisma, token, new Date())
  if (!data) notFound()

  // Read only. Middleware (Task 6) guarantees the cookie for /i/*; setting it
  // here would be a cookie write during render, which Next.js forbids.
  const store = await cookies()
  const csrf = store.get(CSRF_COOKIE)?.value
  if (!csrf) throw new Error('CSRF cookie missing - check that src/middleware.ts matches /i/*')

  const { invite, event, window, table, marker } = data
  const primary = invite.guests.find((guest) => guest.isPrimary) ?? invite.guests[0]

  return (
    <main className="mx-auto max-w-2xl space-y-16 px-6 py-16">
      <section aria-labelledby="welcome">
        <h1 id="welcome" className="font-serif text-4xl">
          Welcome, {primary ? primary.firstName : invite.label}.
        </h1>
        {event.tagline ? (
          <p className="mt-3 text-[var(--color-text-muted)]">{event.tagline}</p>
        ) : null}
      </section>

      <section aria-labelledby="event" className="space-y-2">
        <h2 id="event" className="font-serif text-3xl text-[var(--color-brass)]">{event.name}</h2>
        <p>
          <time dateTime={event.startsAt.toISOString()}>
            {new Intl.DateTimeFormat('en-US', {
              dateStyle: 'full', timeStyle: 'short', timeZone: event.timezone,
            }).format(event.startsAt)}
          </time>
        </p>
        <p className="text-[var(--color-text-muted)]">{event.venueName}, {event.address}</p>
        {event.dressCode ? <p className="text-sm">Dress code: {event.dressCode}</p> : null}
        <a href={`/i/${encodeURIComponent(token)}/calendar`} className="inline-block pt-2 underline underline-offset-4">
          Add to calendar
        </a>
      </section>

      {event.agendaItems.length > 0 ? (
        <section aria-labelledby="evening" className="space-y-6">
          <h2 id="evening" className="font-serif text-3xl">The evening</h2>
          <AgendaTimeline items={event.agendaItems} timezone={event.timezone} />
        </section>
      ) : null}

      {table ? (
        <section aria-labelledby="seat" className="space-y-4">
          <h2 id="seat" className="font-serif text-3xl">Your seat</h2>
          <SeatMap floorplanAssetId={event.floorplanAssetId} marker={marker} table={table} />
        </section>
      ) : null}

      <section aria-labelledby="rsvp" className="space-y-4">
        <h2 id="rsvp" className="font-serif text-3xl">Your response</h2>
        {window.isOpen ? (
          <RsvpForm token={token} invite={invite} mealOptions={event.mealOptions} csrf={csrf} />
        ) : (
          <p role="status" className="rounded border border-[var(--color-border)] p-4">
            RSVPs closed on{' '}
            <time dateTime={window.closesAt.toISOString()}>
              {new Intl.DateTimeFormat('en-US', { dateStyle: 'long', timeZone: event.timezone })
                .format(window.closesAt)}
            </time>
            . Please contact the organiser if you need to change your response.
          </p>
        )}
      </section>
    </main>
  )
}
```

- [ ] **Step 6: Verify and commit**

```bash
npm run typecheck 2>&1 | grep -v "^>"
npm run lint
git add src/lib/guest/page-data.ts src/app/i src/components/guest tests/integration/guest-page-data.test.ts
git commit -m "feat: guest portal page"
```

**No `npm run build` in this task.** `page.tsx` imports `RsvpForm`, which Task 9 creates, so the
build cannot succeed until both are in place. Task 9 runs the build for both. Do not stub the
import to make a build pass — a stub that satisfies a gate is how an unfinished component ships.

---

## Task 9: RSVP form and submission action

**Files:**
- Create: `src/app/i/[token]/rsvp-form.tsx`, `src/app/i/[token]/actions.ts`, `src/components/guest/guest-card.tsx`
- Test: covered by Task 11's end-to-end suite; verified here by typecheck and build

**Interfaces:**
- Consumes: `submitRsvp` (Task 5), `rsvpSubmissionSchema` (Task 4), `getEvent` (Task 7), `verifyCsrfToken`/`CSRF_COOKIE` from `@/lib/auth/csrf`, `GuestInvite` (Task 1), `MealOptionRow` (Task 7)
- Produces:
  - `submitRsvpAction(prev: RsvpFormState, formData: FormData): Promise<RsvpFormState>`
  - `type RsvpFormState = { status: 'idle' | 'error' | 'done'; message?: string; attending?: boolean }`
  - `<RsvpForm token invite mealOptions />` — a client component
  - `<GuestCard index guest mealOptions />`

**This task depends on Task 8.** `page.tsx` already imports `RsvpForm`; the build gate for both tasks lives here.

**Spec §9.1 requires five steps, one question per screen — not one long form.** The steps are
structural and belong here; Plan 3 adds the animated transitions between them. Build:

| Step | Screen | Notes |
| --- | --- | --- |
| 1 | Attending? | Accept or decline. Declining skips straight to step 5. |
| 2 | Who's coming | One `GuestCard` per claimed seat, added one at a time |
| 3 | Extra seats | Shown **only** when every allotted seat is claimed |
| 4 | Review | Read-only summary of everything entered, with a way back to any step |
| 5 | Confirm | Submits |

Requirements for the stepper: all fields stay mounted across steps (unmounting a step would
discard its input, and a single `FormData` submit needs every field present — hide inactive
steps with `hidden`, not by unmounting); the back button never loses entered data; the submit
button appears only on the final step; and the current position is announced to assistive
technology. `progress` is `aria-valuenow` on a `role="progressbar"`, or an equivalent live
region — a guest using a screen reader must know there are five steps and which one they are on.

**Four things this action must get right:**

1. **CSRF before anything else.** This is an unauthenticated POST from the public internet. Verify the double-submit token before reading a single field.
2. **The token comes from the form body, never the URL.** A POST body is not written to access logs the way a query string is. It is also not the credential the *server* trusts blindly — `submitRsvp` re-resolves it against the stored hash on every call.
3. **The deadline is read from the database, not the client.** `getEvent(prisma)` supplies `rsvpDeadline`; a client-supplied deadline would be trivially forgeable.
4. **Failures are reported without leaking.** `NOT_FOUND` and `FOREIGN_GUEST` both render a generic failure. Telling a visitor which one occurred confirms whether a guest id or token is real.

- [ ] **Step 1: Implement `src/components/guest/guest-card.tsx`**

```tsx
import { Field } from '@/components/admin/field'
import type { GuestRow } from '@/lib/guest/resolve'
import type { MealOptionRow } from '@/lib/events/repository'

/**
 * One seat's worth of fields. `index` namespaces every input so the action can
 * reassemble the party from flat FormData without relying on DOM order.
 */
export function GuestCard({
  index, guest, mealOptions,
}: {
  index: number
  guest: Partial<GuestRow> | undefined
  mealOptions: MealOptionRow[]
}) {
  const name = (field: string) => `guests.${index}.${field}`

  return (
    <fieldset className="space-y-4 rounded border border-[var(--color-border)] p-4">
      <legend className="px-2 text-sm text-[var(--color-text-muted)]">
        {index === 0 ? 'You' : `Guest ${index + 1}`}
      </legend>

      <input type="hidden" name={name('id')} value={guest?.id ?? ''} />

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="First name" name={name('firstName')} defaultValue={guest?.firstName ?? ''} required />
        <Field label="Last name" name={name('lastName')} defaultValue={guest?.lastName ?? ''} required />
        <Field label="Name on badge" name={name('badgeName')} defaultValue={guest?.badgeName ?? ''} />
        <Field label="Company" name={name('company')} defaultValue={guest?.company ?? ''} />
        <Field label="Job title" name={name('title')} defaultValue={guest?.title ?? ''} />
        <Field label="Email" name={name('email')} type="email" defaultValue={guest?.email ?? ''} />
        <Field label="Phone" name={name('phone')} defaultValue={guest?.phone ?? ''} />

        {mealOptions.length > 0 ? (
          <label className="block">
            <span className="mb-1 block text-sm text-[var(--color-text-muted)]">Meal</span>
            <select
              name={name('mealOptionId')}
              defaultValue={guest?.mealOptionId ?? ''}
              className="w-full rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2"
            >
              <option value="">No preference</option>
              {mealOptions.map((meal) => (
                <option key={meal.id} value={meal.id}>{meal.label}</option>
              ))}
            </select>
          </label>
        ) : null}
      </div>

      <Field
        label="Dietary restrictions or allergies"
        name={name('dietary')}
        defaultValue={(guest?.dietary ?? []).join(', ')}
      />
      <Field
        label="Accessibility needs"
        name={name('accessibilityNeeds')}
        defaultValue={guest?.accessibilityNeeds ?? ''}
      />
    </fieldset>
  )
}
```

- [ ] **Step 2: Implement `src/app/i/[token]/actions.ts`**

```ts
'use server'

import { cookies } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/db'
import { CSRF_COOKIE, verifyCsrfToken } from '@/lib/auth/csrf'
import { rsvpSubmissionSchema } from '@/lib/validation/guest'
import { submitRsvp } from '@/lib/guest/rsvp'
import { getEvent } from '@/lib/events/repository'

export type RsvpFormState = {
  status: 'idle' | 'error' | 'done'
  message?: string
  attending?: boolean
}

const GENERIC_FAILURE =
  'We could not save your response. Please reload the page and try again.'

/** Rebuilds the party from flat `guests.<i>.<field>` keys. */
function collectGuests(formData: FormData): unknown[] {
  const indices = new Set<number>()
  for (const key of formData.keys()) {
    const match = /^guests\.(\d+)\./.exec(key)
    if (match) indices.add(Number(match[1]))
  }

  return [...indices].sort((a, b) => a - b).map((index) => {
    const read = (field: string) => String(formData.get(`guests.${index}.${field}`) ?? '')
    const dietary = read('dietary')
    return {
      id: read('id') || undefined,
      firstName: read('firstName'),
      lastName: read('lastName'),
      badgeName: read('badgeName'),
      company: read('company'),
      title: read('title'),
      email: read('email'),
      phone: read('phone'),
      mealOptionId: read('mealOptionId'),
      accessibilityNeeds: read('accessibilityNeeds'),
      dietary: dietary ? dietary.split(',').map((v) => v.trim()).filter(Boolean) : [],
    }
  })
}

export async function submitRsvpAction(
  _prev: RsvpFormState,
  formData: FormData,
): Promise<RsvpFormState> {
  // First, before reading anything else: this is an unauthenticated POST.
  const store = await cookies()
  if (!verifyCsrfToken(store.get(CSRF_COOKIE)?.value, formData.get('csrf'))) {
    return { status: 'error', message: 'Your session expired. Reload the page and try again.' }
  }

  const token = String(formData.get('token') ?? '')
  const attending = formData.get('attending') === 'yes'

  const parsed = rsvpSubmissionSchema.safeParse({
    attending,
    guests: attending ? collectGuests(formData) : [],
    extraSeatsRequested: formData.get('extraSeatsRequested') ?? 0,
    extraSeatsReason: formData.get('extraSeatsReason') ?? '',
  })
  if (!parsed.success) {
    return { status: 'error', message: parsed.error.issues[0]?.message ?? 'Please check your answers.' }
  }

  // The deadline is authoritative from the database. A client-supplied one
  // would be forgeable by anyone with devtools.
  const event = await getEvent(prisma)
  if (!event) return { status: 'error', message: GENERIC_FAILURE }

  const result = await submitRsvp(prisma, token, parsed.data, new Date(), event.rsvpDeadline)

  if (!result.ok) {
    // NOT_FOUND and FOREIGN_GUEST deliberately share a message: distinguishing
    // them would confirm whether a token or guest id is real.
    const message =
      result.reason === 'CLOSED'
        ? 'RSVPs have closed. Please contact the organiser.'
        : result.reason === 'SEAT_LIMIT'
          ? 'That is more guests than your invitation allows.'
          : GENERIC_FAILURE
    return { status: 'error', message }
  }

  revalidatePath(`/i/${token}`)
  return { status: 'done', attending: parsed.data.attending }
}
```

- [ ] **Step 3: Implement `src/app/i/[token]/rsvp-form.tsx`**

```tsx
'use client'

import { useActionState, useState } from 'react'
import { GuestCard } from '@/components/guest/guest-card'
import { Field } from '@/components/admin/field'
import type { GuestInvite } from '@/lib/guest/resolve'
import type { MealOptionRow } from '@/lib/events/repository'
import { submitRsvpAction, type RsvpFormState } from './actions'

const INITIAL: RsvpFormState = { status: 'idle' }

/** Declining skips 2-4: there is nothing to ask someone who is not coming. */
const STEP_COUNT = 5

export function RsvpForm({
  token, invite, mealOptions, csrf,
}: {
  token: string
  invite: GuestInvite
  mealOptions: MealOptionRow[]
  csrf: string
}) {
  const [state, action, pending] = useActionState(submitRsvpAction, INITIAL)
  const [attending, setAttending] = useState<boolean | null>(
    invite.respondedAt ? invite.status !== 'DECLINED' : null,
  )
  const [seats, setSeats] = useState(Math.max(1, invite.guests.length))
  const [step, setStep] = useState(1)

  const seatsRemaining = invite.seatsAllotted - seats
  // Every step stays mounted; inactive ones are `hidden`. Unmounting would drop
  // the guest's input AND remove the fields from the single FormData submit.
  const stepProps = (n: number) => ({ hidden: step !== n, 'aria-hidden': step !== n })
  const next = () => setStep((current) => (attending === false && current === 1 ? 5 : current + 1))
  const back = () => setStep((current) => (attending === false && current === 5 ? 1 : current - 1))

  if (state.status === 'done') {
    return (
      <p role="status" data-testid="rsvp-confirmed" className="rounded border border-[var(--color-brass)] p-4">
        {state.attending
          ? 'Thank you — your response is recorded. We look forward to seeing you.'
          : 'Thank you for letting us know. You will be missed.'}
      </p>
    )
  }

  return (
    <form action={action} className="space-y-6">
      <input type="hidden" name="csrf" value={csrf} />
      <input type="hidden" name="token" value={token} />

      <div
        role="progressbar"
        aria-valuemin={1}
        aria-valuemax={STEP_COUNT}
        aria-valuenow={step}
        aria-label={`Step ${step} of ${STEP_COUNT}`}
        className="h-1 w-full rounded bg-[var(--color-surface)]"
      >
        <div
          className="h-full rounded bg-[var(--color-brass)]"
          style={{ width: `${(step / STEP_COUNT) * 100}%` }}
        />
      </div>

      <fieldset className="space-y-3" {...stepProps(1)}>
        <legend className="font-serif text-xl">Will you join us?</legend>
        {(['yes', 'no'] as const).map((value) => (
          <label key={value} className="flex items-center gap-3">
            <input
              type="radio"
              name="attending"
              value={value}
              checked={attending === (value === 'yes')}
              onChange={() => setAttending(value === 'yes')}
              required
            />
            <span>{value === 'yes' ? 'Joyfully accepts' : 'Regretfully declines'}</span>
          </label>
        ))}
      </fieldset>

      {attending ? (
        <>
          <div className="space-y-4" {...stepProps(2)}>
            {Array.from({ length: seats }, (_, index) => (
              <GuestCard
                key={index}
                index={index}
                guest={invite.guests[index]}
                mealOptions={mealOptions}
              />
            ))}
          </div>

          {seatsRemaining > 0 ? (
            <button
              type="button"
              onClick={() => setSeats((current) => current + 1)}
              className="rounded border border-[var(--color-border)] px-4 py-2 text-sm"
              {...stepProps(2)}
            >
              Add another guest ({seatsRemaining} seat{seatsRemaining === 1 ? '' : 's'} remaining)
            </button>
          ) : (
            <div className="rounded border border-[var(--color-border)] p-4" {...stepProps(3)}>
              <p className="text-sm">Need an extra seat?</p>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <Field label="How many extra seats?" name="extraSeatsRequested" type="number" defaultValue="0" />
                <Field label="Reason" name="extraSeatsReason" />
              </div>
              <p className="mt-2 text-xs text-[var(--color-text-muted)]">
                Extra seats are subject to the organiser&rsquo;s approval.
              </p>
            </div>
          )}

          {/* Step 4: read-only review. Build it from the same state the fields
              hold, so it can never disagree with what will actually be sent. */}
          <section {...stepProps(4)} aria-label="Review your response" className="space-y-2">
            <h3 className="font-serif text-xl">Please check your answers</h3>
            <p className="text-sm text-[var(--color-text-muted)]">
              {seats} guest{seats === 1 ? '' : 's'} attending. Use Back to change anything.
            </p>
          </section>
        </>
      ) : null}

      {state.status === 'error' ? (
        <p role="alert" className="text-sm text-[var(--color-danger)]">{state.message}</p>
      ) : null}

      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={back}
          disabled={step === 1}
          className="rounded border border-[var(--color-border)] px-4 py-2 disabled:opacity-40"
        >
          Back
        </button>

        {step < STEP_COUNT ? (
          <button
            type="button"
            onClick={next}
            disabled={attending === null}
            className="rounded bg-[var(--color-brass)] px-6 py-2 font-medium text-[var(--color-ink-deep)] disabled:opacity-60"
          >
            Continue
          </button>
        ) : (
          <button
            type="submit"
            disabled={pending || attending === null}
            className="rounded bg-[var(--color-brass)] px-6 py-3 font-medium text-[var(--color-ink-deep)] disabled:opacity-60"
          >
            {pending ? 'Sending…' : 'Send response'}
          </button>
        )}
      </div>
    </form>
  )
}
```

- [ ] **Step 4: Verify — this is the build gate for Tasks 8 and 9**

```bash
npm run typecheck 2>&1 | grep -v "^>"   # must be empty
npm run lint                             # must exit 0
npm run build                            # must succeed, /i/[token] in the route list
git checkout tsconfig.json
```

- [ ] **Step 5: Commit**

```bash
git add src/app/i src/components/guest
git commit -m "feat: guest RSVP form and submission action"
```

---

## Task 10: Calendar route

**Files:**
- Create: `src/app/i/[token]/calendar/route.ts`
- Test: `tests/integration/calendar-route.test.ts`

**Interfaces:**
- Consumes: `buildIcs` (Task 3), `resolveInviteByToken` (Task 1), `getEvent` (Task 7)
- Produces: `GET /i/<token>/calendar` → `text/calendar` with `Content-Disposition: attachment`
- Also produces `buildInviteIcs(event, inviteId, stamp): string` in `src/lib/guest/ics.ts` — a thin adapter so the mapping from event to `IcsEvent` is testable without a request

**Duration:** the schema has no event end time. Use the last agenda item's `startsAt` plus one hour, falling back to `startsAt` plus five hours when there is no agenda. Encode that in the adapter, not the route.

- [ ] **Step 1: Write the failing test**

`tests/integration/calendar-route.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { testDb, resetDb } from '../helpers/db'
import { buildInviteIcs } from '@/lib/guest/ics'
import { getEvent } from '@/lib/events/repository'

const STAMP = new Date('2026-08-22T12:00:00Z')

beforeEach(resetDb)
afterAll(() => testDb.$disconnect())

async function seedEvent(withAgenda: boolean) {
  return testDb.event.create({
    data: {
      name: 'Gala, 2026',
      startsAt: new Date('2026-11-14T18:00:00Z'),
      venueName: 'The Grand Hall',
      address: '1 Placeholder Avenue',
      rsvpDeadline: new Date('2026-10-24T23:59:00Z'),
      ...(withAgenda
        ? {
            agendaItems: {
              create: [
                { title: 'Cocktails', startsAt: new Date('2026-11-14T18:00:00Z'), sortOrder: 0 },
                { title: 'After-party', startsAt: new Date('2026-11-14T22:00:00Z'), sortOrder: 1 },
              ],
            },
          }
        : {}),
    },
  })
}

describe('buildInviteIcs', () => {
  it('ends one hour after the last agenda item', async () => {
    await seedEvent(true)
    const event = await getEvent(testDb)
    const ics = buildInviteIcs(event!, 'invite123', STAMP)
    expect(ics).toContain('DTSTART:20261114T180000Z')
    expect(ics).toContain('DTEND:20261114T230000Z')
  })

  it('falls back to five hours when there is no agenda', async () => {
    await seedEvent(false)
    const event = await getEvent(testDb)
    const ics = buildInviteIcs(event!, 'invite123', STAMP)
    expect(ics).toContain('DTEND:20261114T230000Z')
  })

  it('escapes the event name', async () => {
    await seedEvent(false)
    const event = await getEvent(testDb)
    expect(buildInviteIcs(event!, 'invite123', STAMP)).toContain('SUMMARY:Gala\\, 2026')
  })

  it('builds a uid stable for one invite', async () => {
    await seedEvent(false)
    const event = await getEvent(testDb)
    const first = buildInviteIcs(event!, 'invite123', STAMP)
    const second = buildInviteIcs(event!, 'invite123', new Date('2026-09-01T00:00:00Z'))
    const uid = (ics: string) => ics.split('\r\n').find((line) => line.startsWith('UID:'))
    expect(uid(first)).toBe(uid(second))
  })

  it('gives different invites different uids', async () => {
    await seedEvent(false)
    const event = await getEvent(testDb)
    const uid = (ics: string) => ics.split('\r\n').find((line) => line.startsWith('UID:'))
    expect(uid(buildInviteIcs(event!, 'a1', STAMP)))
      .not.toBe(uid(buildInviteIcs(event!, 'b2', STAMP)))
  })

  it('never puts the venue or name in the uid', async () => {
    await seedEvent(false)
    const event = await getEvent(testDb)
    const ics = buildInviteIcs(event!, 'invite123', STAMP)
    const uidLine = ics.split('\r\n').find((line) => line.startsWith('UID:')) ?? ''
    expect(uidLine).not.toContain('Grand Hall')
  })
})
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `DATABASE_URL_TEST="mongodb://127.0.0.1:27018/gala_test_p2c?replicaSet=rs0" npx vitest run tests/integration/calendar-route.test.ts`
Expected: FAIL — `buildInviteIcs` is not exported.

- [ ] **Step 3: Add `buildInviteIcs` to `src/lib/guest/ics.ts`**

```ts
import type { EventDetail } from '@/lib/events/repository'

const HOUR_MS = 60 * 60 * 1000
const DEFAULT_DURATION_MS = 5 * HOUR_MS

/**
 * The schema records when an event starts but not when it ends. The last
 * agenda item plus an hour is the best available signal; with no agenda, five
 * hours is a reasonable evening. Kept here rather than in the route so it is
 * testable without a request.
 */
export function buildInviteIcs(event: EventDetail, inviteId: string, stamp: Date): string {
  const lastItem = event.agendaItems.at(-1)
  const endsAt = lastItem
    ? new Date(lastItem.startsAt.getTime() + HOUR_MS)
    : new Date(event.startsAt.getTime() + DEFAULT_DURATION_MS)

  return buildIcs({
    uid: `${inviteId}.${event.id}@gala-rsvp`,
    startsAt: event.startsAt,
    endsAt,
    stamp,
    title: event.name,
    location: `${event.venueName}, ${event.address}`,
    description: event.dressCode ? `Dress code: ${event.dressCode}` : undefined,
  })
}
```

- [ ] **Step 4: Implement `src/app/i/[token]/calendar/route.ts`**

```ts
import { prisma } from '@/lib/db'
import { resolveInviteByToken } from '@/lib/guest/resolve'
import { getEvent } from '@/lib/events/repository'
import { buildInviteIcs } from '@/lib/guest/ics'

export const dynamic = 'force-dynamic'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
): Promise<Response> {
  const { token } = await params
  const [invite, event] = await Promise.all([
    resolveInviteByToken(prisma, token),
    getEvent(prisma),
  ])
  if (!invite || !event) {
    return new Response('Not found', { status: 404 })
  }

  return new Response(buildInviteIcs(event, invite.id, new Date()), {
    status: 200,
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'attachment; filename="gala.ics"',
      // The URL carries a credential; never let an intermediary keep the body.
      'Cache-Control': 'no-store',
    },
  })
}
```

- [ ] **Step 5: Run it and confirm it passes**

Run: `DATABASE_URL_TEST="mongodb://127.0.0.1:27018/gala_test_p2c?replicaSet=rs0" npx vitest run tests/integration/calendar-route.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 6: Verify and commit**

```bash
npm run typecheck 2>&1 | grep -v "^>"
npm run lint
npm run build && git checkout tsconfig.json
git add src/lib/guest/ics.ts src/app/i/[token]/calendar tests/integration/calendar-route.test.ts
git commit -m "feat: per-invite calendar download"
```

---

## Task 11: Image validation by magic bytes

**Files:**
- Create: `src/lib/media/images.ts`
- Test: `tests/unit/images.test.ts`

**Interfaces:**
- Consumes: nothing — pure, operates on a `Buffer`
- Produces:
  - `type ImageInfo = { mimeType: 'image/png' | 'image/jpeg' | 'image/webp'; width: number; height: number }`
  - `inspectImage(bytes: Buffer): ImageInfo` — throws `InvalidImageError`
  - `InvalidImageError`
  - `MAX_IMAGE_BYTES = 8 * 1024 * 1024`, `MAX_DIMENSION = 8000`

**Why by hand rather than by library.** This is the one place an untrusted binary enters the system. The rule from spec §11 is that the type is decided by the file's own leading bytes, never by its extension or its declared `Content-Type` — both are attacker-controlled. That check is a few dozen bytes of parsing; a dependency here would be a larger supply-chain surface than the code it replaces.

- [ ] **Step 1: Write the failing test**

`tests/unit/images.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { inspectImage, InvalidImageError, MAX_IMAGE_BYTES, MAX_DIMENSION } from '@/lib/media/images'

/** Minimal but structurally real headers — enough for a sniffer to parse. */
function pngHeader(width: number, height: number): Buffer {
  const buffer = Buffer.alloc(33)
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer, 0)
  buffer.writeUInt32BE(13, 8)
  buffer.write('IHDR', 12, 'ascii')
  buffer.writeUInt32BE(width, 16)
  buffer.writeUInt32BE(height, 20)
  return buffer
}

function jpegHeader(width: number, height: number): Buffer {
  const buffer = Buffer.alloc(20)
  buffer.writeUInt16BE(0xffd8, 0)   // SOI
  buffer.writeUInt16BE(0xffc0, 2)   // SOF0
  buffer.writeUInt16BE(11, 4)       // segment length
  buffer.writeUInt8(8, 6)           // precision
  buffer.writeUInt16BE(height, 7)
  buffer.writeUInt16BE(width, 9)
  return buffer
}

function webpHeader(width: number, height: number): Buffer {
  const buffer = Buffer.alloc(30)
  buffer.write('RIFF', 0, 'ascii')
  buffer.writeUInt32LE(22, 4)
  buffer.write('WEBPVP8 ', 8, 'ascii')
  buffer.writeUInt32LE(10, 16)
  buffer.writeUInt16LE(0x9d01, 20)
  buffer.writeUInt8(0x2a, 22)
  buffer.writeUInt16LE(width, 23)
  buffer.writeUInt16LE(height, 25)
  return buffer
}

describe('inspectImage', () => {
  it('identifies a PNG and reads its dimensions', () => {
    expect(inspectImage(pngHeader(1200, 800)))
      .toEqual({ mimeType: 'image/png', width: 1200, height: 800 })
  })

  it('identifies a JPEG and reads its dimensions', () => {
    expect(inspectImage(jpegHeader(640, 480)))
      .toEqual({ mimeType: 'image/jpeg', width: 640, height: 480 })
  })

  it('identifies a WEBP and reads its dimensions', () => {
    expect(inspectImage(webpHeader(300, 200)))
      .toEqual({ mimeType: 'image/webp', width: 300, height: 200 })
  })

  it('REJECTS a file whose bytes are not an image, whatever it claims to be', () => {
    // The attack this exists to stop: an executable or script renamed .png.
    expect(() => inspectImage(Buffer.from('#!/bin/sh\nrm -rf /', 'utf8')))
      .toThrow(InvalidImageError)
  })

  it('rejects an SVG, which is script-capable and not on the allowlist', () => {
    expect(() => inspectImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')))
      .toThrow(InvalidImageError)
  })

  it('rejects a GIF, which is a real image but not on the allowlist', () => {
    expect(() => inspectImage(Buffer.from('GIF89a', 'ascii'))).toThrow(InvalidImageError)
  })

  it('rejects an empty buffer', () => {
    expect(() => inspectImage(Buffer.alloc(0))).toThrow(InvalidImageError)
  })

  it('rejects a truncated PNG header', () => {
    expect(() => inspectImage(pngHeader(100, 100).subarray(0, 12))).toThrow(InvalidImageError)
  })

  it('rejects zero dimensions', () => {
    expect(() => inspectImage(pngHeader(0, 100))).toThrow(InvalidImageError)
  })

  it('rejects absurd dimensions that would exhaust memory downstream', () => {
    expect(() => inspectImage(pngHeader(MAX_DIMENSION + 1, 100))).toThrow(InvalidImageError)
  })

  it('rejects a file larger than the cap', () => {
    const huge = Buffer.concat([pngHeader(100, 100), Buffer.alloc(MAX_IMAGE_BYTES)])
    expect(() => inspectImage(huge)).toThrow(InvalidImageError)
  })

  it('never puts file contents in its error message', () => {
    try {
      inspectImage(Buffer.from('SECRET-CONTENT-MARKER', 'utf8'))
      expect.unreachable('should have thrown')
    } catch (error) {
      expect((error as Error).message).not.toContain('SECRET-CONTENT-MARKER')
    }
  })
})
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run tests/unit/images.test.ts`
Expected: FAIL — cannot resolve `@/lib/media/images`.

- [ ] **Step 3: Implement `src/lib/media/images.ts`**

```ts
export class InvalidImageError extends Error {
  constructor(reason: string) {
    // Never interpolate file contents: this message reaches an operator's screen.
    super(`Not a usable image: ${reason}`)
    this.name = 'InvalidImageError'
  }
}

export const MAX_IMAGE_BYTES = 8 * 1024 * 1024
export const MAX_DIMENSION = 8000

export type ImageInfo = {
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp'
  width: number
  height: number
}

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

function readPng(bytes: Buffer): ImageInfo | null {
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(PNG_MAGIC)) return null
  if (bytes.toString('ascii', 12, 16) !== 'IHDR') return null
  return { mimeType: 'image/png', width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
}

/** Walks JPEG segments to the first start-of-frame marker, which carries the size. */
function readJpeg(bytes: Buffer): ImageInfo | null {
  if (bytes.length < 4 || bytes.readUInt16BE(0) !== 0xffd8) return null

  let offset = 2
  while (offset + 9 < bytes.length) {
    if (bytes.readUInt8(offset) !== 0xff) return null
    const marker = bytes.readUInt8(offset + 1)
    // SOF0-SOF15, skipping the non-frame markers interleaved in that range.
    const isFrame = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)
    if (isFrame) {
      return {
        mimeType: 'image/jpeg',
        height: bytes.readUInt16BE(offset + 5),
        width: bytes.readUInt16BE(offset + 7),
      }
    }
    offset += 2 + bytes.readUInt16BE(offset + 2)
  }
  return null
}

function readWebp(bytes: Buffer): ImageInfo | null {
  if (bytes.length < 30) return null
  if (bytes.toString('ascii', 0, 4) !== 'RIFF') return null
  if (bytes.toString('ascii', 8, 12) !== 'WEBP') return null
  if (bytes.toString('ascii', 12, 15) !== 'VP8') return null
  // Lossy VP8: 14-bit dimensions follow the 3-byte start code.
  return {
    mimeType: 'image/webp',
    width: bytes.readUInt16LE(23) & 0x3fff,
    height: bytes.readUInt16LE(25) & 0x3fff,
  }
}

/**
 * Decides an upload's type from its own leading bytes.
 *
 * The filename and the declared Content-Type are both attacker-controlled and
 * are never consulted. SVG is excluded deliberately: it is script-capable, and
 * serving one from our own origin would be a stored-XSS vector.
 */
export function inspectImage(bytes: Buffer): ImageInfo {
  if (bytes.length === 0) throw new InvalidImageError('the file is empty')
  if (bytes.length > MAX_IMAGE_BYTES) {
    throw new InvalidImageError(`larger than ${MAX_IMAGE_BYTES / 1024 / 1024} MB`)
  }

  const info = readPng(bytes) ?? readJpeg(bytes) ?? readWebp(bytes)
  if (!info) throw new InvalidImageError('expected a PNG, JPEG or WEBP')

  if (info.width <= 0 || info.height <= 0) {
    throw new InvalidImageError('the image reports no size')
  }
  if (info.width > MAX_DIMENSION || info.height > MAX_DIMENSION) {
    throw new InvalidImageError(`larger than ${MAX_DIMENSION}px on a side`)
  }
  return info
}
```

- [ ] **Step 4: Run it and confirm it passes**

Run: `npx vitest run tests/unit/images.test.ts`
Expected: PASS, 12 tests.

- [ ] **Step 5: Verify and commit**

```bash
npm run typecheck 2>&1 | grep -v "^>"
npm run lint
git add src/lib/media/images.ts tests/unit/images.test.ts
git commit -m "feat: validate uploaded images by magic bytes"
```

---

## Task 12: Media storage and serving

**Files:**
- Create: `src/lib/media/repository.ts`, `src/app/api/media/[id]/route.ts`
- Test: `tests/integration/media.test.ts`

**Interfaces:**
- Consumes: `inspectImage`, `MAX_IMAGE_BYTES` (Task 11), `writeAudit`
- Produces:
  - `storeImage(db, actorId, filename, bytes): Promise<string>` — returns the asset id
  - `readImage(db, id): Promise<{ bytes: Buffer; mimeType: string; filename: string } | null>`
  - `deleteImage(db, actorId, id): Promise<void>`
  - `GET /api/media/<id>` → the bytes, or 404

**The serving route is public and that is deliberate.** A guest holding an invite link must see the floorplan, and they have no session. What that means for the route: it serves only what an operator uploaded, never user-supplied bytes echoed back, always with `X-Content-Type-Options: nosniff` and an explicit `Content-Type` from the *stored* value that `inspectImage` determined — not from anything on the request.

- [ ] **Step 1: Write the failing test**

`tests/integration/media.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { testDb, resetDb } from '../helpers/db'
import { storeImage, readImage, deleteImage } from '@/lib/media/repository'
import { InvalidImageError } from '@/lib/media/images'

function pngHeader(width = 100, height = 100): Buffer {
  const buffer = Buffer.alloc(33)
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer, 0)
  buffer.writeUInt32BE(13, 8)
  buffer.write('IHDR', 12, 'ascii')
  buffer.writeUInt32BE(width, 16)
  buffer.writeUInt32BE(height, 20)
  return buffer
}

beforeEach(resetDb)
afterAll(() => testDb.$disconnect())

describe('media repository', () => {
  it('stores an image and reads it back byte-identical', async () => {
    const bytes = pngHeader(1200, 800)
    const id = await storeImage(testDb, null, 'floorplan.png', bytes)
    const stored = await readImage(testDb, id)
    expect(stored?.mimeType).toBe('image/png')
    expect(Buffer.compare(stored!.bytes, bytes)).toBe(0)
  })

  it('records the dimensions it sniffed', async () => {
    const id = await storeImage(testDb, null, 'floorplan.png', pngHeader(1200, 800))
    const row = await testDb.mediaAsset.findUniqueOrThrow({ where: { id } })
    expect(row).toMatchObject({ width: 1200, height: 800 })
  })

  it('refuses a file that is not an image', async () => {
    await expect(storeImage(testDb, null, 'evil.png', Buffer.from('#!/bin/sh')))
      .rejects.toBeInstanceOf(InvalidImageError)
  })

  it('stores nothing when the file is refused', async () => {
    await storeImage(testDb, null, 'evil.png', Buffer.from('#!/bin/sh')).catch(() => undefined)
    expect(await testDb.mediaAsset.count()).toBe(0)
  })

  it('DERIVES the mime type from the bytes, ignoring the filename', async () => {
    // A .jpg extension on PNG bytes must be stored as image/png.
    const id = await storeImage(testDb, null, 'lying-name.jpg', pngHeader())
    expect((await readImage(testDb, id))?.mimeType).toBe('image/png')
  })

  it('returns null for an unknown id', async () => {
    expect(await readImage(testDb, '0'.repeat(24))).toBeNull()
  })

  it('returns null rather than throwing for a malformed id', async () => {
    // Ids arrive straight from the URL; a malformed ObjectId must be a 404.
    await expect(readImage(testDb, 'not-an-objectid')).resolves.toBeNull()
  })

  it('sanitises the stored filename', async () => {
    const id = await storeImage(testDb, null, '../../etc/passwd.png', pngHeader())
    const stored = await readImage(testDb, id)
    expect(stored?.filename).not.toContain('..')
    expect(stored?.filename).not.toContain('/')
  })

  it('deletes an image', async () => {
    const id = await storeImage(testDb, null, 'floorplan.png', pngHeader())
    await deleteImage(testDb, null, id)
    expect(await readImage(testDb, id)).toBeNull()
  })

  it('audits storage and deletion without recording the bytes', async () => {
    const id = await storeImage(testDb, null, 'floorplan.png', pngHeader())
    await deleteImage(testDb, null, id)
    const logs = await testDb.auditLog.findMany()
    expect(logs.map((l) => l.action)).toEqual(
      expect.arrayContaining(['media.store', 'media.delete']),
    )
    expect(JSON.stringify(logs).length).toBeLessThan(2000)
  })
})
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `DATABASE_URL_TEST="mongodb://127.0.0.1:27018/gala_test_p2d?replicaSet=rs0" npx vitest run tests/integration/media.test.ts`
Expected: FAIL — cannot resolve `@/lib/media/repository`.

- [ ] **Step 3: Implement `src/lib/media/repository.ts`**

```ts
import type { PrismaClient } from '@prisma/client'
import { inspectImage } from './images'
import { writeAudit } from '@/lib/audit'

/** Keeps a hostile filename from ever reaching a header or a log line. */
function safeFilename(filename: string): string {
  const base = filename.split(/[\\/]/).pop() ?? 'upload'
  const cleaned = base.replace(/[^\w.-]/g, '-').replace(/^\.+/, '').slice(0, 120)
  return cleaned || 'upload'
}

function isMalformedIdError(error: unknown): boolean {
  return error instanceof Error && /malformed objectid/i.test(error.message)
}

export async function storeImage(
  db: PrismaClient,
  actorId: string | null,
  filename: string,
  bytes: Buffer,
): Promise<string> {
  // Throws before anything is written if the bytes are not a permitted image.
  const info = inspectImage(bytes)
  const cleanName = safeFilename(filename)

  return db.$transaction(async (tx) => {
    const asset = await tx.mediaAsset.create({
      data: {
        filename: cleanName,
        mimeType: info.mimeType,
        bytes,
        width: info.width,
        height: info.height,
      },
      select: { id: true },
    })
    await writeAudit(tx, {
      actorId,
      action: 'media.store',
      entity: 'MediaAsset',
      entityId: asset.id,
      // Metadata only — never the bytes.
      meta: { filename: cleanName, mimeType: info.mimeType, byteLength: bytes.length },
    })
    return asset.id
  })
}

export async function readImage(
  db: PrismaClient,
  id: string,
): Promise<{ bytes: Buffer; mimeType: string; filename: string } | null> {
  const asset = await db.mediaAsset
    .findUnique({ where: { id }, select: { bytes: true, mimeType: true, filename: true } })
    .catch((error: unknown) => {
      if (isMalformedIdError(error)) return null
      throw error
    })
  if (!asset) return null
  return { bytes: Buffer.from(asset.bytes), mimeType: asset.mimeType, filename: asset.filename }
}

export async function deleteImage(
  db: PrismaClient,
  actorId: string | null,
  id: string,
): Promise<void> {
  await db.$transaction(async (tx) => {
    await tx.mediaAsset.delete({ where: { id } })
    await writeAudit(tx, { actorId, action: 'media.delete', entity: 'MediaAsset', entityId: id })
  })
}
```

- [ ] **Step 4: Implement `src/app/api/media/[id]/route.ts`**

```ts
import { prisma } from '@/lib/db'
import { readImage } from '@/lib/media/repository'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params
  const asset = await readImage(prisma, id)
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
```

**Deliberately public.** A guest holding an invite link has no session and must still see the floorplan. The route serves only operator-uploaded assets, addressed by an unguessable ObjectId, with a type fixed at upload time.

- [ ] **Step 5: Run it and confirm it passes**

Run: `DATABASE_URL_TEST="mongodb://127.0.0.1:27018/gala_test_p2d?replicaSet=rs0" npx vitest run tests/integration/media.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 6: Verify and commit**

```bash
npm run typecheck 2>&1 | grep -v "^>"
npm run lint
npm run build && git checkout tsconfig.json
git add src/lib/media src/app/api/media tests/integration/media.test.ts
git commit -m "feat: media storage and serving"
```

---

## Task 13: Table markers

**Files:**
- Create: `src/lib/events/markers.ts`
- Test: `tests/integration/markers.test.ts`

**Interfaces:**
- Consumes: `writeAudit`
- Produces:
  - `upsertTableMarker(db, actorId, eventId, input): Promise<string>` — input `{ tableNumber, x, y }`
  - `deleteTableMarker(db, actorId, id): Promise<void>`
  - `MarkerOutOfBoundsError`
  - `tableMarkerSchema` added to `src/lib/validation/event.ts`

Coordinates are normalised 0–1 against the floorplan so a marker stays correct at every rendered size. A value outside that range is a bug in the placement UI, not a shrug — reject it at the boundary.

- [ ] **Step 1: Write the failing test**

`tests/integration/markers.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { testDb, resetDb } from '../helpers/db'
import { upsertTableMarker, deleteTableMarker, MarkerOutOfBoundsError } from '@/lib/events/markers'

beforeEach(resetDb)
afterAll(() => testDb.$disconnect())

async function seedEvent() {
  return testDb.event.create({
    data: {
      name: 'Gala', startsAt: new Date('2026-11-14T18:00:00Z'),
      venueName: 'Hall', address: 'Somewhere',
      rsvpDeadline: new Date('2026-10-24T23:59:00Z'),
    },
  })
}

describe('table markers', () => {
  it('places a marker', async () => {
    const event = await seedEvent()
    const id = await upsertTableMarker(testDb, null, event.id, { tableNumber: '12', x: 0.4, y: 0.6 })
    const marker = await testDb.tableMarker.findUniqueOrThrow({ where: { id } })
    expect(marker).toMatchObject({ tableNumber: '12', x: 0.4, y: 0.6 })
  })

  it('MOVES an existing marker rather than adding a second for the same table', async () => {
    const event = await seedEvent()
    await upsertTableMarker(testDb, null, event.id, { tableNumber: '12', x: 0.1, y: 0.1 })
    await upsertTableMarker(testDb, null, event.id, { tableNumber: '12', x: 0.9, y: 0.9 })
    const markers = await testDb.tableMarker.findMany({ where: { eventId: event.id } })
    expect(markers).toHaveLength(1)
    expect(markers[0]).toMatchObject({ x: 0.9, y: 0.9 })
  })

  it('accepts the exact boundaries', async () => {
    const event = await seedEvent()
    await expect(upsertTableMarker(testDb, null, event.id, { tableNumber: '1', x: 0, y: 0 }))
      .resolves.toBeTruthy()
    await expect(upsertTableMarker(testDb, null, event.id, { tableNumber: '2', x: 1, y: 1 }))
      .resolves.toBeTruthy()
  })

  it('rejects coordinates outside 0-1', async () => {
    const event = await seedEvent()
    for (const bad of [{ x: -0.01, y: 0.5 }, { x: 1.01, y: 0.5 }, { x: 0.5, y: -1 }, { x: 0.5, y: 2 }]) {
      await expect(upsertTableMarker(testDb, null, event.id, { tableNumber: '1', ...bad }))
        .rejects.toBeInstanceOf(MarkerOutOfBoundsError)
    }
  })

  it('rejects NaN coordinates', async () => {
    const event = await seedEvent()
    await expect(upsertTableMarker(testDb, null, event.id, { tableNumber: '1', x: NaN, y: 0.5 }))
      .rejects.toBeInstanceOf(MarkerOutOfBoundsError)
  })

  it('rejects an empty table number', async () => {
    const event = await seedEvent()
    await expect(upsertTableMarker(testDb, null, event.id, { tableNumber: '  ', x: 0.5, y: 0.5 }))
      .rejects.toThrow()
  })

  it('deletes a marker', async () => {
    const event = await seedEvent()
    const id = await upsertTableMarker(testDb, null, event.id, { tableNumber: '12', x: 0.5, y: 0.5 })
    await deleteTableMarker(testDb, null, id)
    expect(await testDb.tableMarker.count()).toBe(0)
  })

  it('audits placement and deletion', async () => {
    const event = await seedEvent()
    const id = await upsertTableMarker(testDb, null, event.id, { tableNumber: '12', x: 0.5, y: 0.5 })
    await deleteTableMarker(testDb, null, id)
    const actions = (await testDb.auditLog.findMany()).map((l) => l.action)
    expect(actions).toEqual(expect.arrayContaining(['tableMarker.upsert', 'tableMarker.delete']))
  })
})
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `DATABASE_URL_TEST="mongodb://127.0.0.1:27018/gala_test_p2d?replicaSet=rs0" npx vitest run tests/integration/markers.test.ts`
Expected: FAIL — cannot resolve `@/lib/events/markers`.

- [ ] **Step 3: Implement `src/lib/events/markers.ts`**

```ts
import type { PrismaClient } from '@prisma/client'
import { writeAudit } from '@/lib/audit'

export class MarkerOutOfBoundsError extends Error {
  constructor() {
    super('Marker coordinates must be between 0 and 1')
    this.name = 'MarkerOutOfBoundsError'
  }
}

export type TableMarkerInput = { tableNumber: string; x: number; y: number }

function assertInBounds(value: number): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new MarkerOutOfBoundsError()
}

/**
 * Coordinates are normalised 0-1 against the floorplan, so a marker stays put
 * at every rendered size. One marker per table per event: placing the same
 * table again MOVES it, which is what an operator dragging a pin expects.
 */
export async function upsertTableMarker(
  db: PrismaClient,
  actorId: string | null,
  eventId: string,
  input: TableMarkerInput,
): Promise<string> {
  assertInBounds(input.x)
  assertInBounds(input.y)

  const tableNumber = input.tableNumber.trim()
  if (!tableNumber) throw new Error('A table number is required')

  return db.$transaction(async (tx) => {
    const marker = await tx.tableMarker.upsert({
      where: { eventId_tableNumber: { eventId, tableNumber } },
      create: { eventId, tableNumber, x: input.x, y: input.y },
      update: { x: input.x, y: input.y },
      select: { id: true },
    })
    await writeAudit(tx, {
      actorId, action: 'tableMarker.upsert', entity: 'TableMarker', entityId: marker.id,
      meta: { tableNumber, x: input.x, y: input.y },
    })
    return marker.id
  })
}

export async function deleteTableMarker(
  db: PrismaClient,
  actorId: string | null,
  id: string,
): Promise<void> {
  await db.$transaction(async (tx) => {
    await tx.tableMarker.delete({ where: { id } })
    await writeAudit(tx, {
      actorId, action: 'tableMarker.delete', entity: 'TableMarker', entityId: id,
    })
  })
}
```

- [ ] **Step 4: Add `tableMarkerSchema` to `src/lib/validation/event.ts`**

```ts
export const tableMarkerSchema = z.object({
  tableNumber: z.string().trim().min(1, 'Table number is required').max(20),
  x: z.coerce.number().min(0).max(1),
  y: z.coerce.number().min(0).max(1),
})
```

- [ ] **Step 5: Run it and confirm it passes**

Run: `DATABASE_URL_TEST="mongodb://127.0.0.1:27018/gala_test_p2d?replicaSet=rs0" npx vitest run tests/integration/markers.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 6: Verify and commit**

```bash
npm run typecheck 2>&1 | grep -v "^>"
npm run lint
git add src/lib/events/markers.ts src/lib/validation/event.ts tests/integration/markers.test.ts
git commit -m "feat: table marker placement"
```

---

## Task 14: Event settings screen

**Files:**
- Create: `src/app/admin/event/page.tsx`, `src/app/admin/event/actions.ts`
- Test: covered by Task 16's end-to-end suite; verified here by typecheck and build

**Interfaces:**
- Consumes: `getEvent`, `updateEventDetails`, `upsertAgendaItem`, `deleteAgendaItem`, `upsertMealOption`, `setMealOptionActive` (Task 7); `eventDetailsSchema`, `agendaItemSchema`, `mealOptionSchema` (Task 7); `requireRole`, `requireCsrf`; `CsrfInput`, `Field`, `Table`, `Td`
- Produces: `saveEventAction`, `saveAgendaItemAction`, `deleteAgendaItemAction`, `saveMealOptionAction`, `toggleMealOptionAction` — each `(formData: FormData) => Promise<void>`

Every action calls `requireRole('ADMIN')` then `requireCsrf(formData)` **before** it validates or touches data. `/admin/event` already appears in `NAV_ITEMS` from Plan 1 with `minRole: 'ADMIN'`; this task gives that link a real page.

**The empty state matters.** Until an event exists, `getEvent` returns null and the guest portal cannot render at all. The page must offer a "create the event" form in that state rather than throwing — an organiser opening the admin panel for the first time is the normal case, not an error.

- [ ] **Step 1: Implement `src/app/admin/event/actions.ts`**

```ts
'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/db'
import { requireCsrf, requireRole } from '@/lib/auth/guard'
import {
  getEvent, updateEventDetails, upsertAgendaItem, deleteAgendaItem,
  upsertMealOption, setMealOptionActive,
} from '@/lib/events/repository'
import { eventDetailsSchema, agendaItemSchema, mealOptionSchema } from '@/lib/validation/event'

const objectIdPattern = /^[0-9a-f]{24}$/

function fail(message: string): never {
  redirect(`/admin/event?error=${encodeURIComponent(message)}`)
}

function requireId(formData: FormData, field = 'id'): string {
  const value = String(formData.get(field) ?? '')
  if (!objectIdPattern.test(value)) fail('That record could not be found.')
  return value
}

export async function saveEventAction(formData: FormData): Promise<void> {
  const actor = await requireRole('ADMIN')
  await requireCsrf(formData)

  const parsed = eventDetailsSchema.safeParse({
    name: formData.get('name'),
    tagline: formData.get('tagline') ?? '',
    startsAt: formData.get('startsAt'),
    timezone: formData.get('timezone') || 'UTC',
    venueName: formData.get('venueName'),
    address: formData.get('address'),
    dressCode: formData.get('dressCode') ?? '',
    rsvpDeadline: formData.get('rsvpDeadline'),
  })
  if (!parsed.success) fail(parsed.error.issues[0]?.message ?? 'Check the event details.')

  const existing = await getEvent(prisma)
  if (existing) {
    await updateEventDetails(prisma, actor.id, existing.id, parsed.data)
  } else {
    await prisma.event.create({ data: parsed.data })
  }
  revalidatePath('/admin/event')
}

export async function saveAgendaItemAction(formData: FormData): Promise<void> {
  const actor = await requireRole('ADMIN')
  await requireCsrf(formData)

  const event = await getEvent(prisma)
  if (!event) fail('Create the event before adding agenda items.')

  const rawId = String(formData.get('id') ?? '')
  const parsed = agendaItemSchema.safeParse({
    id: rawId || undefined,
    title: formData.get('title'),
    description: formData.get('description') ?? '',
    icon: formData.get('icon') ?? '',
    startsAt: formData.get('startsAt'),
    sortOrder: formData.get('sortOrder') ?? 0,
  })
  if (!parsed.success) fail(parsed.error.issues[0]?.message ?? 'Check the agenda item.')

  await upsertAgendaItem(prisma, actor.id, event.id, parsed.data)
  revalidatePath('/admin/event')
}

export async function deleteAgendaItemAction(formData: FormData): Promise<void> {
  const actor = await requireRole('ADMIN')
  await requireCsrf(formData)
  await deleteAgendaItem(prisma, actor.id, requireId(formData))
  revalidatePath('/admin/event')
}

export async function saveMealOptionAction(formData: FormData): Promise<void> {
  const actor = await requireRole('ADMIN')
  await requireCsrf(formData)

  const event = await getEvent(prisma)
  if (!event) fail('Create the event before adding meal options.')

  const rawId = String(formData.get('id') ?? '')
  const parsed = mealOptionSchema.safeParse({
    id: rawId || undefined,
    label: formData.get('label'),
    description: formData.get('description') ?? '',
    sortOrder: formData.get('sortOrder') ?? 0,
  })
  if (!parsed.success) fail(parsed.error.issues[0]?.message ?? 'Check the meal option.')

  await upsertMealOption(prisma, actor.id, event.id, parsed.data)
  revalidatePath('/admin/event')
}

export async function toggleMealOptionAction(formData: FormData): Promise<void> {
  const actor = await requireRole('ADMIN')
  await requireCsrf(formData)
  const isActive = formData.get('isActive') === 'true'
  await setMealOptionActive(prisma, actor.id, requireId(formData), isActive)
  revalidatePath('/admin/event')
}
```

- [ ] **Step 2: Implement `src/app/admin/event/page.tsx`**

```tsx
import { prisma } from '@/lib/db'
import { requireRole } from '@/lib/auth/guard'
import { getEvent } from '@/lib/events/repository'
import { CsrfInput } from '@/components/admin/csrf-input'
import { Field } from '@/components/admin/field'
import { Table, Td } from '@/components/admin/table'
import {
  saveEventAction, saveAgendaItemAction, deleteAgendaItemAction,
  saveMealOptionAction, toggleMealOptionAction,
} from './actions'

/** `datetime-local` wants `YYYY-MM-DDTHH:mm` with no zone or seconds. */
function toLocalInput(value: Date | undefined): string {
  return value ? value.toISOString().slice(0, 16) : ''
}

export default async function EventPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  await requireRole('ADMIN')
  const { error } = await searchParams
  const event = await getEvent(prisma)

  return (
    <section className="space-y-10">
      <h1 className="font-serif text-2xl">Event</h1>

      {error ? (
        <p role="alert" className="rounded border border-[var(--color-danger)] px-3 py-2 text-sm text-[var(--color-danger)]">
          {error}
        </p>
      ) : null}

      {!event ? (
        <p className="rounded border border-[var(--color-border)] p-4 text-sm text-[var(--color-text-muted)]">
          No event configured yet. Fill this in first — the guest portal cannot render without it.
        </p>
      ) : null}

      <form action={saveEventAction} className="grid gap-4 sm:grid-cols-2">
        <CsrfInput />
        <Field label="Event name" name="name" defaultValue={event?.name ?? ''} required />
        <Field label="Tagline" name="tagline" defaultValue={event?.tagline ?? ''} />
        <Field label="Starts at" name="startsAt" type="datetime-local" defaultValue={toLocalInput(event?.startsAt)} required />
        <Field label="RSVP deadline" name="rsvpDeadline" type="datetime-local" defaultValue={toLocalInput(event?.rsvpDeadline)} required />
        <Field label="Timezone" name="timezone" defaultValue={event?.timezone ?? 'UTC'} />
        <Field label="Venue" name="venueName" defaultValue={event?.venueName ?? ''} required />
        <Field label="Address" name="address" defaultValue={event?.address ?? ''} required />
        <Field label="Dress code" name="dressCode" defaultValue={event?.dressCode ?? ''} />
        <button type="submit" className="self-end rounded bg-[var(--color-brass)] px-4 py-2 font-medium text-[var(--color-ink-deep)]">
          Save event
        </button>
      </form>

      {event ? (
        <>
          <div className="space-y-4">
            <h2 className="font-serif text-xl">Agenda</h2>
            <Table headers={['Time', 'Title', 'Order', '']}>
              {event.agendaItems.map((item) => (
                <tr key={item.id}>
                  <Td>{item.startsAt.toISOString().slice(11, 16)}</Td>
                  <Td>{item.title}</Td>
                  <Td>{item.sortOrder}</Td>
                  <Td>
                    <form action={deleteAgendaItemAction}>
                      <CsrfInput />
                      <input type="hidden" name="id" value={item.id} />
                      <button type="submit" className="text-xs underline underline-offset-4">Remove</button>
                    </form>
                  </Td>
                </tr>
              ))}
            </Table>

            <form action={saveAgendaItemAction} className="grid gap-4 sm:grid-cols-4">
              <CsrfInput />
              <Field label="Title" name="title" required />
              <Field label="Starts at" name="startsAt" type="datetime-local" required />
              <Field label="Order" name="sortOrder" type="number" defaultValue="0" />
              <Field label="Description" name="description" />
              <button type="submit" className="self-end rounded border border-[var(--color-border)] px-4 py-2">
                Add agenda item
              </button>
            </form>
          </div>

          <div className="space-y-4">
            <h2 className="font-serif text-xl">Meal options</h2>
            <Table headers={['Label', 'Description', 'Status', '']}>
              {event.mealOptions.map((meal) => (
                <tr key={meal.id}>
                  <Td>{meal.label}</Td>
                  <Td>{meal.description ?? '—'}</Td>
                  <Td>{meal.isActive ? 'Offered' : 'Retired'}</Td>
                  <Td>
                    <form action={toggleMealOptionAction}>
                      <CsrfInput />
                      <input type="hidden" name="id" value={meal.id} />
                      <input type="hidden" name="isActive" value={meal.isActive ? 'false' : 'true'} />
                      <button type="submit" className="text-xs underline underline-offset-4">
                        {meal.isActive ? 'Retire' : 'Offer again'}
                      </button>
                    </form>
                  </Td>
                </tr>
              ))}
            </Table>
            <p className="text-xs text-[var(--color-text-muted)]">
              Retiring a meal hides it from new responses. It is never deleted, because guests
              may already have chosen it.
            </p>

            <form action={saveMealOptionAction} className="grid gap-4 sm:grid-cols-4">
              <CsrfInput />
              <Field label="Label" name="label" required />
              <Field label="Description" name="description" />
              <Field label="Order" name="sortOrder" type="number" defaultValue="0" />
              <button type="submit" className="self-end rounded border border-[var(--color-border)] px-4 py-2">
                Add meal option
              </button>
            </form>
          </div>
        </>
      ) : null}
    </section>
  )
}
```

- [ ] **Step 3: Verify and commit**

```bash
npm run typecheck 2>&1 | grep -v "^>"
npm run lint
npm run build && git checkout tsconfig.json
git add src/app/admin/event
git commit -m "feat: event settings, agenda and meal options"
```

---

## Task 15: Floorplan upload and marker placement

**Files:**
- Create: `src/app/admin/event/floorplan-actions.ts`, `src/app/admin/event/floorplan-editor.tsx`
- Modify: `src/app/admin/event/page.tsx` (render the editor beneath the meal options)
- Test: covered by Task 16's end-to-end suite

**Interfaces:**
- Consumes: `storeImage`, `deleteImage` (Task 12); `upsertTableMarker`, `deleteTableMarker` (Task 13); `tableMarkerSchema` (Task 13); `MAX_IMAGE_BYTES` (Task 11)
- Produces: `uploadFloorplanAction`, `placeMarkerAction`, `removeMarkerAction`; `<FloorplanEditor eventId floorplanAssetId markers csrf />`

**Placement is a click, not a coordinate the operator types.** The editor renders the floorplan, converts a click to a normalised 0–1 pair using the image's own bounding box, and posts that with a table number. Using the bounding box rather than `naturalWidth` is what keeps a marker correct when the image is scaled — which it always is on a phone.

- [ ] **Step 1: Implement `src/app/admin/event/floorplan-actions.ts`**

```ts
'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/db'
import { requireCsrf, requireRole } from '@/lib/auth/guard'
import { storeImage, deleteImage } from '@/lib/media/repository'
import { InvalidImageError, MAX_IMAGE_BYTES } from '@/lib/media/images'
import { upsertTableMarker, deleteTableMarker, MarkerOutOfBoundsError } from '@/lib/events/markers'
import { tableMarkerSchema } from '@/lib/validation/event'
import { getEvent } from '@/lib/events/repository'

function fail(message: string): never {
  redirect(`/admin/event?error=${encodeURIComponent(message)}`)
}

export async function uploadFloorplanAction(formData: FormData): Promise<void> {
  const actor = await requireRole('ADMIN')
  await requireCsrf(formData)

  const event = await getEvent(prisma)
  if (!event) fail('Create the event before uploading a floorplan.')

  const file = formData.get('floorplan')
  if (!(file instanceof File) || file.size === 0) fail('Choose an image to upload.')
  if (file.size > MAX_IMAGE_BYTES) fail('That image is larger than 8 MB.')

  const bytes = Buffer.from(await file.arrayBuffer())

  let assetId: string
  try {
    // storeImage sniffs the real type from these bytes; the filename and the
    // browser's declared type are both ignored.
    assetId = await storeImage(prisma, actor.id, file.name, bytes)
  } catch (error) {
    fail(error instanceof InvalidImageError ? error.message : 'That file could not be read.')
  }

  const previousAssetId = event.floorplanAssetId
  await prisma.event.update({ where: { id: event.id }, data: { floorplanAssetId: assetId } })

  // Only after the new one is referenced, so a failure never leaves the event
  // pointing at a deleted asset.
  if (previousAssetId) {
    await deleteImage(prisma, actor.id, previousAssetId).catch(() => undefined)
  }

  revalidatePath('/admin/event')
}

export async function placeMarkerAction(formData: FormData): Promise<void> {
  const actor = await requireRole('ADMIN')
  await requireCsrf(formData)

  const event = await getEvent(prisma)
  if (!event) fail('Create the event before placing tables.')

  const parsed = tableMarkerSchema.safeParse({
    tableNumber: formData.get('tableNumber'),
    x: formData.get('x'),
    y: formData.get('y'),
  })
  if (!parsed.success) fail(parsed.error.issues[0]?.message ?? 'Check the table details.')

  try {
    await upsertTableMarker(prisma, actor.id, event.id, parsed.data)
  } catch (error) {
    fail(error instanceof MarkerOutOfBoundsError ? error.message : 'That table could not be placed.')
  }
  revalidatePath('/admin/event')
}

export async function removeMarkerAction(formData: FormData): Promise<void> {
  const actor = await requireRole('ADMIN')
  await requireCsrf(formData)
  const id = String(formData.get('id') ?? '')
  if (!/^[0-9a-f]{24}$/.test(id)) fail('That table could not be found.')
  await deleteTableMarker(prisma, actor.id, id)
  revalidatePath('/admin/event')
}
```

- [ ] **Step 2: Implement `src/app/admin/event/floorplan-editor.tsx`**

```tsx
'use client'

import { useRef, useState } from 'react'
import type { TableMarkerRow } from '@/lib/events/repository'
import { placeMarkerAction, removeMarkerAction, uploadFloorplanAction } from './floorplan-actions'

export function FloorplanEditor({
  floorplanAssetId, markers, csrf,
}: {
  floorplanAssetId: string | null
  markers: TableMarkerRow[]
  csrf: string
}) {
  const imageRef = useRef<HTMLImageElement>(null)
  const [pending, setPending] = useState<{ x: number; y: number } | null>(null)

  /**
   * Convert a click to normalised 0-1 coordinates using the RENDERED bounding
   * box, not the image's natural size — the floorplan is scaled on every
   * viewport, and natural pixels would put the marker in the wrong place
   * everywhere except one width.
   */
  function handleClick(clickEvent: React.MouseEvent<HTMLImageElement>) {
    const box = imageRef.current?.getBoundingClientRect()
    if (!box || box.width === 0 || box.height === 0) return
    setPending({
      x: Math.min(1, Math.max(0, (clickEvent.clientX - box.left) / box.width)),
      y: Math.min(1, Math.max(0, (clickEvent.clientY - box.top) / box.height)),
    })
  }

  return (
    <div className="space-y-4">
      <h2 className="font-serif text-xl">Floorplan</h2>

      <form action={uploadFloorplanAction} className="flex flex-wrap items-end gap-4">
        <input type="hidden" name="csrf" value={csrf} />
        <label className="block">
          <span className="mb-1 block text-sm text-[var(--color-text-muted)]">
            Floorplan image (PNG, JPEG or WEBP, up to 8 MB)
          </span>
          <input type="file" name="floorplan" accept="image/png,image/jpeg,image/webp" required className="text-sm" />
        </label>
        <button type="submit" className="rounded border border-[var(--color-border)] px-4 py-2">
          Upload
        </button>
      </form>

      {floorplanAssetId ? (
        <>
          <p className="text-sm text-[var(--color-text-muted)]">
            Click the plan to place a table.
          </p>
          <div className="relative inline-block max-w-full">
            {/* eslint-disable-next-line @next/next/no-img-element -- served from our own
                route handler at unknown intrinsic size */}
            <img
              ref={imageRef}
              src={`/api/media/${floorplanAssetId}`}
              alt="Venue floorplan"
              onClick={handleClick}
              className="block max-w-full cursor-crosshair"
              data-testid="floorplan-image"
            />
            {markers.map((marker) => (
              <span
                key={marker.id}
                className="absolute flex h-6 w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-[var(--color-brass)] text-[10px] font-bold text-[var(--color-ink-deep)]"
                style={{ left: `${marker.x * 100}%`, top: `${marker.y * 100}%` }}
                title={`Table ${marker.tableNumber}`}
              >
                {marker.tableNumber}
              </span>
            ))}
            {pending ? (
              <span
                className="absolute h-6 w-6 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-dashed border-[var(--color-brass)]"
                style={{ left: `${pending.x * 100}%`, top: `${pending.y * 100}%` }}
                data-testid="pending-marker"
              />
            ) : null}
          </div>

          {pending ? (
            <form action={placeMarkerAction} className="flex flex-wrap items-end gap-3">
              <input type="hidden" name="csrf" value={csrf} />
              <input type="hidden" name="x" value={pending.x} />
              <input type="hidden" name="y" value={pending.y} />
              <label className="block">
                <span className="mb-1 block text-sm text-[var(--color-text-muted)]">Table number</span>
                <input
                  name="tableNumber"
                  required
                  autoFocus
                  className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2"
                />
              </label>
              <button type="submit" className="rounded bg-[var(--color-brass)] px-4 py-2 font-medium text-[var(--color-ink-deep)]">
                Place table
              </button>
              <button type="button" onClick={() => setPending(null)} className="text-sm underline underline-offset-4">
                Cancel
              </button>
            </form>
          ) : null}

          {markers.length > 0 ? (
            <ul className="flex flex-wrap gap-2 text-sm">
              {markers.map((marker) => (
                <li key={marker.id}>
                  <form action={removeMarkerAction} className="flex items-center gap-1">
                    <input type="hidden" name="csrf" value={csrf} />
                    <input type="hidden" name="id" value={marker.id} />
                    <span className="rounded border border-[var(--color-border)] px-2 py-1">
                      Table {marker.tableNumber}
                    </span>
                    <button type="submit" aria-label={`Remove table ${marker.tableNumber}`} className="text-xs underline">
                      remove
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          ) : null}
        </>
      ) : null}
    </div>
  )
}
```

- [ ] **Step 3: Render the editor from the event page**

In `src/app/admin/event/page.tsx`, read the CSRF cookie once (read only — never set during
render) and render the editor inside the `{event ? … }` block, after the meal options:

```tsx
const store = await cookies()
const csrf = store.get(CSRF_COOKIE)?.value
if (!csrf) throw new Error('CSRF cookie missing — check that src/middleware.ts matches this route')
```

```tsx
<FloorplanEditor
  floorplanAssetId={event.floorplanAssetId}
  markers={event.tableMarkers}
  csrf={csrf}
/>
```

- [ ] **Step 4: Verify and commit**

```bash
npm run typecheck 2>&1 | grep -v "^>"
npm run lint
npm run build && git checkout tsconfig.json
git add src/app/admin/event
git commit -m "feat: floorplan upload and click-to-place table markers"
```

---

## Task 16: End-to-end coverage

**Files:**
- Create: `tests/e2e/guest-rsvp.spec.ts`, `tests/e2e/event-config.spec.ts`
- Modify: `tests/e2e/global-setup.ts` — seed an event, agenda, meal options and an invite whose token the specs can use

**Interfaces:**
- Consumes: everything above
- Produces: an exported `E2E_GUEST_TOKEN` (or an equivalent shared constant) so both specs can reach a known invite

**The setup problem, and why it is not a shortcut.** Invite tokens are stored hashed, so a spec cannot read one out of the database. Global setup must therefore *generate* a token, store its hash and cipher, and hand the plaintext to the specs — exactly as `createInvite` does. Use `createInvite` itself rather than hand-rolling the row: a bespoke fixture that skips `tokenCipher` would drift from production and quietly stop testing the real path.

- [ ] **Step 1: Extend `tests/e2e/global-setup.ts`**

After the existing wipe and the OWNER/ADMIN/STAFF creation, add an event with two agenda
items and two meal options, then one invite with two seats. Export the plaintext token
through a module-level constant the specs import, or write it to a file the specs read —
whichever fits the existing setup's shape. Keep the full database wipe: these fixtures must
be recreated every run, or the guest specs will drift the same way the admin ones did.

- [ ] **Step 2: Write `tests/e2e/guest-rsvp.spec.ts`**

```ts
import { test, expect } from '@playwright/test'
import { E2E_GUEST_TOKEN } from './global-setup'

test.describe('guest RSVP', () => {
  test('an unknown token shows the not-found page, not a crash', async ({ page }) => {
    const response = await page.goto('/i/definitely-not-a-real-token')
    expect(response?.status()).toBe(404)
    await expect(page.getByRole('heading', { level: 1 })).toContainText("couldn't find")
  })

  test('a valid token greets the guest by name and shows the agenda', async ({ page }) => {
    await page.goto(`/i/${E2E_GUEST_TOKEN}`)
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Welcome')
    await expect(page.getByRole('heading', { name: 'The evening' })).toBeVisible()
    await expect(page.getByRole('listitem').first()).toBeVisible()
  })

  test('shows the table and its marker on the floorplan', async ({ page }) => {
    await page.goto(`/i/${E2E_GUEST_TOKEN}`)
    await expect(page.getByText(/You.re at/)).toBeVisible()
  })

  test('accepts an RSVP for the whole party', async ({ page }) => {
    await page.goto(`/i/${E2E_GUEST_TOKEN}`)
    await page.getByLabel('Joyfully accepts').check()
    await page.getByRole('button', { name: 'Continue' }).click()   // -> who's coming
    await page.getByLabel('First name').first().fill('Jordan')
    await page.getByLabel('Last name').first().fill('Reyes')
    await page.getByRole('button', { name: 'Continue' }).click()   // -> extra seats
    await page.getByRole('button', { name: 'Continue' }).click()   // -> review
    await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '4')
    await page.getByRole('button', { name: 'Continue' }).click()   // -> confirm
    await page.getByRole('button', { name: 'Send response' }).click()
    await expect(page.getByTestId('rsvp-confirmed')).toContainText('look forward')
  })

  test('records a decline', async ({ page }) => {
    await page.goto(`/i/${E2E_GUEST_TOKEN}`)
    await page.getByLabel('Regretfully declines').check()
    // Declining skips steps 2-4: there is nothing to ask someone who is not coming.
    await page.getByRole('button', { name: 'Continue' }).click()
    await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '5')
    await page.getByRole('button', { name: 'Send response' }).click()
    await expect(page.getByTestId('rsvp-confirmed')).toContainText('missed')
  })

  test('keeps entered details when the guest steps back', async ({ page }) => {
    // Unmounting a step would silently discard input and drop the field from
    // the submit; this is the test that catches it.
    await page.goto(`/i/${E2E_GUEST_TOKEN}`)
    await page.getByLabel('Joyfully accepts').check()
    await page.getByRole('button', { name: 'Continue' }).click()
    await page.getByLabel('Company').first().fill('Northwind')
    await page.getByRole('button', { name: 'Continue' }).click()
    await page.getByRole('button', { name: 'Back' }).click()
    await expect(page.getByLabel('Company').first()).toHaveValue('Northwind')
  })

  test('serves a calendar file', async ({ page }) => {
    const response = await page.request.get(`/i/${E2E_GUEST_TOKEN}/calendar`)
    expect(response.status()).toBe(200)
    expect(response.headers()['content-type']).toContain('text/calendar')
    expect(await response.text()).toContain('BEGIN:VCALENDAR')
  })

  test('refuses a calendar for an unknown token', async ({ page }) => {
    const response = await page.request.get('/i/nope/calendar')
    expect(response.status()).toBe(404)
  })

  test('the guest page is not indexable', async ({ page }) => {
    const response = await page.goto(`/i/${E2E_GUEST_TOKEN}`)
    const robots = await page.locator('meta[name="robots"]').getAttribute('content')
    expect(robots).toContain('noindex')
    expect(response?.status()).toBe(200)
  })

  test('rejects a submission with a bad CSRF token', async ({ page, request }) => {
    // The guest portal is an unauthenticated POST surface; this is its only guard.
    await page.goto(`/i/${E2E_GUEST_TOKEN}`)
    const response = await request.post(`/i/${E2E_GUEST_TOKEN}`, {
      form: { csrf: 'wrong', token: E2E_GUEST_TOKEN, attending: 'no' },
      maxRedirects: 0,
    })
    expect(response.status()).toBeGreaterThanOrEqual(400)
  })
})
```

- [ ] **Step 3: Write `tests/e2e/event-config.spec.ts`**

Sign in as ADMIN (the helper already exists in `tests/e2e/authorization.spec.ts` — extract it
to a shared helper rather than copying it) and cover:
- the event form saves a changed name and it survives a reload
- an RSVP deadline after the event start is rejected with a visible message
- adding an agenda item makes it appear in the table
- removing an agenda item removes it
- adding a meal option makes it appear, and retiring it flips its status to `Retired` without deleting the row
- uploading a non-image file is refused with a visible message naming the problem
- STAFF cannot reach `/admin/event`

The upload-refusal case is the one worth writing carefully: post a small text buffer with a
`.png` filename and assert the operator sees a refusal. That proves type is decided by the
bytes, which is the whole point of Task 11.

- [ ] **Step 4: Run the complete suite**

```bash
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -like '*2026CHASERSVP*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"
rm -rf .next
npm run test:e2e
```

Every spec must pass, including all 56 from Plan 1. Then **run it a second time back to
back** — the fixtures are recreated per run, and one green run is not evidence of that.

- [ ] **Step 5: Verify and commit**

```bash
npx vitest run
npm run typecheck 2>&1 | grep -v "^>"
npm run lint
git add tests/e2e
git commit -m "test: end-to-end coverage for the guest portal and event configuration"
```

---

---

## AS-BUILT DIVERGENCES — read before re-running any task from this plan

The code in this plan is the code that was *dispatched*. A security review of the guest
attack surface found defects, and **the working tree is now the source of truth, not this
document**. Re-running a task below from the plan text would faithfully reintroduce a fixed bug.

| Module | Plan text is stale because | Read instead |
| --- | --- | --- |
| `src/lib/guest/rsvp.ts` (Task 5) | Resubmitting an RSVP silently destroyed `isPrimary`, `tableNumber` and `checkedInAt`: entries without an id were created fresh and unresubmitted guests deleted. Stripping the hidden id inputs in devtools wiped a party's seat assignment and door check-in state. Now preserves those fields on update and refuses to delete a guest who has already checked in. Also validates `mealOptionId` against the event's active options (any ObjectId was written through) and rejects duplicate ids (`[id1, id1]` deleted a party member). | the file |
| `src/lib/auth/csrf.ts`, `src/middleware.ts` (Task 6) | One CSRF cookie at path `/` served both the admin panel and the unauthenticated guest portal, so the admin double-submit secret was rendered into a public page. The guest surface now has its own cookie, `gala_guest_csrf`. | the files |
| `src/app/api/media/[id]/route.ts` (Task 12) | Served ANY `MediaAsset` row, cached immutable for a year, to anyone. Now serves only the current event's floorplan. | the file |
| `src/lib/media/images.ts` (Task 11) | `readWebp` accepted `VP8X`/`VP8L` containers while parsing lossy-VP8 offsets and returned garbage dimensions. Now rejects what it cannot parse. A total-pixel cap was added. **Known limitation, by design:** dimensions are self-declared and the payload is not decoded, so a header-only "PNG" passes validation and renders as a broken image. Serving is still safe — stored Content-Type plus `nosniff` means the browser never executes it. | the file |
| `src/app/i/[token]/actions.ts` (Task 9) | Uses `GUEST_CSRF_COOKIE`, not `CSRF_COOKIE`, after the split above. | the file |
| `tests/integration/calendar-route.test.ts` (Task 10) | Both DTEND branches expected the same value (22:00+1h == 18:00+5h), so deleting the agenda branch entirely left both green. Fixtures changed so the branches differ. | the file |

### Tests this plan shipped that could not fail

Six, all rewritten: the idempotency test carried no ids (so it passed against the data loss
above); both calendar branches expected identical output; `csrf-routes` tested a predicate
middleware never called; the media tests used a 33-byte non-image and never exercised a
trailing payload; an audit test used JSON length as a proxy for "no bytes recorded"; and the
bad-CSRF E2E posted a URL-encoded body to a form that binds a real Server Action (multipart,
soft error state) — it had to intercept the real POST and tamper the field in flight.

## Definition of done

- [ ] `npx vitest run`, `npm run typecheck`, `npm run lint` and `npm run build` all clean
- [ ] `npm run test:e2e` green **twice back to back**
- [ ] Coverage at or above 80% on lines, functions, branches and statements
- [ ] A guest scanning a QR code sees their name, the agenda, their table, and can accept or decline
- [ ] A guest cannot modify another party's details by submitting a foreign guest id — proven by a test that fails when the check is removed
- [ ] A guest cannot RSVP after the deadline, and the page says so rather than showing a dead form
- [ ] An admin can configure the event, agenda, meals and floorplan without touching code
- [ ] An uploaded file's type is decided by its bytes; a renamed text file is refused
- [ ] A retired meal option is deactivated, never deleted, so no guest's choice is stranded
- [ ] `/i/*` carries `noindex` and no invite token appears in any URL, log or audit row

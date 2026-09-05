# Open Parties, Per-Guest Tables, CSV Upsert Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a guest bring any number of companions, show each attending guest their own table, and make CSV import fill in existing invites by label instead of minting duplicates.

**Architecture:** Three independent slices over the existing Next.js 16 / Prisma / MongoDB app. Slice 1 deletes the seat-limit and extra-seats machinery end to end. Slice 2 threads `Guest.tableNumber` (already in the schema) through admin edit, guest page, and check-in. Slice 3 adds an import planner that classifies each CSV row as create / update / skip inside the commit transaction.

**Tech Stack:** Next.js 16 (App Router, server actions), React 19, Prisma 6 on MongoDB (replica set on port 27018), Zod 3, Vitest (unit + integration against `DATABASE_URL_TEST`), Playwright (against its own e2e database), Tailwind 4.

**Spec:** `docs/superpowers/specs/2026-09-04-open-parties-per-guest-tables-csv-upsert-design.md`

## Global Constraints

- The working tree already carries the uncommitted numbered-placeholder feature (`Invite.number`, QR export, seat-release gate). Do not revert any of it. Commit only the files each task names.
- `src/lib/invites/qr.ts` and `tests/unit/qr.test.ts` carry a parked, unrelated edit (bold index on the QR sheet). Never `git add` those two files in this plan.
- Guests never delete guest rows. A checked-in guest's record must survive any RSVP resubmission.
- `seatsAllotted` remains in the schema and the admin forms as a planning number. Nothing enforces it after this plan.
- Guest-page copy: the seat section heading is "Your seat" for one showable seat, "Your seats" for several.
- RSVP request-size ceiling: `MAX_GUESTS_PER_SUBMISSION = 100`, message "That is too many people to submit in one go. Please contact the organiser."
- Import skip reasons, verbatim: `label matches several invites`, `duplicate label in file`, `email already exists`.
- MongoDB has no foreign keys and Prisma ignores undeclared fields, so dropping the `extraSeats*` fields needs no backfill. Run `npm run db:push` (dev database) and, for the integration suite, `DATABASE_URL=<DATABASE_URL_TEST> npx prisma db push --skip-generate` after the schema task. Playwright's global-setup pushes the e2e database itself.
- Test commands: `npx vitest run <file>` for one file, `npm test` for unit + integration, `npx playwright test <file>` for one spec, `npm run typecheck`, `npm run lint`.
- Commit message format: `<type>: <description>`; end every commit with the two trailer lines
  `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` and
  `Claude-Session: https://claude.ai/code/session_01HLwR64SruedtHzUzS4Yh8v`.

## File Structure

| File | Responsibility after this plan |
|---|---|
| `src/lib/validation/guest.ts` | RSVP payload schema: guests only, 100-entry ceiling |
| `src/lib/guest/rsvp.ts` | Apply a submission: no seat check, no extra-seats write |
| `src/app/i/[token]/actions.ts` | Server action: parses guests only |
| `src/app/i/[token]/rsvp-form.tsx` | Unlimited "Bring a guest" rows with optional names |
| `src/components/guest/guest-toggle.tsx` | Adds optional name inputs for a companion row |
| `prisma/schema.prisma` | `Invite` without `extraSeats*`; `ExtraSeatsStatus` enum removed |
| `src/lib/invites/repository.ts` | No `SeatLimitError`, no `resolveExtraSeats`; rows without extra-seats fields |
| `src/lib/invites/guests.ts` | No `GuestLimitError`; `GuestDetails.tableNumber` |
| `src/lib/validation/invites.ts` | `inviteGuestSchema` accepts `tableNumber` |
| `src/app/admin/invites/actions.ts` | No `resolveExtraSeatsAction`; guest forms carry `tableNumber` |
| `src/app/admin/invites/[id]/page.tsx` | Table field per guest; no extra-seats block; add-guest always available |
| `src/lib/stats/rsvp.ts`, `src/app/admin/page.tsx` | No pending-extra-seats count |
| `src/lib/guest/resolve.ts` | `GuestInvite` without extra-seats fields |
| `src/lib/guest/seat-reveal.ts` | Per-guest `seatVisibility` + `partySeatVisibility` |
| `src/lib/guest/page-data.ts` | `seats: Seat[]` per showable guest |
| `src/components/guest/seat-map.tsx` | Many markers, one zoom origin |
| `src/app/i/[token]/page.tsx` | "Your seat(s)" list |
| `src/lib/checkin/repository.ts` | `PartyGuest.tableNumber` resolved per guest; no party-level table |
| `src/app/admin/checkin/party-card.tsx` | Table beside each name |
| `src/lib/invites/csv.ts` | Flags duplicate labels within a file |
| `src/lib/invites/import-plan.ts` (new) | Classifies rows: create / update / skip, by label then number |
| `src/lib/invites/import.ts` | Commits creates and updates in one transaction using the plan |
| `src/app/admin/invites/import/actions.ts`, `import-form.tsx`, `page.tsx` | Preview shows per-row action; result reports created / updated / skipped |
| `src/app/admin/invites/page.tsx` | Import banner reads `imported`, `updated`, `skipped` |

---

### Task 1: RSVP accepts any party size and drops extra seats

**Files:**
- Modify: `src/lib/validation/guest.ts`
- Modify: `src/lib/guest/rsvp.ts`
- Modify: `src/app/i/[token]/actions.ts`
- Test: `tests/unit/guest-validation.test.ts`
- Test: `tests/integration/rsvp.test.ts`

**Interfaces:**
- Produces: `rsvpSubmissionSchema = z.object({ guests: z.array(guestResponseSchema).min(1).max(100) })`; `RsvpSubmission = { guests: GuestResponse[] }`.
- Produces: `RsvpResult` refusal reasons are now `'NOT_FOUND' | 'CLOSED' | 'FOREIGN_GUEST' | 'DUPLICATE_GUEST' | 'INVALID_MEAL_OPTION'`.
- Consumes: nothing from later tasks. `SELECT_INVITE` in `rsvp.ts` still selects `seatsAllotted` until Task 2 removes the read; leave it and remove in this task (see Step 3).

- [ ] **Step 1: Rewrite the validation unit tests**

Replace the `describe('rsvpSubmissionSchema', ...)` block in `tests/unit/guest-validation.test.ts` with:

```ts
describe('rsvpSubmissionSchema', () => {
  const submission = { guests: [coming] }

  it('accepts a valid submission', () => {
    expect(rsvpSubmissionSchema.safeParse(submission).success).toBe(true)
  })

  it('rejects an empty party', () => {
    expect(rsvpSubmissionSchema.safeParse({ guests: [] }).success).toBe(false)
  })

  it('accepts a party where nobody is coming', () => {
    expect(rsvpSubmissionSchema.safeParse({ guests: [{ id: ID, attending: false }] }).success).toBe(true)
  })

  it('accepts a large party: there is no seat allowance', () => {
    const many = Array.from({ length: 60 }, () => ({ attending: true }))
    expect(rsvpSubmissionSchema.safeParse({ guests: many }).success).toBe(true)
  })

  it('caps a single submission at 100 entries as a request-size bound', () => {
    const many = Array.from({ length: 101 }, () => ({ attending: true }))
    const result = rsvpSubmissionSchema.safeParse({ guests: many })
    expect(result.success).toBe(false)
    expect(result.success ? '' : result.error.issues[0]?.message).toMatch(/too many people/)
  })

  it('has no extra-seats fields', () => {
    const parsed = rsvpSubmissionSchema.parse({ ...submission, extraSeatsRequested: 3, extraSeatsReason: 'x' })
    expect(parsed).not.toHaveProperty('extraSeatsRequested')
    expect(parsed).not.toHaveProperty('extraSeatsReason')
  })
})
```

- [ ] **Step 2: Run the unit test to see it fail**

Run: `npx vitest run tests/unit/guest-validation.test.ts`
Expected: FAIL. "accepts a large party" fails (41+ refused today); "has no extra-seats fields" fails (fields present).

- [ ] **Step 3: Update the schema**

In `src/lib/validation/guest.ts` replace the constants and `rsvpSubmissionSchema`:

```ts
export const MAX_NOTE_LENGTH = 1000
const MAX_NAME_LENGTH = 80
/**
 * A request-size bound, not a seat policy: a party may be any size, but
 * one form post carrying more than this is almost certainly not a guest.
 */
export const MAX_GUESTS_PER_SUBMISSION = 100
export const PARTY_TOO_LARGE = 'That is too many people to submit in one go. Please contact the organiser.'
```

Delete `MAX_EXTRA_SEATS`. Replace the submission schema:

```ts
export const rsvpSubmissionSchema = z.object({
  guests: z
    .array(guestResponseSchema)
    .min(1, 'Tell us who is coming')
    .max(MAX_GUESTS_PER_SUBMISSION, PARTY_TOO_LARGE),
})
```

- [ ] **Step 4: Run the unit test to see it pass**

Run: `npx vitest run tests/unit/guest-validation.test.ts`
Expected: PASS.

- [ ] **Step 5: Rewrite the integration tests that encode the seat limit**

In `tests/integration/rsvp.test.ts`:

1. Remove `extraSeatsRequested: 0` from every `submitRsvp(...)` payload (search-and-replace `, extraSeatsRequested: 0` with nothing; also the `extraSeatsRequested: 0,` line inside multi-line payloads).
2. Rename `'adds a named companion up to the seat allowance'` to `'adds a named companion'`.
3. Replace `'refuses more guests than the seat allowance'` with:

```ts
  it('accepts a party far larger than seatsAllotted', async () => {
    const { invite, token, primary } = await seedInvite(1)
    const eight = Array.from({ length: 8 }, (_, i) => companion({ firstName: `Friend ${i + 1}`, lastName: 'Reyes' }))
    const result = await submitRsvp(testDb, token, { guests: [coming(primary.id), ...eight] }, OPEN, DEADLINE)
    expect(result).toMatchObject({ ok: true, status: 'ATTENDING' })
    expect(await testDb.guest.count({ where: { inviteId: invite.id } })).toBe(9)
    expect((await testDb.invite.findUniqueOrThrow({ where: { id: invite.id } })).seatsAllotted).toBe(1)
  })
```

4. Delete `'records an extra-seat request as PENDING without creating seats'`.
5. Replace `'REFUSES a resubmission that strips the ids rather than replacing a checked-in guest'` with:

```ts
  it('a resubmission that strips the ids adds companions but never touches a checked-in guest', async () => {
    const { invite, token, primary } = await seedInvite(2)
    await submitRsvp(testDb, token, {
      guests: [coming(primary.id), companion({ firstName: 'Sam', lastName: 'Reyes' })],
    }, OPEN, DEADLINE)
    const sam = await testDb.guest.findFirstOrThrow({ where: { firstName: 'Sam' } })
    const checkinTime = new Date('2026-09-15T18:00:00Z')
    await testDb.guest.update({ where: { id: sam.id }, data: { tableNumber: '7', checkedInAt: checkinTime } })

    // Every hidden id stripped: both entries look like new companions. With
    // no seat cap the party grows to four, but nothing is ever deleted or
    // overwritten to make room.
    const result = await submitRsvp(testDb, token, { guests: [companion(), companion()] }, OPEN, DEADLINE)

    expect(result).toMatchObject({ ok: true })
    const stillCheckedIn = await testDb.guest.findUniqueOrThrow({ where: { id: sam.id } })
    expect(stillCheckedIn.checkedInAt?.toISOString()).toBe(checkinTime.toISOString())
    expect(stillCheckedIn.tableNumber).toBe('7')
    expect(await testDb.guest.count({ where: { inviteId: invite.id } })).toBe(4)
  })

  it('toggling a companion off on a later visit keeps their row', async () => {
    const { invite, token, primary } = await seedInvite(1)
    await submitRsvp(testDb, token, {
      guests: [coming(primary.id), companion({ firstName: 'Sam', lastName: 'Reyes' })],
    }, OPEN, DEADLINE)
    const sam = await testDb.guest.findFirstOrThrow({ where: { firstName: 'Sam' } })

    const result = await submitRsvp(testDb, token, { guests: [coming(primary.id), notComing(sam.id)] }, OPEN, DEADLINE)

    expect(result).toMatchObject({ ok: true, status: 'PARTIAL' })
    expect(await testDb.guest.count({ where: { inviteId: invite.id } })).toBe(2)
    expect((await testDb.guest.findUniqueOrThrow({ where: { id: sam.id } })).attending).toBe(false)
  })
```

6. In `'audits the submission ...'` change the meta assertion to `expect(log.meta).toMatchObject({ attending: true, partySize: 2 })`.

- [ ] **Step 6: Run the integration test to see it fail**

Run: `npx vitest run tests/integration/rsvp.test.ts`
Expected: FAIL on "accepts a party far larger" (SEAT_LIMIT) and on the two resubmission tests. Type errors on the removed `extraSeatsRequested` property are expected until Step 7.

- [ ] **Step 7: Remove the seat check and extra-seats write from `submitRsvp`**

In `src/lib/guest/rsvp.ts`:

1. Remove `'SEAT_LIMIT'` from the `RsvpResult` union.
2. Change `SELECT_INVITE` to `{ id: true, guests: { ... } }` (drop `seatsAllotted`).
3. Delete the block starting with the comment `// The party after this submission is everyone already known ...` through the `if (... > invite.seatsAllotted) { return ... 'SEAT_LIMIT' }` closing brace.
4. In the `tx.invite.update` call, reduce `data` to:

```ts
      data: { status: nextStatus, respondedAt: now },
```

5. In `writeAudit` meta use `{ attending: partySize > 0, partySize }`.

- [ ] **Step 8: Update the server action**

In `src/app/i/[token]/actions.ts`:

1. Replace the `safeParse` call with `rsvpSubmissionSchema.safeParse({ guests: collectGuests(formData) })`.
2. Replace the refusal message ternary with:

```ts
    const message =
      result.reason === 'CLOSED' ? 'RSVPs have closed. Please contact the organiser.' : GENERIC_FAILURE
```

- [ ] **Step 9: Run both test files and typecheck**

Run: `npx vitest run tests/unit/guest-validation.test.ts tests/integration/rsvp.test.ts && npm run typecheck`
Expected: both PASS. Typecheck may still report `extraSeatsRequested` usages in files this task does not own (`rsvp-form.tsx` uses `seatsAllotted`, `visual.spec.ts` uses `extraSeatsStatus`); those are Tasks 2 and 4. Anything inside the four files above must be clean.

- [ ] **Step 10: Commit**

```bash
git add src/lib/validation/guest.ts src/lib/guest/rsvp.ts "src/app/i/[token]/actions.ts" tests/unit/guest-validation.test.ts tests/integration/rsvp.test.ts
git commit -m "feat: RSVP accepts any party size and drops the extra-seats request"
```

---

### Task 2: Remove extra-seats and seat-limit machinery from schema, repository, admin

**Files:**
- Modify: `prisma/schema.prisma`
- Modify: `src/lib/invites/repository.ts`
- Modify: `src/lib/guest/resolve.ts`
- Modify: `src/lib/stats/rsvp.ts`
- Modify: `src/app/admin/page.tsx`
- Modify: `src/app/admin/invites/actions.ts`
- Modify: `src/app/admin/invites/[id]/page.tsx`
- Modify: `tests/e2e/visual.spec.ts:66-74`
- Modify: `tests/e2e/invites.spec.ts:145-153`
- Test: `tests/integration/invites.test.ts`
- Test: `tests/integration/stats.test.ts`

**Interfaces:**
- Produces: `InviteRow` and `InviteDetail` without `extraSeatsRequested`, `extraSeatsStatus`, `extraSeatsReason`. `GuestInvite` likewise. `Dashboard` without `pendingExtraSeats`.
- Produces: `updateInvite` no longer throws; `SeatLimitError` and `resolveExtraSeats` no longer exist.

- [ ] **Step 1: Update the repository integration tests**

In `tests/integration/invites.test.ts`:
1. Remove `resolveExtraSeats` and `SeatLimitError` from the import list.
2. Replace `'refuses to shrink seats below the number of guests'` with:

```ts
  it('lets seats shrink below the guest count: the allowance is a planning number only', async () => {
    const { invite } = await createInvite(testDb, null, base)
    await testDb.guest.create({ data: { inviteId: invite.id, firstName: 'Sam', lastName: 'Reyes' } })
    await updateInvite(testDb, null, invite.id, { seatsAllotted: 1 })
    expect((await testDb.invite.findUniqueOrThrow({ where: { id: invite.id } })).seatsAllotted).toBe(1)
  })
```

3. Delete `'approving extra seats raises the allowance'` and `'denying extra seats leaves the allowance alone'`.

In `tests/integration/stats.test.ts`:
1. Change the `mk` helper signature to `(label: string, status: ..., respondedAt: Date | null)` and its `data` to `{ tokenHash: label, tokenCipher: 'c', number: label.charCodeAt(0), label, status, respondedAt, seatsAllotted: 2 }`.
2. Change the `d` seed line to `await mk('D', 'PARTIAL', new Date('2026-09-05T10:00:00Z'))`.
3. Delete `'counts pending extra-seat requests'`.

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run tests/integration/invites.test.ts tests/integration/stats.test.ts`
Expected: FAIL. The shrink test throws `SeatLimitError`; the import of `resolveExtraSeats` still resolves so other tests pass.

- [ ] **Step 3: Edit the Prisma schema**

In `prisma/schema.prisma` delete the whole `enum ExtraSeatsStatus { ... }` block and these three lines from `model Invite`:

```
  extraSeatsRequested Int              @default(0)
  extraSeatsStatus    ExtraSeatsStatus @default(NONE)
  extraSeatsReason    String?
```

Then regenerate and push:

```bash
npx prisma generate
npm run db:push
```

And for the integration database (read `DATABASE_URL_TEST` from `.env`):

```bash
node -e "require('dotenv').config(); process.env.DATABASE_URL=process.env.DATABASE_URL_TEST; require('child_process').execSync('npx prisma db push --skip-generate', {stdio:'inherit', env: process.env})"
```

- [ ] **Step 4: Strip the repository**

In `src/lib/invites/repository.ts`:
1. Delete the `SeatLimitError` class.
2. In `InviteRow` delete `extraSeatsRequested` and `extraSeatsStatus`. In `ROW_SELECT` delete `extraSeatsRequested: true, extraSeatsStatus: true,`.
3. In `InviteDetail` delete `extraSeatsReason: string | null`. In `getInvite`'s select delete `extraSeatsReason: true,`.
4. In `updateInvite` delete the `if (patch.seatsAllotted !== undefined) { ... SeatLimitError }` block.
5. Delete the entire `resolveExtraSeats` function.

In `src/lib/guest/resolve.ts` delete the three `extraSeats*` lines from `GuestInvite` and from `SELECT`.

- [ ] **Step 5: Strip stats and dashboard**

In `src/lib/stats/rsvp.ts`: delete `pendingExtraSeats: number` from `Dashboard`; delete `pendingExtraSeats` from the destructured `Promise.all` tuple and its `db.invite.count(...)` entry; delete `pendingExtraSeats,` from the returned object.

In `src/app/admin/page.tsx` delete the `{d.pendingExtraSeats > 0 ? (...) : null}` block.

- [ ] **Step 6: Strip the admin actions and detail page**

In `src/app/admin/invites/actions.ts`:
1. Change the repository import to `import { createInvite, updateInvite, deleteInvite, regenerateInviteToken } from '@/lib/invites/repository'`.
2. In `describe()` delete the `SeatLimitError` line.
3. Delete the whole `resolveExtraSeatsAction` function.

In `src/app/admin/invites/[id]/page.tsx`:
1. Remove `resolveExtraSeatsAction` from the `'../actions'` import.
2. Delete the `{invite.extraSeatsStatus === 'PENDING' ? (...) : null}` block.

- [ ] **Step 7: Fix the two e2e fixtures**

In `tests/e2e/visual.spec.ts` change the `prisma.invite.update` data to:

```ts
      data: {
        status: 'ATTENDING',
        respondedAt: new Date('2026-08-01T12:00:00Z'),
      },
```

In `tests/e2e/invites.spec.ts` replace `'refuses to shrink seats below the guest count'` with:

```ts
  test('lets seats shrink below the guest count', async ({ page }) => {
    await signIn(page)
    await page.goto(`/admin/invites/${await disposableInviteId(`E2E Shrink ${Date.now()}`)}`)
    await page.getByLabel('Seats', { exact: true }).fill('0')
    await page.getByRole('button', { name: 'Save changes' }).click()
    // Zod refuses 0 (min 1) and reports it; 1 with one guest is accepted silently.
    await expect(page.getByRole('alert')).toBeVisible()
    await page.getByLabel('Seats', { exact: true }).fill('1')
    await page.getByRole('button', { name: 'Save changes' }).click()
    await expect(page.getByRole('alert')).toHaveCount(0)
  })
```

- [ ] **Step 8: Run tests and typecheck**

Run: `npx vitest run tests/integration/invites.test.ts tests/integration/stats.test.ts && npm run typecheck && npm run lint`
Expected: PASS. Typecheck will still flag `rsvp-form.tsx` (`seatsAllotted` read is fine, it still exists) and nothing else; if `visual.spec.ts` or any file lists `extraSeats*`, fix it.

Then: `grep -rn "extraSeats\|SeatLimitError\|resolveExtraSeats\|SEAT_LIMIT" src tests prisma` must print nothing.

- [ ] **Step 9: Commit**

```bash
git add prisma/schema.prisma src/lib/invites/repository.ts src/lib/guest/resolve.ts src/lib/stats/rsvp.ts src/app/admin/page.tsx src/app/admin/invites/actions.ts "src/app/admin/invites/[id]/page.tsx" tests/e2e/visual.spec.ts tests/e2e/invites.spec.ts tests/integration/invites.test.ts tests/integration/stats.test.ts
git commit -m "refactor: retire extra-seats requests and the seat-limit checks"
```

---

### Task 3: Admin guest rows carry a table; no seat cap on adding guests

**Files:**
- Modify: `src/lib/invites/guests.ts`
- Modify: `src/lib/validation/invites.ts`
- Modify: `src/app/admin/invites/actions.ts`
- Modify: `src/app/admin/invites/[id]/page.tsx`
- Test: `tests/integration/invite-guests.test.ts`

**Interfaces:**
- Produces: `GuestDetails = { firstName; lastName; email?; company?; title?; tableNumber? }`. `updateGuest`/`addGuest` write `tableNumber: details.tableNumber || null`.
- Produces: `inviteGuestSchema` = `primaryGuestSchema.extend({ tableNumber: z.string().trim().max(20).optional().or(z.literal('')) })`.
- Produces: `GuestLimitError` no longer exists.

- [ ] **Step 1: Update the integration tests**

In `tests/integration/invite-guests.test.ts`:
1. Remove `GuestLimitError` from the import.
2. Replace `'refuses to exceed the seat allotment'` with:

```ts
  it('adds guests past the seat allotment: seats are a planning number only', async () => {
    const { id } = await placeholder(1)
    await addGuest(testDb, null, id, { firstName: 'A', lastName: 'One' })
    await addGuest(testDb, null, id, { firstName: 'B', lastName: 'Two' })
    expect((await getInvite(testDb, id))?.guests).toHaveLength(2)
  })

  it('stores a table on the new guest when given one', async () => {
    const { id } = await placeholder(1)
    await addGuest(testDb, null, id, { firstName: 'A', lastName: 'One', tableNumber: '14' })
    expect((await getInvite(testDb, id))?.guests[0]?.tableNumber).toBe('14')
  })
```

3. In `describe('updateGuest')` add after `'changes the name and contact details'`:

```ts
  it('sets and clears the guest table independently of the invite', async () => {
    const { invite } = await createInvite(testDb, null, {
      label: 'P', seatsAllotted: 1, tableNumber: '3', primaryGuest: { firstName: 'Jordan', lastName: 'Reyes' },
    })
    const guest = (await getInvite(testDb, invite.id))!.guests[0]!
    await updateGuest(testDb, null, invite.id, guest.id, { firstName: 'Jordan', lastName: 'Reyes', tableNumber: '9' })
    expect((await getInvite(testDb, invite.id))!.guests[0]?.tableNumber).toBe('9')

    await updateGuest(testDb, null, invite.id, guest.id, { firstName: 'Jordan', lastName: 'Reyes', tableNumber: '' })
    expect((await getInvite(testDb, invite.id))!.guests[0]?.tableNumber).toBeNull()
    expect((await getInvite(testDb, invite.id))!.tableNumber).toBe('3')
  })
```

- [ ] **Step 2: Run to see failures**

Run: `npx vitest run tests/integration/invite-guests.test.ts`
Expected: FAIL: the over-allotment test throws `GuestLimitError`; the table tests see `null`.

- [ ] **Step 3: Implement in `guests.ts`**

1. Delete the `GuestLimitError` class.
2. Add `tableNumber?: string` to `GuestDetails`; in `toData` add `tableNumber: details.tableNumber || null,`.
3. In `addGuest` change the select to `select: { _count: { select: { guests: true } } }` and delete the `if (invite._count.guests >= invite.seatsAllotted) throw ...` line. Keep the invite `updatedAt` touch (update its comment to: "Touch the invite document so two admins adding the first guest at once conflict instead of both becoming primary").

- [ ] **Step 4: Validation and action**

In `src/lib/validation/invites.ts` replace `export const inviteGuestSchema = primaryGuestSchema` with:

```ts
export const inviteGuestSchema = primaryGuestSchema.extend({
  tableNumber: z.string().trim().max(20).optional().or(z.literal('')),
})
```

In `src/app/admin/invites/actions.ts`:
1. Remove `GuestLimitError` from the `@/lib/invites/guests` import and from `describe()`.
2. In `guestDetails()` add `tableNumber: formData.get('tableNumber') ?? '',`.

- [ ] **Step 5: Detail page**

In `src/app/admin/invites/[id]/page.tsx`:
1. Heading: `Guests <span ...>({invite.guests.length})</span>` (drop "of N seats").
2. In each guest form, after the Title field add `<Field label="Table" name="tableNumber" defaultValue={guest.tableNumber ?? ''} />`. Change the summary line to `{' · '}Table: {guest.tableNumber ?? invite.tableNumber ?? '—'}{guest.tableNumber ? '' : invite.tableNumber ? ' (party default)' : ''}`.
3. In the add-guest form add `<Field label="Table" name="tableNumber" />` after Title.
4. Replace `{invite.guests.length < invite.seatsAllotted ? (<details ...>...</details>) : null}` with the bare `<details ...>...</details>` (always rendered).

- [ ] **Step 6: Run tests, typecheck, lint**

Run: `npx vitest run tests/integration/invite-guests.test.ts && npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/invites/guests.ts src/lib/validation/invites.ts src/app/admin/invites/actions.ts "src/app/admin/invites/[id]/page.tsx" tests/integration/invite-guests.test.ts
git commit -m "feat: admin sets a table per guest and adds guests without a seat cap"
```

---

### Task 4: RSVP form: unlimited companions with optional names

**Files:**
- Modify: `src/components/guest/guest-toggle.tsx`
- Modify: `src/app/i/[token]/rsvp-form.tsx`
- Test: `tests/e2e/guest-rsvp.spec.ts`

**Interfaces:**
- Consumes: `submitRsvpAction` reads `guests.<i>.firstName` / `guests.<i>.lastName` (already does).
- Produces: a companion row renders two optional text inputs named `guests.<i>.firstName` and `guests.<i>.lastName`, labelled "First name (optional)" and "Last name (optional)".

- [ ] **Step 1: Write the e2e test**

In `tests/e2e/guest-rsvp.spec.ts` add after `'accepts an RSVP for the whole party, including a companion'`:

```ts
  test('a guest can bring five companions and name them', async ({ page }, testInfo) => {
    const token = await freshInviteToken(`E2E Big Party ${testInfo.project.name} ${Date.now()}`)
    await page.goto(`/i/${token}`)
    const bring = page.getByRole('button', { name: /Bring a guest/ })
    for (let i = 0; i < 5; i++) {
      await expect(bring).toBeVisible()
      await bring.click()
    }
    await expect(page.getByTestId('guest-response')).toHaveCount(6)
    // The button never disappears: there is no allowance to run out of.
    await expect(bring).toBeVisible()

    const lastRow = page.getByTestId('companion-row').last()
    await lastRow.getByLabel('First name (optional)').fill('Sam')
    await lastRow.getByLabel('Last name (optional)').fill('Haddad')

    await setEveryone(page, true)
    await confirm(page)
    await expect(page.getByTestId('rsvp-confirmed')).toContainText('look forward')

    await page.reload()
    const rows = page.getByTestId('guest-response')
    await expect(rows).toHaveCount(6)
    await expect(rows.last()).toContainText('Sam Haddad')
    await expect(rows.nth(1)).toContainText('Guest of Noor')
  })
```

Also update `'accepts an RSVP for the whole party, including a companion'`: the `if (await bring.isVisible())` guard becomes unconditional (`await bring.click()` then the expect), since the button is always present now.

- [ ] **Step 2: Run to see it fail**

Run: `npx playwright test tests/e2e/guest-rsvp.spec.ts -g "five companions"`
Expected: FAIL: the button disappears after one click on a 1-seat invite.

- [ ] **Step 3: Give `GuestToggle` optional name inputs**

Replace `src/components/guest/guest-toggle.tsx` with:

```tsx
const ROW =
  'flex min-h-14 w-full items-center justify-between gap-4 rounded-lg border px-4 py-3 text-left transition-colors ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] focus-visible:ring-offset-2'
const SELECTED = 'border-[var(--color-accent)] bg-[var(--color-accent)] text-[var(--on-accent)]'
const UNSELECTED = 'border-[var(--color-border)] text-[var(--color-text)]'
const NAME_INPUT =
  'w-full rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)] outline-none focus:border-[var(--color-accent)]'

/**
 * One seat: a name, highlighted when that person is coming. Tap to toggle.
 *
 * The answer travels as a hidden `guests.<i>.attending` input, and a known
 * guest's id alongside it, so the form is plain FormData for the action to
 * reassemble without relying on DOM order. `index` namespaces both.
 *
 * A companion being added on this visit (`id === null`) also gets two
 * optional name inputs; left blank, the server names them "Guest of <host>".
 */
export function GuestToggle({ index, id, name, note, selected, onToggle }: {
  index: number
  /** The guest's record id; absent for a companion being added on this visit. */
  id: string | null
  name: string
  note?: string
  selected: boolean
  onToggle: () => void
}) {
  const field = (key: string) => `guests.${index}.${key}`
  return (
    <div data-testid={id ? undefined : 'companion-row'} className="space-y-2">
      {id ? <input type="hidden" name={field('id')} value={id} /> : null}
      <input type="hidden" name={field('attending')} value={selected ? 'yes' : 'no'} />
      <button
        type="button"
        onClick={onToggle}
        aria-pressed={selected}
        data-testid="guest-response"
        className={`${ROW} ${selected ? SELECTED : UNSELECTED}`}
      >
        <span className="font-serif text-xl">
          {name}
          {/* No opacity here: the row's own text colour is the verified one,
              and white at 70% on the red fill drops to 2.9:1. */}
          {note ? <span className="ml-2 font-sans text-sm">{note}</span> : null}
        </span>
        <span className="shrink-0 text-sm">{selected ? '✓ Coming' : 'Not coming'}</span>
      </button>
      {id ? null : (
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="block">
            <span className="sr-only">First name (optional)</span>
            <input name={field('firstName')} placeholder="First name (optional)" maxLength={80} className={NAME_INPUT} />
          </label>
          <label className="block">
            <span className="sr-only">Last name (optional)</span>
            <input name={field('lastName')} placeholder="Last name (optional)" maxLength={80} className={NAME_INPUT} />
          </label>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Make the form's button unconditional**

In `src/app/i/[token]/rsvp-form.tsx`:
1. Delete `const seatsRemaining = invite.seatsAllotted - known.length - companions`.
2. Change the companion row's `note` to `` `(guest ${offset + 1})` ``.
3. Replace the `{seatsRemaining > 0 ? (<button ...>...</button>) : null}` block with:

```tsx
      <button
        type="button"
        onClick={addCompanion}
        className="rounded border border-[var(--color-border)] px-4 py-2 text-sm"
      >
        Bring a guest
      </button>
```

4. Update the component doc comment: replace "a spare seat can be taken by an unnamed companion ("Guest of <host>") with one tap" with "any number of companions can be added with one tap each, named or not".

- [ ] **Step 5: Run the guest e2e spec, typecheck, lint**

Run: `npx playwright test tests/e2e/guest-rsvp.spec.ts && npm run typecheck && npm run lint`
Expected: PASS. Note `'nothing to type: names only'` still passes because it counts textboxes before any companion is added.

- [ ] **Step 6: Commit**

```bash
git add src/components/guest/guest-toggle.tsx "src/app/i/[token]/rsvp-form.tsx" tests/e2e/guest-rsvp.spec.ts
git commit -m "feat: guests bring any number of companions, optionally named"
```

---

### Task 5: Per-guest seat visibility and page data

**Files:**
- Modify: `src/lib/guest/seat-reveal.ts`
- Modify: `src/lib/guest/page-data.ts`
- Test: `tests/unit/seat-reveal.test.ts`
- Test: `tests/integration/guest-page-data.test.ts`
- Test: `tests/integration/seat-release.test.ts`

**Interfaces:**
- Produces (`seat-reveal.ts`):

```ts
export type SeatVisibility =
  | { shown: true }
  | { shown: false; reason: 'NOT_RELEASED' | 'NOT_CONFIRMED' | 'NO_TABLE' }
export function seatVisibility(input: { seatsReleasedAt: Date | null; attending: boolean | null | undefined; table: string | null }): SeatVisibility
export function partySeatVisibility(input: { seatsReleasedAt: Date | null; primaryAttending: boolean | null | undefined; guests: { attending: boolean | null; table: string | null }[] }): SeatVisibility
```

- Produces (`page-data.ts`):

```ts
export type Seat = { guestId: string; name: string; isPrimary: boolean; table: string; marker: TableMarkerRow | null }
export type GuestPageData = { invite: GuestInvite; event: EventDetail; window: RsvpWindow; seats: Seat[]; seat: SeatVisibility }
```

`seats` is empty unless `seat.shown`. Order: primary first, then creation order (the order `invite.guests` already has).

- [ ] **Step 1: Rewrite the unit tests**

Replace `tests/unit/seat-reveal.test.ts` with:

```ts
import { describe, it, expect } from 'vitest'
import { seatVisibility, partySeatVisibility } from '@/lib/guest/seat-reveal'

const RELEASED = new Date('2026-11-01T00:00:00Z')

describe('seatVisibility (one guest)', () => {
  it('shows the seat once seating is released and the guest is coming', () => {
    expect(seatVisibility({ seatsReleasedAt: RELEASED, attending: true, table: '12' })).toEqual({ shown: true })
  })

  it('hides the seat until the organiser releases seating', () => {
    expect(seatVisibility({ seatsReleasedAt: null, attending: true, table: '12' }))
      .toEqual({ shown: false, reason: 'NOT_RELEASED' })
  })

  it('hides the seat until the guest confirms, even after release', () => {
    expect(seatVisibility({ seatsReleasedAt: RELEASED, attending: null, table: '12' }))
      .toEqual({ shown: false, reason: 'NOT_CONFIRMED' })
    expect(seatVisibility({ seatsReleasedAt: RELEASED, attending: false, table: '12' }))
      .toEqual({ shown: false, reason: 'NOT_CONFIRMED' })
  })

  it('asks the guest to confirm before mentioning that seating is unreleased', () => {
    expect(seatVisibility({ seatsReleasedAt: null, attending: null, table: '12' }))
      .toEqual({ shown: false, reason: 'NOT_CONFIRMED' })
  })

  it('has nothing to show for a guest without a table', () => {
    expect(seatVisibility({ seatsReleasedAt: RELEASED, attending: true, table: null }))
      .toEqual({ shown: false, reason: 'NO_TABLE' })
  })
})

describe('partySeatVisibility', () => {
  it('is shown when at least one guest has a showable seat', () => {
    expect(partySeatVisibility({
      seatsReleasedAt: RELEASED, primaryAttending: false,
      guests: [{ attending: false, table: '1' }, { attending: true, table: '7' }],
    })).toEqual({ shown: true })
  })

  it("falls back to the primary guest's reason when nobody is showable", () => {
    expect(partySeatVisibility({
      seatsReleasedAt: RELEASED, primaryAttending: null,
      guests: [{ attending: null, table: '1' }, { attending: true, table: null }],
    })).toEqual({ shown: false, reason: 'NOT_CONFIRMED' })
    expect(partySeatVisibility({
      seatsReleasedAt: null, primaryAttending: true,
      guests: [{ attending: true, table: '1' }],
    })).toEqual({ shown: false, reason: 'NOT_RELEASED' })
  })

  it('reports NO_TABLE for a confirmed, released party with no tables at all', () => {
    expect(partySeatVisibility({
      seatsReleasedAt: RELEASED, primaryAttending: true,
      guests: [{ attending: true, table: null }],
    })).toEqual({ shown: false, reason: 'NO_TABLE' })
  })

  it('treats an empty party (unassigned placeholder) as unconfirmed', () => {
    expect(partySeatVisibility({ seatsReleasedAt: RELEASED, primaryAttending: undefined, guests: [] }))
      .toEqual({ shown: false, reason: 'NOT_CONFIRMED' })
  })
})
```

- [ ] **Step 2: Run to see it fail**

Run: `npx vitest run tests/unit/seat-reveal.test.ts`
Expected: FAIL: `partySeatVisibility` is not exported; `attending` is not the old input name.

- [ ] **Step 3: Implement `seat-reveal.ts`**

Replace the file with:

```ts
export type SeatVisibility =
  | { shown: true }
  | { shown: false; reason: 'NOT_RELEASED' | 'NOT_CONFIRMED' | 'NO_TABLE' }

/**
 * One guest sees their table only once BOTH gates open: the organiser has
 * released seating for everyone, and this guest has confirmed they are
 * coming. Until then the page shows a countdown instead.
 *
 * The order of the reasons matters for the copy the guest reads: an
 * unconfirmed guest is asked to RSVP first, because that is the gate they
 * control. Whether seating is released is not something they can act on.
 */
export function seatVisibility(input: {
  seatsReleasedAt: Date | null
  attending: boolean | null | undefined
  table: string | null
}): SeatVisibility {
  if (input.attending !== true) return { shown: false, reason: 'NOT_CONFIRMED' }
  if (!input.seatsReleasedAt) return { shown: false, reason: 'NOT_RELEASED' }
  if (!input.table) return { shown: false, reason: 'NO_TABLE' }
  return { shown: true }
}

/**
 * The party as a whole: shown as soon as any one guest's seat is showable.
 * When none is, the reason comes from the primary guest, so the pending
 * copy speaks to the person holding the phone.
 */
export function partySeatVisibility(input: {
  seatsReleasedAt: Date | null
  primaryAttending: boolean | null | undefined
  guests: { attending: boolean | null; table: string | null }[]
}): SeatVisibility {
  const anyShown = input.guests.some(
    (guest) => seatVisibility({ seatsReleasedAt: input.seatsReleasedAt, ...guest }).shown,
  )
  if (anyShown) return { shown: true }
  const primaryTable = input.guests.find((guest) => guest.table)?.table ?? null
  return seatVisibility({
    seatsReleasedAt: input.seatsReleasedAt,
    attending: input.primaryAttending,
    table: primaryTable,
  })
}
```

- [ ] **Step 4: Run the unit test**

Run: `npx vitest run tests/unit/seat-reveal.test.ts`
Expected: PASS.

- [ ] **Step 5: Rewrite the page-data integration tests**

In `tests/integration/guest-page-data.test.ts` replace the three table tests (`'resolves the table from the invite ...'`, `"prefers the primary guest's own table ..."`, `'returns a null marker ...'`) with:

```ts
  it('resolves one seat per attending guest, from the invite by default', async () => {
    await seedEvent()
    const { invite, token } = await createInvite(testDb, null, {
      label: 'P', seatsAllotted: 1, tableNumber: '12',
      primaryGuest: { firstName: 'A', lastName: 'B' },
    })
    await confirmParty(invite.id)
    const data = await loadGuestPage(testDb, token, NOW)
    expect(data?.seat).toEqual({ shown: true })
    expect(data?.seats).toEqual([
      expect.objectContaining({ name: 'A B', isPrimary: true, table: '12', marker: expect.objectContaining({ tableNumber: '12', x: 0.4, y: 0.6 }) }),
    ])
  })

  it("uses each guest's own table over the invite's, and lists a split party in order", async () => {
    await seedEvent()
    const { invite, token } = await createInvite(testDb, null, {
      label: 'P', seatsAllotted: 2, tableNumber: '12',
      primaryGuest: { firstName: 'A', lastName: 'B' },
    })
    await testDb.guest.create({ data: { inviteId: invite.id, firstName: 'C', lastName: 'D', attending: true, tableNumber: '3' } })
    await confirmParty(invite.id)
    const data = await loadGuestPage(testDb, token, NOW)
    expect(data?.seats.map((s) => [s.name, s.table])).toEqual([['A B', '12'], ['C D', '3']])
    expect(data?.seats[1]?.marker).toBeNull()
  })

  it('omits a guest who is not coming, and one with no table, from the seats', async () => {
    await seedEvent()
    const { invite, token } = await createInvite(testDb, null, {
      label: 'P', seatsAllotted: 3, primaryGuest: { firstName: 'A', lastName: 'B' },
    })
    await testDb.guest.updateMany({ where: { inviteId: invite.id }, data: { attending: true, tableNumber: '12' } })
    await testDb.guest.create({ data: { inviteId: invite.id, firstName: 'No', lastName: 'Show', attending: false, tableNumber: '12' } })
    await testDb.guest.create({ data: { inviteId: invite.id, firstName: 'No', lastName: 'Table', attending: true } })
    const data = await loadGuestPage(testDb, token, NOW)
    expect(data?.seats.map((s) => s.name)).toEqual(['A B'])
  })
```

In `tests/integration/seat-release.test.ts` replace every `expect(data?.table).toBeNull()` and `expect(data?.marker).toBeNull()` with `expect(data?.seats).toEqual([])`, and in `'shows the table and marker once released AND confirmed'` replace the last two expectations with:

```ts
    expect(data?.seats).toHaveLength(1)
    expect(data?.seats[0]).toMatchObject({ table: '12', marker: expect.objectContaining({ tableNumber: '12' }) })
```

- [ ] **Step 6: Run to see them fail**

Run: `npx vitest run tests/integration/guest-page-data.test.ts tests/integration/seat-release.test.ts`
Expected: FAIL: `seats` is undefined.

- [ ] **Step 7: Implement `page-data.ts`**

Replace the file with:

```ts
import type { PrismaClient } from '@prisma/client'
import { resolveInviteByToken, type GuestInvite, type GuestRow } from './resolve'
import { getEvent, type EventDetail, type TableMarkerRow } from '@/lib/events/repository'
import { rsvpWindow, type RsvpWindow } from './deadline'
import { seatVisibility, partySeatVisibility, type SeatVisibility } from './seat-reveal'

/** One attending guest's table, present only while they are allowed to see it. */
export type Seat = {
  guestId: string
  name: string
  isPrimary: boolean
  table: string
  marker: TableMarkerRow | null
}

export type GuestPageData = {
  invite: GuestInvite
  event: EventDetail
  window: RsvpWindow
  /**
   * The party's showable seats, in party order (primary first). Empty
   * unless `seat.shown`, so the page cannot render a table it was supposed
   * to withhold.
   */
  seats: Seat[]
  seat: SeatVisibility
}

/** Spec §8: a guest's own table overrides the invite's, so a split party sends each person to the right one. */
function resolvedTable(guest: GuestRow, invite: GuestInvite): string | null {
  return guest.tableNumber ?? invite.tableNumber ?? null
}

function toSeat(guest: GuestRow, table: string, markers: TableMarkerRow[]): Seat {
  return {
    guestId: guest.id,
    name: `${guest.firstName} ${guest.lastName}`.trim(),
    isPrimary: guest.isPrimary,
    table,
    marker: markers.find((candidate) => candidate.tableNumber === table) ?? null,
  }
}

/**
 * Everything the guest page renders, in one call.
 *
 * Returns null both for an unknown token and for an unconfigured event: the
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

  const primary = invite.guests.find((guest) => guest.isPrimary) ?? invite.guests[0]
  const perGuest = invite.guests.map((guest) => ({ guest, table: resolvedTable(guest, invite) }))

  const seat = partySeatVisibility({
    seatsReleasedAt: event.seatsReleasedAt,
    primaryAttending: primary?.attending,
    guests: perGuest.map(({ guest, table }) => ({ attending: guest.attending, table })),
  })

  const seats = seat.shown
    ? perGuest
        .filter(({ guest, table }) =>
          seatVisibility({ seatsReleasedAt: event.seatsReleasedAt, attending: guest.attending, table }).shown)
        .map(({ guest, table }) => toSeat(guest, table!, event.tableMarkers))
    : []

  return {
    invite,
    event: { ...event, mealOptions: event.mealOptions.filter((meal) => meal.isActive) },
    window: rsvpWindow(event.rsvpDeadline, now),
    seats,
    seat,
  }
}
```

- [ ] **Step 8: Run the integration tests**

Run: `npx vitest run tests/integration/guest-page-data.test.ts tests/integration/seat-release.test.ts tests/unit/seat-reveal.test.ts`
Expected: PASS. Typecheck will fail in `src/app/i/[token]/page.tsx` (uses `table`/`marker`) until Task 6. That is expected.

- [ ] **Step 9: Commit**

```bash
git add src/lib/guest/seat-reveal.ts src/lib/guest/page-data.ts tests/unit/seat-reveal.test.ts tests/integration/guest-page-data.test.ts tests/integration/seat-release.test.ts
git commit -m "feat: resolve a seat per attending guest behind the release gate"
```

---

### Task 6: Guest page lists every seat and highlights every table

**Files:**
- Modify: `src/components/guest/seat-map.tsx`
- Modify: `src/app/i/[token]/page.tsx`
- Test: `tests/e2e/guest-rsvp.spec.ts`
- Test: `tests/e2e/visual.spec.ts-snapshots/*` (regenerated)

**Interfaces:**
- Consumes: `GuestPageData.seats: Seat[]`, `GuestPageData.seat`.
- Produces: `SeatMap({ floorplanAssetId, seats })` where `seats: Seat[]`. It renders a `<ul data-testid="seat-list">` with one `<li>` per seat reading `"<name> · Table <n>"`, then the floorplan with one marker per distinct table (`aria-label="Table <n>"`, `data-testid="table-marker"` on inline markers). The inline stage's transform origin is the first seat's marker.

- [ ] **Step 1: Update the e2e tests**

In `tests/e2e/guest-rsvp.spec.ts`:

1. Extend `freshInviteToken` options with `companions?: { firstName: string; tableNumber?: string }[]`; after the primary is created add:

```ts
    for (const companion of options.companions ?? []) {
      await prisma.guest.create({
        data: {
          inviteId: created.invite.id,
          firstName: companion.firstName,
          lastName: 'Haddad',
          attending: options.confirmed ? true : null,
          tableNumber: companion.tableNumber ?? null,
        },
      })
    }
```

2. Change `'a confirmed guest sees the table and its marker on the floorplan'` expectations to:

```ts
    await expect(page.getByRole('heading', { name: 'Your seat' })).toBeVisible()
    await expect(page.getByTestId('seat-list').getByRole('listitem')).toHaveCount(1)
    await expect(page.getByTestId('seat-list')).toContainText('Table 12')
    await expect(page.locator('[data-countdown]')).toHaveCount(0)
```

(global-setup places no table markers, so marker counts are asserted in the integration tests, not here.)

3. Add a new test after it:

```ts
  test('a split party sees each guest with their own table and every table marked', async ({ page }, testInfo) => {
    const token = await freshInviteToken(`E2E Split ${testInfo.project.name} ${Date.now()}`, {
      confirmed: true, tableNumber: '12',
      companions: [{ firstName: 'Sam', tableNumber: '7' }, { firstName: 'Ola' }],
    })
    await page.goto(`/i/${token}`)
    await expect(page.getByRole('heading', { name: 'Your seats' })).toBeVisible()
    const items = page.getByTestId('seat-list').getByRole('listitem')
    await expect(items).toHaveCount(3)
    await expect(items.nth(0)).toContainText('Noor Haddad')
    await expect(items.nth(0)).toContainText('Table 12')
    await expect(items.nth(1)).toContainText('Sam Haddad')
    await expect(items.nth(1)).toContainText('Table 7')
    await expect(items.nth(2)).toContainText('Table 12')
  })
```

- [ ] **Step 2: Run to see it fail**

Run: `npx playwright test tests/e2e/guest-rsvp.spec.ts -g "split party|marker on the floorplan"`
Expected: FAIL: no `seat-list`.

- [ ] **Step 3: Rewrite `SeatMap`**

Replace `src/components/guest/seat-map.tsx` with:

```tsx
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
```

- [ ] **Step 4: Update the guest page**

In `src/app/i/[token]/page.tsx`:
1. Change the destructure to `const { invite, event, window, seats, seat } = data`.
2. Replace the seat branch:

```tsx
          {seat.shown && seats.length > 0 ? (
            <SeatAct>
              <section aria-labelledby="seat" className="relative z-10 space-y-4 pl-12">
                <h2 id="seat" className="font-serif text-3xl">{seats.length > 1 ? 'Your seats' : 'Your seat'}</h2>
                <SeatMap floorplanAssetId={event.floorplanAssetId} seats={seats} />
              </section>
            </SeatAct>
          ) : (
```

The pending branch is unchanged.

- [ ] **Step 5: Run guest e2e, typecheck, lint**

Run: `npx playwright test tests/e2e/guest-rsvp.spec.ts && npm run typecheck && npm run lint`
Expected: PASS. If `'the floorplan opens full screen'` fails on `toBeFocused`, nothing in this task changed the viewer; re-run once before investigating.

- [ ] **Step 6: Regenerate the guest visual baselines and check them**

Run: `npx playwright test tests/e2e/visual.spec.ts --update-snapshots`
Then open `tests/e2e/visual.spec.ts-snapshots/guest-1440-light-desktop-win32.png` with the Read tool and confirm the seat section shows "Riley Chen · Table 12" above the plan.
Run: `npx playwright test tests/e2e/visual.spec.ts` — Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/components/guest/seat-map.tsx "src/app/i/[token]/page.tsx" tests/e2e/guest-rsvp.spec.ts tests/e2e/visual.spec.ts-snapshots
git commit -m "feat: guest page lists a table per guest and marks every table"
```

---

### Task 7: Check-in shows the table beside each guest

**Files:**
- Modify: `src/lib/checkin/repository.ts:36-85`
- Modify: `src/app/admin/checkin/party-card.tsx`
- Test: `tests/integration/checkin.test.ts`
- Test: `tests/e2e/checkin.spec.ts:28,78-86`

**Interfaces:**
- Produces: `PartyGuest.tableNumber` is the RESOLVED table (guest's own, else the invite's). `Party` loses `tableNumber`.
- Consumes: nothing new. `/api/admin/checkin/resolve` returns `Party` as JSON unchanged in shape apart from that removal.

- [ ] **Step 1: Update the integration test**

In `tests/integration/checkin.test.ts` `seed()`, give Sam a table: `data: { inviteId: invite.id, firstName: 'Sam', lastName: 'Reyes', attending: true, tableNumber: '3' }`. Replace `'returns the party with check-in state'` with:

```ts
  it('returns the party with check-in state and a table per guest', async () => {
    const { token } = await seed()
    const party = await resolvePartyByToken(testDb, token)
    expect(party?.label).toBe('Reyes Party')
    expect(party).not.toHaveProperty('tableNumber')
    expect(party?.guests.map((g) => [g.firstName, g.tableNumber])).toEqual([['Jordan', '12'], ['Sam', '3']])
    expect(party?.guests.every((g) => g.checkedInAt === null)).toBe(true)
  })
```

- [ ] **Step 2: Run to see it fail**

Run: `npx vitest run tests/integration/checkin.test.ts`
Expected: FAIL: `party.tableNumber` is present and Jordan's `tableNumber` is `null`.

- [ ] **Step 3: Resolve per guest in the repository**

In `src/lib/checkin/repository.ts`:
1. Delete `tableNumber: string | null` from `Party`.
2. Replace the end of `resolvePartyByToken`:

```ts
  if (!invite) return null
  // Spec §8: a guest's own table overrides the invite's, so the door sends
  // each person of a split party to the right table.
  const guests = invite.guests.map((guest) => ({ ...guest, tableNumber: guest.tableNumber ?? invite.tableNumber }))
  return { inviteId: invite.id, label: invite.label, guests }
```

- [ ] **Step 4: Party card**

In `src/app/admin/checkin/party-card.tsx`:
1. Heading becomes `<h2 id="party-heading" className="font-serif text-2xl">{party.label}</h2>`.
2. Inside the name `<span>` block, after the company line add:

```tsx
                  {guest.tableNumber ? (
                    <span className="block text-sm text-[var(--accent-ink)]">Table {guest.tableNumber}</span>
                  ) : null}
```

- [ ] **Step 5: Update the e2e spec**

In `tests/e2e/checkin.spec.ts`: change `ResolvedGuest` to `{ id: string; firstName: string; tableNumber: string | null; checkedInAt: string | null }` and drop `tableNumber` from `ResolvedParty`. In the test at line 78 replace the two table lines:

```ts
    expect(party.guests.map((g) => g.tableNumber)).toEqual(['7', '7', '7'])
    ...
    await expect(guestRow(page, 'Morgan')).toContainText('Table 7')
```

(Keep the heading and Dana assertions.)

- [ ] **Step 6: Run tests**

Run: `npx vitest run tests/integration/checkin.test.ts && npx playwright test tests/e2e/checkin.spec.ts && npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/checkin/repository.ts src/app/admin/checkin/party-card.tsx tests/integration/checkin.test.ts tests/e2e/checkin.spec.ts
git commit -m "feat: check-in card shows each guest's own table"
```

---

### Task 8: CSV parse flags duplicate labels; import planner classifies rows

**Files:**
- Modify: `src/lib/invites/csv.ts`
- Create: `src/lib/invites/import-plan.ts`
- Modify: `src/lib/invites/import.ts`
- Test: `tests/unit/csv.test.ts`
- Test: `tests/integration/csv-import.test.ts`

**Interfaces:**
- Produces (`csv.ts`): a second occurrence of a label (trimmed, case-sensitive) in one file adds the error `duplicate label in file` to that row.
- Produces (`import-plan.ts`):

```ts
export type ImportAction =
  | { action: 'create' }
  | { action: 'update'; inviteId: string; primaryGuestId: string | null }
  | { action: 'skip'; reason: 'label matches several invites' | 'email already exists' }
export type PlannedRow = { row: ImportRow; plan: ImportAction }
export async function planImport(db: AuditClient, rows: ImportRow[]): Promise<PlannedRow[]>
```

`AuditClient` is the `PrismaClient | Prisma.TransactionClient` union already exported from `src/lib/audit.ts`.
- Produces (`import.ts`): `ImportResult = { created: number; updated: number; skipped: { label: string; reason: string }[] }`. `existingEmails` stays exported.

- [ ] **Step 1: Unit test for duplicate labels**

In `tests/unit/csv.test.ts` add inside `describe('parseInviteCsv')`:

```ts
  it('flags a label that repeats within the file, keeping the first', () => {
    const csv = `${HEADER}\n002,1,,Ada,Okafor,,,,\n002,1,,Sam,Reyes,,,,\n003,1,,Mira,L,,,,`
    const { rows } = parseInviteCsv(csv)
    expect(rows[0]?.errors).toEqual([])
    expect(rows[1]?.errors).toEqual(['duplicate label in file'])
    expect(rows[1]?.data).toBeNull()
    expect(rows[2]?.errors).toEqual([])
  })
```

Run: `npx vitest run tests/unit/csv.test.ts` — Expected: FAIL (row 1 has no errors).

- [ ] **Step 2: Implement in `csv.ts`**

Change `validateRow`'s signature to `(raw, rowNumber, seenEmails: Set<string>, seenLabels: Set<string>)`. After `if (!label) errors.push('label is required')` add:

```ts
  if (label && seenLabels.has(label)) {
    errors.push('duplicate label in file')
  } else if (label) {
    seenLabels.add(label)
  }
```

In `parseInviteCsv` add `const seenLabels = new Set<string>()` beside `seenEmails` and pass it: `validateRow(toRecord(headers, row.fields), row.line, seenEmails, seenLabels)`.

Run: `npx vitest run tests/unit/csv.test.ts` — Expected: PASS.

- [ ] **Step 3: Integration tests for the planner and commit**

Replace the whole `describe('commitInviteImport', ...)` in `tests/integration/csv-import.test.ts` with:

```ts
import { createPlaceholderInvites } from '@/lib/invites/placeholders'
import { planImport } from '@/lib/invites/import-plan'
import { createInvite } from '@/lib/invites/repository'

describe('planImport', () => {
  it('creates when nothing matches', async () => {
    const [plan] = await planImport(testDb, rowsFrom(`${HEADER}\nNew Party,1,,Ada,Okafor,,,,`))
    expect(plan?.plan).toEqual({ action: 'create' })
  })

  it('updates the single invite whose label matches', async () => {
    const { invite } = await createInvite(testDb, null, {
      label: 'Reyes Party', seatsAllotted: 1, primaryGuest: { firstName: 'J', lastName: 'R' },
    })
    const primary = await testDb.guest.findFirstOrThrow({ where: { inviteId: invite.id } })
    const [plan] = await planImport(testDb, rowsFrom(`${HEADER}\nReyes Party,2,,Jordan,Reyes,,,,`))
    expect(plan?.plan).toEqual({ action: 'update', inviteId: invite.id, primaryGuestId: primary.id })
  })

  it('falls back to the printed number when the label is a bare integer', async () => {
    await createPlaceholderInvites(testDb, null, { count: 3, seatsAllotted: 1 })
    await testDb.invite.update({ where: { number: 2 }, data: { label: 'Already Renamed' } })
    const [plan] = await planImport(testDb, rowsFrom(`${HEADER}\n2,1,,Ada,Okafor,,,,`))
    const two = await testDb.invite.findUniqueOrThrow({ where: { number: 2 } })
    expect(plan?.plan).toEqual({ action: 'update', inviteId: two.id, primaryGuestId: null })
  })

  it('prefers an exact label match over the number fallback', async () => {
    await createPlaceholderInvites(testDb, null, { count: 3, seatsAllotted: 1 })
    await testDb.invite.update({ where: { number: 3 }, data: { label: '002' } })
    const [plan] = await planImport(testDb, rowsFrom(`${HEADER}\n002,1,,Ada,Okafor,,,,`))
    const three = await testDb.invite.findUniqueOrThrow({ where: { number: 3 } })
    expect(plan?.plan).toMatchObject({ action: 'update', inviteId: three.id })
  })

  it('skips a label shared by several invites', async () => {
    for (let i = 0; i < 2; i++) {
      await createInvite(testDb, null, { label: 'Twins', seatsAllotted: 1, primaryGuest: { firstName: 'A', lastName: String(i) } })
    }
    const [plan] = await planImport(testDb, rowsFrom(`${HEADER}\nTwins,1,,Ada,Okafor,,,,`))
    expect(plan?.plan).toEqual({ action: 'skip', reason: 'label matches several invites' })
  })

  it('skips a create whose email already exists, but not an update carrying its own email', async () => {
    await createInvite(testDb, null, {
      label: 'Reyes Party', seatsAllotted: 1,
      primaryGuest: { firstName: 'J', lastName: 'R', email: 'jordan@example.com' },
    })
    const plans = await planImport(testDb, rowsFrom(
      `${HEADER}\nReyes Party,1,,Jordan,Reyes,jordan@example.com,,,\nOther,1,,Dup,Licate,jordan@example.com,,,`,
    ))
    expect(plans[0]?.plan).toMatchObject({ action: 'update' })
    expect(plans[1]?.plan).toEqual({ action: 'skip', reason: 'email already exists' })
  })
})

describe('commitInviteImport', () => {
  it('creates one invite and one primary guest per unmatched row', async () => {
    const rows = rowsFrom(`${HEADER}\nA Party,2,,Ada,Okafor,ada@example.com,,,\nB Party,1,,Sam,Reyes,,,,`)
    const result = await commitInviteImport(testDb, null, rows)
    expect(result).toEqual({ created: 2, updated: 0, skipped: [] })
    expect(await testDb.invite.count()).toBe(2)
    expect(await testDb.guest.count({ where: { isPrimary: true } })).toBe(2)
  })

  it('fills in a placeholder run by label, keeping every token and number', async () => {
    await createPlaceholderInvites(testDb, null, { count: 3, seatsAllotted: 1 })
    const before = await listInviteTokens(testDb)

    const result = await commitInviteImport(testDb, null, rowsFrom(
      `${HEADER}\n001,2,12,Ada,Okafor,ada@example.com,Acme,CEO,VIP\n003,1,,Sam,Reyes,,,,`,
    ))

    expect(result).toEqual({ created: 0, updated: 2, skipped: [] })
    expect(await testDb.invite.count()).toBe(3)
    const after = await listInviteTokens(testDb)
    expect(after.map((r) => r.token)).toEqual(before.map((r) => r.token))
    expect(after.map((r) => r.number)).toEqual([1, 2, 3])

    const one = await testDb.invite.findUniqueOrThrow({ where: { number: 1 }, include: { guests: true } })
    expect(one).toMatchObject({ label: '001', seatsAllotted: 2, tableNumber: '12', adminNotes: 'VIP' })
    expect(one.guests).toHaveLength(1)
    expect(one.guests[0]).toMatchObject({ firstName: 'Ada', lastName: 'Okafor', email: 'ada@example.com', company: 'Acme', title: 'CEO', isPrimary: true })
    const two = await testDb.invite.findUniqueOrThrow({ where: { number: 2 }, include: { guests: true } })
    expect(two.guests).toHaveLength(0)
  })

  it('updates an existing primary guest in place and leaves the rest of the party alone', async () => {
    const { invite } = await createInvite(testDb, null, {
      label: 'Reyes Party', seatsAllotted: 2, tableNumber: '4',
      primaryGuest: { firstName: 'J', lastName: 'R', email: 'old@example.com' },
    })
    const sam = await testDb.guest.create({ data: { inviteId: invite.id, firstName: 'Sam', lastName: 'Reyes', attending: true, checkedInAt: new Date() } })
    await testDb.guest.updateMany({ where: { inviteId: invite.id, isPrimary: true }, data: { attending: true } })
    await testDb.invite.update({ where: { id: invite.id }, data: { status: 'ATTENDING', respondedAt: new Date('2026-09-01T00:00:00Z') } })

    await commitInviteImport(testDb, null, rowsFrom(`${HEADER}\nReyes Party,3,,Jordan,Reyes,new@example.com,Northwind,,`))

    const fresh = await testDb.invite.findUniqueOrThrow({ where: { id: invite.id }, include: { guests: { orderBy: { isPrimary: 'desc' } } } })
    expect(fresh).toMatchObject({ seatsAllotted: 3, tableNumber: null, status: 'ATTENDING' })
    expect(fresh.respondedAt?.toISOString()).toBe('2026-09-01T00:00:00.000Z')
    expect(fresh.guests).toHaveLength(2)
    expect(fresh.guests[0]).toMatchObject({ firstName: 'Jordan', email: 'new@example.com', company: 'Northwind', attending: true, isPrimary: true })
    expect(fresh.guests[1]?.id).toBe(sam.id)
    expect(fresh.guests[1]?.checkedInAt).not.toBeNull()
  })

  it('renames an invite matched by number', async () => {
    await createPlaceholderInvites(testDb, null, { count: 1, seatsAllotted: 1 })
    await testDb.invite.update({ where: { number: 1 }, data: { label: 'Old Name' } })
    await commitInviteImport(testDb, null, rowsFrom(`${HEADER}\n1,1,,Ada,Okafor,,,,`))
    expect((await testDb.invite.findUniqueOrThrow({ where: { number: 1 } })).label).toBe('1')
  })

  it('reports skipped rows with their reason and still commits the rest', async () => {
    await createInvite(testDb, null, { label: 'A', seatsAllotted: 1, primaryGuest: { firstName: 'A', lastName: 'A', email: 'a@example.com' } })
    const result = await commitInviteImport(testDb, null, rowsFrom(
      `${HEADER}\nDuplicate,1,,Ada,Okafor,a@example.com,,,\nNew,1,,Sam,Reyes,sam@example.com,,,`,
    ))
    expect(result).toEqual({ created: 1, updated: 0, skipped: [{ label: 'Duplicate', reason: 'email already exists' }] })
    expect(await testDb.invite.count()).toBe(2)
  })

  it('gives every created invite a distinct, recoverable token', async () => {
    await commitInviteImport(testDb, null, rowsFrom(`${HEADER}\nA,1,,Ada,Okafor,,,,\nB,1,,Sam,Reyes,,,,`))
    const tokens = await listInviteTokens(testDb)
    expect(new Set(tokens.map((t) => t.token)).size).toBe(2)
    expect(tokens.every((t) => /^[A-Za-z0-9_-]{32}$/.test(t.token))).toBe(true)
  })

  it('rolls back entirely when any write fails', async () => {
    const rows = rowsFrom(`${HEADER}\nA,1,,Ada,Okafor,,,,`)
    const bad = [...rows, { ...rows[0]!, label: 'B', seatsAllotted: 'not-a-number' as unknown as number }]
    await expect(commitInviteImport(testDb, null, bad)).rejects.toThrow()
    expect(await testDb.invite.count()).toBe(0)
  })

  it('writes a single audit row with all three counts', async () => {
    await createPlaceholderInvites(testDb, null, { count: 1, seatsAllotted: 1 })
    await commitInviteImport(testDb, null, rowsFrom(`${HEADER}\n001,1,,Ada,Okafor,,,,\nB,1,,Sam,Reyes,,,,`))
    const logs = await testDb.auditLog.findMany({ where: { action: 'invite.import' } })
    expect(logs).toHaveLength(1)
    expect(logs[0]?.meta).toMatchObject({ created: 1, updated: 1, skipped: 0 })
  })

  it('accepts an empty row list without writing anything', async () => {
    expect(await commitInviteImport(testDb, null, [])).toEqual({ created: 0, updated: 0, skipped: [] })
    expect(await testDb.auditLog.count()).toBe(0)
  })

  it('rejects more rows than the cap', async () => {
    const one = rowsFrom(`${HEADER}\nA,1,,Ada,Okafor,,,,`)[0]!
    const tooMany = Array.from({ length: MAX_IMPORT_ROWS + 1 }, () => one)
    await expect(commitInviteImport(testDb, null, tooMany)).rejects.toThrow(/at most/i)
  })

  it('reports which emails already exist', async () => {
    await commitInviteImport(testDb, null, rowsFrom(`${HEADER}\nA,1,,Ada,Okafor,ada@example.com,,,`))
    const found = await existingEmails(testDb, ['ada@example.com', 'nobody@example.com'])
    expect([...found]).toEqual(['ada@example.com'])
  })
})
```

Move the three new `import` lines to the top of the file with the others.

Run: `npx vitest run tests/integration/csv-import.test.ts` — Expected: FAIL (module `import-plan` missing).

- [ ] **Step 4: Create `src/lib/invites/import-plan.ts`**

```ts
import type { AuditClient } from '@/lib/audit'
import type { ImportRow } from './csv'

export type SkipReason = 'label matches several invites' | 'email already exists'

export type ImportAction =
  | { action: 'create' }
  | { action: 'update'; inviteId: string; primaryGuestId: string | null }
  | { action: 'skip'; reason: SkipReason }

export type PlannedRow = { row: ImportRow; plan: ImportAction }

type Candidate = { id: string; number: number; label: string; primaryGuestId: string | null }

/** "002" and "2" both name invite number 2; anything else is not a number. */
function bareNumber(label: string): number | null {
  return /^\d{1,9}$/.test(label) ? Number(label) : null
}

async function loadCandidates(db: AuditClient, rows: ImportRow[]): Promise<Candidate[]> {
  const labels = rows.map((row) => row.label)
  const numbers = labels.map(bareNumber).filter((n): n is number => n !== null)
  const found = await db.invite.findMany({
    where: { OR: [{ label: { in: labels } }, ...(numbers.length ? [{ number: { in: numbers } }] : [])] },
    select: {
      id: true, number: true, label: true,
      guests: { where: { isPrimary: true }, select: { id: true }, take: 1 },
    },
  })
  return found.map((invite) => ({
    id: invite.id, number: invite.number, label: invite.label,
    primaryGuestId: invite.guests[0]?.id ?? null,
  }))
}

async function emailsInUse(db: AuditClient, rows: ImportRow[]): Promise<Set<string>> {
  const wanted = rows.map((row) => row.primaryGuest.email.toLowerCase()).filter(Boolean)
  if (wanted.length === 0) return new Set()
  const found = await db.guest.findMany({ where: { email: { in: wanted } }, select: { email: true } })
  return new Set(found.map((guest) => guest.email!.toLowerCase()))
}

/**
 * Decides, per row, whether the import creates, updates or skips.
 *
 * The key is the row's label. Exactly one invite with that label: update
 * it. Several: skip, never guess. None, and the label is a bare number:
 * update the invite printed with that number (so a spreadsheet keyed on
 * the card numbers fills in a placeholder run, and still matches after the
 * organiser renames 002 to "Reyes Party"). Otherwise create, unless the
 * primary email is already in use, which is the existing dedupe rule and
 * applies to creates only.
 *
 * Runs against whatever client it is given so `commitInviteImport` can
 * call it inside its transaction and a concurrent edit cannot slip between
 * preview and commit.
 */
export async function planImport(db: AuditClient, rows: ImportRow[]): Promise<PlannedRow[]> {
  if (rows.length === 0) return []
  const [candidates, taken] = await Promise.all([loadCandidates(db, rows), emailsInUse(db, rows)])

  return rows.map((row) => {
    const byLabel = candidates.filter((c) => c.label === row.label)
    if (byLabel.length > 1) return { row, plan: { action: 'skip', reason: 'label matches several invites' } }
    const match = byLabel[0] ?? candidates.find((c) => c.number === bareNumber(row.label))
    if (match) return { row, plan: { action: 'update', inviteId: match.id, primaryGuestId: match.primaryGuestId } }

    const email = row.primaryGuest.email.toLowerCase()
    if (email && taken.has(email)) return { row, plan: { action: 'skip', reason: 'email already exists' } }
    return { row, plan: { action: 'create' } }
  })
}
```

- [ ] **Step 5: Rewrite `src/lib/invites/import.ts`**

```ts
import type { PrismaClient, Prisma } from '@prisma/client'
import { generateInviteToken, hashToken } from '@/lib/crypto/tokens'
import { seal } from '@/lib/crypto/secret-box'
import { getEnv } from '@/lib/env'
import { writeAudit } from '@/lib/audit'
import { allocateInviteNumbers } from './repository'
import { planImport, type PlannedRow } from './import-plan'
import type { ImportRow } from './csv'

export const MAX_IMPORT_ROWS = 2000

export type ImportResult = {
  created: number
  updated: number
  skipped: { label: string; reason: string }[]
}

export async function existingEmails(db: PrismaClient, emails: string[]): Promise<Set<string>> {
  const wanted = emails.filter(Boolean).map((e) => e.toLowerCase())
  if (wanted.length === 0) return new Set()
  const found = await db.guest.findMany({ where: { email: { in: wanted } }, select: { email: true } })
  return new Set(found.map((g) => g.email!.toLowerCase()))
}

function inviteFields(row: ImportRow) {
  return {
    label: row.label,
    seatsAllotted: row.seatsAllotted,
    tableNumber: row.tableNumber || null,
    adminNotes: row.adminNotes || null,
  }
}

function guestFields(row: ImportRow) {
  return {
    firstName: row.primaryGuest.firstName,
    lastName: row.primaryGuest.lastName,
    email: row.primaryGuest.email || null,
    company: row.primaryGuest.company || null,
    title: row.primaryGuest.title || null,
  }
}

async function createFromRow(tx: Prisma.TransactionClient, row: ImportRow, number: number, secret: string): Promise<void> {
  const token = generateInviteToken()
  await tx.invite.create({
    data: {
      tokenHash: hashToken(token),
      tokenCipher: seal(token, secret),
      number,
      ...inviteFields(row),
      guests: { create: { ...guestFields(row), isPrimary: true } },
    },
  })
}

/**
 * Token, number, status, respondedAt and every other guest are untouched:
 * this is the organiser filling in who holds a printed card, not a reset.
 */
async function updateFromRow(
  tx: Prisma.TransactionClient, row: ImportRow, inviteId: string, primaryGuestId: string | null,
): Promise<void> {
  await tx.invite.update({ where: { id: inviteId }, data: inviteFields(row) })
  if (primaryGuestId) {
    await tx.guest.update({ where: { id: primaryGuestId }, data: guestFields(row) })
  } else {
    await tx.guest.create({ data: { inviteId, ...guestFields(row), isPrimary: true } })
  }
}

function summarise(planned: PlannedRow[]): ImportResult {
  return {
    created: planned.filter((p) => p.plan.action === 'create').length,
    updated: planned.filter((p) => p.plan.action === 'update').length,
    skipped: planned.flatMap((p) => (p.plan.action === 'skip' ? [{ label: p.row.label, reason: p.plan.reason }] : [])),
  }
}

/**
 * Commits an entire import in one transaction: creates and updates
 * together, planned inside the transaction so the label and number lookups
 * see the same snapshot the writes do. Skipped rows are reported, never
 * fatal: re-importing a corrected spreadsheet is a normal operation.
 */
export async function commitInviteImport(
  db: PrismaClient,
  actorId: string | null,
  rows: ImportRow[],
): Promise<ImportResult> {
  if (rows.length === 0) return { created: 0, updated: 0, skipped: [] }
  if (rows.length > MAX_IMPORT_ROWS) {
    throw new Error(`Import accepts at most ${MAX_IMPORT_ROWS} rows per file`)
  }

  const secret = getEnv().SESSION_SECRET

  return db.$transaction(
    async (tx) => {
      const planned = await planImport(tx, rows)
      const creates = planned.filter((p) => p.plan.action === 'create')
      const numbers = await allocateInviteNumbers(tx, creates.length)

      let nextNumber = 0
      for (const { row, plan } of planned) {
        if (plan.action === 'create') await createFromRow(tx, row, numbers[nextNumber++]!, secret)
        else if (plan.action === 'update') await updateFromRow(tx, row, plan.inviteId, plan.primaryGuestId)
      }

      const result = summarise(planned)
      await writeAudit(tx, {
        actorId,
        action: 'invite.import',
        entity: 'Invite',
        meta: { created: result.created, updated: result.updated, skipped: result.skipped.length },
      })
      return result
    },
    { timeout: 120_000 },
  )
}
```

- [ ] **Step 6: Run the tests**

Run: `npx vitest run tests/unit/csv.test.ts tests/integration/csv-import.test.ts && npm run typecheck`
Expected: PASS for the test files. Typecheck fails in `src/app/admin/invites/import/actions.ts` on `skippedExistingEmails`; Task 9 fixes it.

- [ ] **Step 7: Commit**

```bash
git add src/lib/invites/csv.ts src/lib/invites/import-plan.ts src/lib/invites/import.ts tests/unit/csv.test.ts tests/integration/csv-import.test.ts
git commit -m "feat: CSV import updates invites matched by label or printed number"
```

---

### Task 9: Import UI previews the action per row and reports the result

**Files:**
- Modify: `src/app/admin/invites/import/actions.ts`
- Modify: `src/app/admin/invites/import/import-form.tsx`
- Modify: `src/app/admin/invites/import/page.tsx`
- Modify: `src/app/admin/invites/page.tsx` (banner)
- Test: `tests/e2e/csv-import.spec.ts`

**Interfaces:**
- Consumes: `planImport`, `ImportResult`.
- Produces: `PreviewState = { headerErrors: string[]; rows: ParsedRow[]; actions: Record<number, 'create' | 'update' | 'skip'>; skipReasons: Record<number, string>; payload: string } | null` keyed by `rowNumber`.
- Produces: commit redirects to `/admin/invites?imported=<created>&updated=<updated>&skipped=<n>`.

- [ ] **Step 1: E2E test**

In `tests/e2e/csv-import.spec.ts` add these imports at the top of the file:

```ts
import { PrismaClient } from '@prisma/client'
import { createPlaceholderInvites } from '../../src/lib/invites/placeholders'
import { listInviteTokens } from '../../src/lib/invites/repository'
import { E2E_DATABASE_URL } from '../../playwright.config'
```

and this test inside `test.describe('CSV import', ...)`:

```ts
  test('fills in printed placeholders by label without changing their codes', async ({ page }) => {
    const prisma = new PrismaClient({ datasources: { db: { url: E2E_DATABASE_URL } } })
    let label: string
    let tokenBefore: string
    try {
      const { lastNumber } = await createPlaceholderInvites(prisma, null, { count: 1, seatsAllotted: 1 })
      const [row] = await listInviteTokens(prisma, { number: lastNumber })
      label = row!.label
      tokenBefore = row!.token
    } finally {
      await prisma.$disconnect()
    }

    await signIn(page)
    await page.goto('/admin/invites/import')
    const stamp = Date.now()
    await upload(page, `${HEADER}\n${label},2,,Priya,Natarajan,priya${stamp}@example.com,,,`)

    await expect(page.getByText('1 row ready to import')).toBeVisible()
    await expect(page.getByText(/1 will update an existing invite/)).toBeVisible()
    await page.getByRole('button', { name: 'Import 1 invite' }).click()
    await expect(page).toHaveURL(/updated=1/)

    const after = new PrismaClient({ datasources: { db: { url: E2E_DATABASE_URL } } })
    try {
      const [row] = await listInviteTokens(after, { label })
      expect(row?.token).toBe(tokenBefore)
      const guests = await after.guest.findMany({ where: { inviteId: row!.id } })
      expect(guests.map((g) => g.firstName)).toEqual(['Priya'])
    } finally {
      await after.$disconnect()
    }
  })
```

Run: `npx playwright test tests/e2e/csv-import.spec.ts -g placeholders` — Expected: FAIL (no "will update" text; typecheck error in actions).

- [ ] **Step 2: Actions**

In `src/app/admin/invites/import/actions.ts`:
1. Add `import { planImport } from '@/lib/invites/import-plan'`.
2. Replace `PreviewState`:

```ts
export type PreviewState = {
  headerErrors: string[]
  rows: ParsedRow[]
  /** Per rowNumber: what the commit will do with a valid row. */
  actions: Record<number, 'create' | 'update' | 'skip'>
  skipReasons: Record<number, string>
  payload: string
} | null
```

3. In `validateCsvAction` every early return gets `actions: {}, skipReasons: {},`. Replace the final two lines with:

```ts
  const validRows = rows.filter((r) => r.data)
  const planned = await planImport(prisma, validRows.map((r) => r.data!))
  const actions: Record<number, 'create' | 'update' | 'skip'> = {}
  const skipReasons: Record<number, string> = {}
  planned.forEach(({ plan }, i) => {
    const rowNumber = validRows[i]!.rowNumber
    actions[rowNumber] = plan.action
    if (plan.action === 'skip') skipReasons[rowNumber] = plan.reason
  })
  return { headerErrors, rows, actions, skipReasons, payload: JSON.stringify(validRows.map((r) => r.data)) }
```

4. In `commitCsvAction` the redirect becomes `` redirect(`/admin/invites?imported=${result.created}&updated=${result.updated}&skipped=${result.skipped.length}`) ``.

- [ ] **Step 3: Form**

In `import-form.tsx` after `const errorRows = ...` add:

```tsx
  const count = (action: 'create' | 'update' | 'skip') =>
    Object.values(state?.actions ?? {}).filter((a) => a === action).length
  const skipRows = Object.entries(state?.skipReasons ?? {})
```

Replace the `<p className="text-sm">…ready to import…</p>` with:

```tsx
          <p className="text-sm">
            {readyCount} row{readyCount === 1 ? '' : 's'} ready to import
            {count('update') ? `: ${count('update')} will update an existing invite, ${count('create')} will create a new one` : ''}
            {errorRows.length ? `. ${errorRows.length} with errors (they will be skipped)` : ''}
          </p>
          {skipRows.length ? (
            <ul className="space-y-1 text-sm text-[var(--color-text-muted)]">
              {skipRows.map(([rowNumber, reason]) => (
                <li key={rowNumber}>Row {rowNumber}: will be skipped, {reason}</li>
              ))}
            </ul>
          ) : null}
```

- [ ] **Step 4: Import page copy**

In `import/page.tsx` after the required-columns paragraph add:

```tsx
        <p className="mb-2 text-[var(--color-text-muted)]">
          A row whose <code>label</code> matches an existing invite updates it in place and keeps its QR
          code. A bare number like <code>002</code> matches the card printed with that number. Anything
          else creates a new invite.
        </p>
```

- [ ] **Step 5: Invites list banner**

In `src/app/admin/invites/page.tsx` find where `params` is read (line 27). Add after it:

```tsx
  const imported = Number(params.imported ?? 0)
  const updated = Number(params.updated ?? 0)
  const skipped = Number(params.skipped ?? 0)
  const importSummary = imported || updated || skipped
    ? `Import finished: ${imported} created, ${updated} updated, ${skipped} skipped.`
    : null
```

Render `{importSummary ? <p role="status" className="rounded border border-[var(--color-accent)] px-3 py-2 text-sm">{importSummary}</p> : null}` directly under the page's `<h1>`. If the page already renders an `imported` banner, replace it with this one.

- [ ] **Step 6: Run the e2e spec, typecheck, lint**

Run: `npx playwright test tests/e2e/csv-import.spec.ts && npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/app/admin/invites/import/actions.ts src/app/admin/invites/import/import-form.tsx src/app/admin/invites/import/page.tsx src/app/admin/invites/page.tsx tests/e2e/csv-import.spec.ts
git commit -m "feat: import preview shows create/update per row and reports the result"
```

---

### Task 10: Seed, docs, and full verification

**Files:**
- Modify: `prisma/seed.ts` (only if it references removed fields; `grep -n extraSeats prisma/seed.ts` must be empty)
- Modify: `docs/DEPLOY.md` (add one paragraph under the import/runbook section)
- Test: whole suite

- [ ] **Step 1: Docs**

In `docs/DEPLOY.md`, in the section that describes running the CSV import (search for "import"), add:

```markdown
Re-importing the spreadsheet is safe. A row whose `label` matches an
existing invite (or whose label is the bare card number, like `002`)
updates that invite and its primary guest in place; the QR code printed on
the card keeps working. Rows that match nothing create new invites.
```

- [ ] **Step 2: Repo-wide grep**

Run: `grep -rn "extraSeats\|SeatLimitError\|GuestLimitError\|SEAT_LIMIT\|seatsRemaining\|skippedExistingEmails\|pendingExtraSeats" src tests prisma scripts docs/DEPLOY.md`
Expected: nothing.

- [ ] **Step 3: Full verification**

```bash
npm run typecheck && npm run lint && npm test && npx playwright test
```

Expected: all green. Report exact counts in the final message.

- [ ] **Step 4: Commit**

```bash
git add docs/DEPLOY.md prisma/seed.ts
git commit -m "docs: CSV re-import updates invites in place"
```

---

## Self-review notes

- Spec §1: Tasks 1, 2, 3, 4. `seatsAllotted` unenforced: Task 2 (updateInvite), Task 3 (addGuest), Task 1 (submitRsvp). Guest page "no longer mentions" seats: Task 4 removes the only mention (the remaining-seats button label).
- Spec §2: Tasks 3, 5, 6, 7. Guest CSV export: unchanged, verified by existing `tests/integration/guests.test.ts`.
- Spec §3: Tasks 8, 9, 10. Label-in-file duplicates: Task 8 Step 2. Ambiguous DB label: Task 8 planner. Number fallback and rename-on-update: Task 8 tests. Transaction-scoped planning: `commitInviteImport` calls `planImport(tx, …)`.
- Type consistency: `Seat` defined in Task 5, consumed by Task 6's `SeatMap`. `PartyGuest.tableNumber` already existed; Task 7 changes its meaning to resolved. `ImportResult.skipped` shape `{ label, reason }[]` used in Task 8 tests and Task 9 redirect. `PreviewState.actions` keyed by `rowNumber` in both Task 9 action and form.

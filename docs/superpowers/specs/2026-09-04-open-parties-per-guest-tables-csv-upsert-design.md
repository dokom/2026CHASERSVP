# Open parties, per-guest tables, CSV upsert by label

Date: 2026-09-04. Extends the 2026-08-21 portal design. Builds on the
uncommitted numbered-placeholder work (Invite.number, printed QR run).

## Why

The organiser prints 400 numbered QR cards before knowing who holds
them. Once cards are out, three things the current build gets wrong:

1. A guest may bring as many people as they like. The seat allowance
   and the "request extra seats, admin approves" round-trip are friction
   nobody wants.
2. A party may be split across tables, including the primary guest. The
   guest page shows one table for the party.
3. Re-importing the guest spreadsheet must fill in the placeholders it
   matches, not mint 400 new invites with 400 new codes.

## 1. Party size: no limit, extra-seats flow retired

**Behaviour**
- `submitRsvp` no longer refuses on seat count. `SEAT_LIMIT` is removed
  from `RsvpResult`. The party after a submission is everyone already
  known plus every companion the guest adds.
- The RSVP form always offers "Add a companion". Each added row carries
  an optional name and a meal choice. Companions from earlier visits
  appear as toggles like any other guest, so a guest can later mark them
  not coming. Guests never delete rows: a checked-in record is never at
  risk from a re-submission.
- Editing stays open until `Event.rsvpDeadline`, as today. Same code,
  same page, previous answers pre-filled.
- `seatsAllotted` stays as the organiser's planning number only: the
  placeholder batch form, CSV import column, admin list and detail. It
  is not enforced anywhere and the guest page no longer mentions it.

**Removed**
- `Invite.extraSeatsRequested`, `extraSeatsStatus`, `extraSeatsReason`
  and the `ExtraSeatsStatus` enum. Mongo leaves stale fields in old
  documents; Prisma ignores fields the schema does not declare, so no
  backfill and no ordering constraint on `db:push`.
- The extra-seats inputs on the RSVP form and in `submitRsvpAction`.
- The approve/deny block and `resolveExtraSeatsAction` on the admin
  invite detail page, and `resolveExtraSeats` in the invites repository.
- The "extra seats pending" count in `src/lib/stats/rsvp.ts` and its
  dashboard line on `/admin`.
- Seed rows, tests and docs that reference any of the above.

**Validation**
- `rsvpSubmissionSchema.guests` keeps a `.max(100)` as a request-size
  bound. The message says the party is too large to submit in one go,
  not that seats ran out. `extraSeatsRequested` and `extraSeatsReason`
  leave the schema.

## 2. Table per guest

**Data**: unchanged. `Guest.tableNumber` already exists and already
overrides `Invite.tableNumber`. A guest with no table of their own
inherits the invite's. `Invite.tableNumber` stays as the party default.

**Admin invite detail** (`/admin/invites/[id]`): each guest row gains a
Table input alongside the existing name fields. `inviteGuestSchema` and
`updateGuest`/`addGuest` accept `tableNumber` (trimmed, max 20, empty
clears to null). The row already displays the resolved table.

**Guest page** (`/i/[token]`):
- `loadGuestPage` returns `seats: Seat[]` instead of a single `table`
  and `marker`, where `Seat = { guestId, name, table, marker }` for each
  guest whose seat is showable. Resolution per guest: seating released,
  that guest `attending === true`, that guest has a resolved table.
- `seatVisibility` becomes per-guest input (`attending`, `table`). A new
  `partySeatVisibility` summarises the party: `shown` when at least one
  seat is showable, otherwise the reason from the primary guest so the
  pending copy reads as today.
- Section heading is "Your seat" for one showable seat and "Your seats"
  for several. Under it, one line per guest: name and table. The
  floorplan highlights every distinct table in the party; the scroll
  zoom targets the primary guest's marker (or the first) as now.
- When nothing is showable the countdown and pending copy render
  unchanged.

**Check-in party card**: the party heading drops its single table. Each
guest row shows "Table N" beside the name, resolved per guest. `Party`
from `src/lib/checkin/repository.ts` gains a resolved `tableNumber` per
guest and loses the party-level one.

**Guest CSV export**: already resolves per guest. No change.

## 3. CSV import updates matching invites by label

**Key**: the row's `label`. No new column. Matching order:
1. Exactly one existing invite has this label: update it.
2. No label match and the label is a bare integer (`002`, `17`): update
   the invite with that number, if one exists.
3. Otherwise: create, as today.

**Refusals** (row-level, never file-level):
- Two or more existing invites share the label: row flagged
  "label matches several invites" in the preview and skipped on commit.
- The same label appears twice in the file: second and later rows
  flagged "duplicate label in file" and skipped.
- Two rows resolve to the same invite (for example `2` and `002`, or a
  party name and its card number): the later row is flagged
  "same invite as an earlier row" and skipped.
- Labels are not made unique in the database. Existing data may already
  collide, and a unique index would refuse the `db:push`.

**Update semantics**: `label`, `seatsAllotted`, `tableNumber`,
`adminNotes` are written from the row (empty cells clear the optional
ones, matching create); the primary guest's email, company and title
likewise. The primary guest is updated in place when one exists, else
created with `isPrimary: true`. Token, number, status, `respondedAt`,
other guests and check-in data are untouched. A row matched by its bare
number is written with that number as its label, so a spreadsheet keyed
on card numbers keeps those labels and the guests' names live on the
guest record. Renaming a card ("002" to "Reyes Party") is done on the
admin invite page, after which the new name is the key for the next
import.

**Email dedupe**: the existing "skip if primary email already exists"
rule applies to create rows only. An update row may carry an email that
already belongs to the primary guest it is updating.

**Preview and result**: `ParsedRow` gains `action: 'create' | 'update' |
'skip'` with the skip reason in `errors`. The preview table shows the
action per row. `ImportResult` becomes `{ created, updated, skipped:
Array<{ rowNumber, reason }> }`; the existing email-skip list folds into
`skipped`. Audit meta records all three counts.

**Transaction**: creates and updates commit together. Match resolution
(label lookup, number lookup) runs inside the transaction so a
concurrent admin edit cannot slip between preview and commit.

## Testing

Unit: per-guest and party seat visibility; RSVP validation without
extra seats and with the 100 ceiling; CSV parse marking duplicate labels.

Integration: RSVP with eight companions succeeds and derives status;
re-submission toggling a companion off does not delete rows; guest page
data returns one seat per showable guest across two tables; admin
`updateGuest` with a table; check-in party resolves table per guest;
import matches by label, by number, refuses ambiguous label, creates the
rest, keeps token and number.

E2E: guest adds five companions and confirms; admin gives the primary
and one companion different tables, releases seating; guest page lists
both tables and highlights both markers; check-in card shows both;
import a CSV against a placeholder run and confirm the QR list CSV shows
the same tokens before and after. Visual baselines regenerate for the
guest page.

## Out of scope

- Guests choosing their own table.
- Deleting companions from the guest side.
- Reopening RSVP edits after the deadline.
- A unique constraint on `Invite.label`.
- The bold-index QR sheet change, parked in the working tree; it ships
  after this work.

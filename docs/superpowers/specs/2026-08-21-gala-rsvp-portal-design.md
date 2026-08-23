# 2026 Gala RSVP Portal — Design

**Date:** 2026-08-21
**Status:** Approved
**Scope:** Single-event RSVP portal with QR-based guest access, animated guest journey, and an admin backend.

---

## 1. Problem

A corporate gala (200–1000 invitees) needs to collect RSVPs. Each invitee receives a
printed or emailed invitation carrying a QR code unique to them. Scanning it must take
them straight into a personalized RSVP experience — no account, no password, no
"enter your invite code." Organizers need a backend to manage invitees, generate the
QR codes, watch responses arrive, and check people in at the door.

## 2. Goals

- A guest scans a QR code and is immediately recognized by name, with their party and
  seat already known to the system.
- The guest journey is a scroll-advancing animated narrative, not a form on a page.
- The experience is mobile-first — the scan happens on a phone.
- Organizers can bulk-import invitees, generate print-ready QR codes, and track
  responses live.
- Staff can check guests in at the door by scanning the same QR code.
- Admin accounts are themselves manageable, with roles.

## 3. Non-goals

- **Multi-event / multi-tenant.** One deployment serves one event. The schema carries
  an `Event` row so a second event is not architecturally blocked, but no event-switching
  UI, no cross-event isolation, and no per-event admin scoping is built.
- **Email sending.** Invitations are exported as printable QR assets. No SMTP integration,
  no reminder blasts. (Deferred; see Future Work.)
- **Payment or ticketing.** No money changes hands.
- **Native mobile apps.** Web only, including the check-in scanner.

## 4. Success criteria

| Criterion | Target |
| --- | --- |
| Guest completes RSVP from scan | Under 90 seconds on a mid-range phone |
| Guest portal LCP on 4G | < 2.5s |
| Guest portal INP | < 200ms |
| Guest portal CLS | < 0.1 |
| Guest JS bundle (motion layer excluded, lazy) | < 150kb gzipped |
| Test coverage | >= 80% |
| Reduced-motion support | Every animation has a static end state |
| Check-in scan to confirmation | < 2 seconds |

---

## 5. Stack

| Concern | Choice | Rationale |
| --- | --- | --- |
| Framework | Next.js 16, App Router, TypeScript | One repo, one deploy; shared types and validation between guest portal and admin |
| Styling | Tailwind CSS v4 + CSS custom property design tokens | Tokens live in one file; no hardcoded palette values in components |
| Database | MongoDB 8, replica set | Already installed on the target machine. Replica set is mandatory: Prisma uses transactions. Verified to support the transactional, cascade, and case-insensitive-search behaviour this design needs. |
| ORM | Prisma 6.19.3 | Typed queries via the `mongodb` connector. Pinned to 6.x: Prisma 7 ships no MongoDB driver adapter. |
| Motion | Anime.js v4 | ~40kb, timeline-based, scrubable via `seek()` for scroll-driven playback |
| 3D | Three.js (lazy, hero only) | Single instanced-points scene; dynamically imported, tier-gated |
| Validation | Zod | One schema per boundary, shared client/server |
| QR encode | `qrcode` | Server-side PNG/SVG generation |
| QR decode | `BarcodeDetector` native API, `@zxing/browser` fallback | Native where available (most Android/Chrome), WASM fallback for iOS Safari |
| PDF | `pdf-lib` | Print-ready QR sheets |
| Password hashing | Argon2id | Current best practice |
| Testing | Vitest, Playwright | Unit/integration and E2E/visual regression |

**Alternatives rejected:**

- *Vite SPA + separate Express API* — two deploys, two auth surfaces, duplicated types,
  CORS. The render-loop control it buys is not control Next.js removes.
- *Static site + serverless functions* — CSV import, live dashboards, image upload and a
  check-in scanner constitute a real application; this approach fights back within a week.
- *PostgreSQL* — the original choice, and a better structural fit for relational data.
  Dropped because MongoDB Community is already installed on the target machine while
  Postgres is not, and installing Postgres needs administrator rights that are unavailable.
  A spike confirmed MongoDB handles every access pattern this design uses: interactive
  transactions with rollback, cascade deletes, `mode: "insensitive"` search across
  relations, scalar string lists, and `SetNull` on audit actors.
- *Supabase / Neon* — viable hosted Postgres, but both require account signup and a
  network dependency that the local MongoDB removes.

---

## 6. Visual direction

**Midnight Gala.** Explicitly not "clean minimal."

- **Ground:** deep ink navy graduating to near-black, with subtle film grain overlay.
- **Accent:** warm brass gold, used *semantically* — brass means "this is yours."
  The guest's name, their table number, their confirmation stamp. Never decorative.
- **Type:** editorial serif for display (event name, act headings) paired with a clean
  grotesk for UI and form labels. Two families, deliberate contrast in scale.
- **Depth:** volumetric light bloom behind the hero, layered parallax planes, real
  elevation on surfaces rather than uniform flat cards.
- **Light mode:** warm bone-white ground with the same brass accent — a designed light
  theme, not an inverted dark one. Neither theme is the default fallback of the other.

Designed mobile-first at 375px, scaled up through 768 / 1024 / 1440.

---

## 7. Access and identity model

### 7.1 Guest access

The QR code encodes `https://<host>/i/<token>`.

- `token` is 24 cryptographically random bytes, base64url-encoded (32 chars).
- The database stores **only `sha256(token)`**, indexed unique. A database leak does not
  yield working invite links.
- Lookup is by hash: hash the incoming token, select by `tokenHash`. Constant-time
  comparison is unnecessary given hash-indexed lookup, but the token is never logged.
- Tokens are revocable and regeneratable per invite from the admin panel. Regenerating
  invalidates any previously printed code for that invite.
- Token entropy (192 bits) makes enumeration infeasible. A rate limit on `/i/*`
  (20 requests / minute / IP) is nonetheless applied as defense in depth.
- No guest session is created. Every request re-resolves the token. The token in the URL
  *is* the credential.

**Accepted risk:** anyone holding the link holds the invite. This is intentional — the
brief specified frictionless scanning. Mitigations: tokens are per-invite (a leak exposes
one party, not the guest list), regeneratable, and the RSVP deadline closes the write
window. The `noindex, nofollow` meta and `Referrer-Policy: no-referrer` prevent the token
leaking to third parties or search engines.

### 7.2 Admin access

- Email + Argon2id password hash.
- Server-side session stored in `AdminSession`, referenced by an httpOnly, Secure,
  `SameSite=Lax` cookie. DB-backed so sessions are revocable.
- CSRF token required on every mutating request.
- Role checked server-side in every route handler and server action. Never in the client
  alone.
- Failed-login rate limiting: 5 attempts / 15 min / email, exponential backoff.

**Roles:**

| Role | Capabilities |
| --- | --- |
| `OWNER` | Everything, including creating/deleting admin users and changing roles |
| `ADMIN` | Invites, guests, event configuration, exports, check-in |
| `STAFF` | Check-in scanner only |

There is always at least one OWNER; the system refuses to delete or demote the last one.

A STAFF user signing in lands directly on `/admin/checkin`; the dashboard and every other
admin route are closed to them.

---

## 8. Data model

```
// All ids are MongoDB ObjectIds, mapped to `_id` by Prisma.

AdminUser
  id, email (unique), name, passwordHash, role (OWNER|ADMIN|STAFF),
  isActive, lastLoginAt, mustChangePassword, createdAt, updatedAt

AdminSession
  id, userId -> AdminUser, expiresAt, ip, userAgent, createdAt

Event
  id, name, tagline, startsAt, timezone, venueName, address,
  dressCode, rsvpDeadline, brandTokens (json), floorplanAssetId -> MediaAsset

AgendaItem
  id, eventId -> Event, startsAt, title, description, icon, sortOrder

MealOption
  id, eventId -> Event, label, description, sortOrder, isActive

Invite
  id, tokenHash (unique, indexed), label, seatsAllotted,
  extraSeatsRequested, extraSeatsStatus (NONE|PENDING|APPROVED|DENIED),
  status (PENDING|ATTENDING|DECLINED|PARTIAL),
  tableNumber, adminNotes, respondedAt, createdAt, updatedAt

Guest
  id, inviteId -> Invite, firstName, lastName, badgeName,
  company, title, email, phone, isPrimary,
  attending (bool, nullable), mealOptionId -> MealOption (nullable),
  dietary (string[]), accessibilityNeeds,
  tableNumber (nullable override), checkedInAt, checkedInById -> AdminUser

TableMarker
  id, eventId -> Event, tableNumber, x (float 0-1), y (float 0-1)

MediaAsset
  id, filename, mimeType, bytes (bytea), width, height, createdAt

AuditLog
  id, actorId -> AdminUser (nullable), action, entity, entityId,
  meta (json), ip, createdAt
```

**Design notes:**

- `MealOption` is a table, not an enum. Meal choices are event configuration, and changing
  them must not require a migration.
- `Guest.tableNumber` overrides `Invite.tableNumber`, allowing a party to be split across
  tables. Resolution: `guest.tableNumber ?? invite.tableNumber`.
- `TableMarker` coordinates are normalized 0–1 against the floorplan image, so the marker
  stays correct at every render size.
- The floorplan lives in MongoDB as `Bytes` and is served through a cached route handler.
  At one image of a few hundred KB, this trades negligible performance for one fewer
  vendor and one fewer environment variable.
- `AuditLog.actorId` is nullable to record system-originated actions.
- `Invite.tokenCipher` stores the invite token encrypted with AES-256-GCM under a key
  derived from `SESSION_SECRET`. `tokenHash` serves lookup; `tokenCipher` exists so QR
  sheets can be re-exported in bulk without rotating every token. A database leak alone
  yields nothing usable - the secret lives outside the database.
- Referential actions (`Cascade`, `SetNull`) are enforced by Prisma's client-side
  emulation rather than by the database, because MongoDB has no foreign keys. Verified
  working; the practical consequence is that direct database writes bypassing Prisma
  would not cascade.

### 8.1 Invite status derivation

`Invite.status` is derived from its guests and persisted for query performance:

- No guest has `attending` set → `PENDING`
- All guests `attending = false` → `DECLINED`
- All guests `attending = true` → `ATTENDING`
- Mixed → `PARTIAL`

It is recomputed inside the same transaction as any guest attendance write.

---

## 9. Guest journey

Six acts, advancing on scroll. Each act is a distinct component with its own Anime.js
timeline factory.

| Act | Content | Motion |
| --- | --- | --- |
| **Arrival** | "Welcome, {firstName}." | Wax seal breaks (SVG path morph), particles disperse (Three.js), name resolves letter-by-letter |
| **The Event** | Name, date, venue, live countdown | Parallax layers separate at differing scroll rates |
| **The Evening** | Agenda items from `AgendaItem` | Vertical SVG path draws downward with scroll; each item staggers in as the line reaches it |
| **Your Seat** | Floorplan + resolved table number | Image fades in, transform-based zoom toward the guest's `TableMarker`, marker pulses |
| **RSVP** | Multi-step form | Step transitions cross-fade and slide; progress indicator fills |
| **Sealed** | Confirmation + `.ics` download | Stamp-press impact animation, brass foil shimmer |

### 9.1 RSVP form steps

1. **Attending?** — Yes / No. "No" jumps straight to a short decline confirmation.
2. **Who's coming** — one card per allotted seat. Per guest: first name, last name,
   badge name, company, title, email, phone, meal choice, dietary restrictions,
   accessibility needs. The primary guest's card is pre-filled from the imported data.
3. **Extra seats** — only shown if all allotted seats are claimed. Guest may request N
   additional seats with a reason; this sets `extraSeatsStatus = PENDING` and surfaces in
   the admin queue. Requested seats do **not** create `Guest` rows until approved.
4. **Review** — full summary, editable by tapping back to any step.
5. **Confirm** — writes in a single transaction, sets `respondedAt`, recomputes status.

Responses remain editable until `Event.rsvpDeadline`. After the deadline the form is
read-only with a message directing the guest to contact the organizer.

### 9.2 Motion safety rails

These are built in from Phase 4, not retrofitted:

- `prefers-reduced-motion: reduce` collapses every timeline to its final state. Content is
  fully readable and the form fully usable with zero animation.
- **Device tiering** — `navigator.deviceMemory`, `hardwareConcurrency`, and
  `connection.effectiveType` produce a tier. Below the threshold, the Three.js layer is
  never imported; a static CSS gradient renders instead.
- The WebGL scene pauses on `visibilitychange` and when scrolled out of view
  (IntersectionObserver). No render loop runs off-screen.
- Only compositor-friendly properties are animated: `transform`, `opacity`, `clip-path`,
  and `filter` sparingly. No animation of `width`, `height`, `top`, `left`, or `font-size`.
- `will-change` is applied narrowly and removed when a timeline completes.
- Scroll progress is read through a single `requestAnimationFrame`-throttled listener
  feeding `timeline.seek()`, not per-component scroll handlers.

---

## 10. Admin backend

| Route | Min role | Function |
| --- | --- | --- |
| `/admin/login` | — | Email + password, rate limited |
| `/admin` | ADMIN | Dashboard: invited / responded / attending / declined / silent counts, meal tallies, response rate over time, pending extra-seat requests |
| `/admin/invites` | ADMIN | Searchable, filterable, sortable table; per-invite detail and edit; token regeneration |
| `/admin/invites/import` | ADMIN | CSV upload → validated preview with row-level errors → commit |
| `/admin/invites/qr` | ADMIN | Generate print-ready PDF sheet or ZIP of PNGs |
| `/admin/guests` | ADMIN | Flat guest list, filters, CSV export |
| `/admin/event` | ADMIN | Event details, agenda editor, meal options, floorplan upload, click-to-place table markers |
| `/admin/users` | OWNER | Create admin, set role, deactivate, force password reset |
| `/admin/checkin` | STAFF | Mobile camera scanner |
| `/admin/audit` | OWNER | Audit log, filterable by actor / entity / date |

### 10.1 CSV import

Two-phase: upload and validate, then commit. Never a blind write.

**Columns:** `label`, `seatsAllotted`, `tableNumber`, `primaryFirstName`,
`primaryLastName`, `primaryEmail`, `primaryCompany`, `primaryTitle`, `adminNotes`.

Validation reports per-row errors (missing required field, non-integer seat count,
malformed email, duplicate email against existing invites) alongside a preview table.
Rows with errors are individually skippable; the operator commits the valid remainder or
cancels entirely. Commit is one transaction — partial writes are impossible.

Each committed row creates an `Invite` with a freshly generated token and one primary
`Guest`.

### 10.2 QR generation

Per invite: encode `https://<host>/i/<token>` at error-correction level M, rendered at
600×600 PNG. Output either as a ZIP of PNGs named by invite label, or a print-ready PDF
laying out codes on a grid with the invite label beneath each. Generation is streamed to
avoid holding 1000 images in memory.

### 10.3 Check-in scanner

Mobile-first, designed for a dim venue and a staff member holding a phone one-handed.

- Camera via `BarcodeDetector` where available, `@zxing/browser` WASM fallback otherwise.
- On successful scan: resolve token → show the party, with each attending guest as a
  large tap target. Already-checked-in guests are visibly distinguished.
- Tapping a guest writes `checkedInAt` and `checkedInById`.
- **Offline tolerance:** check-ins queue in IndexedDB and flush when connectivity returns.
  The UI reflects the optimistic state immediately and marks unsynced entries. Venue wifi
  is assumed unreliable.
- Duplicate scans are idempotent — re-checking-in an already-checked-in guest is a no-op
  that reports the original check-in time rather than an error.

---

## 11. Security

- All input validated with Zod at every boundary — route handlers, server actions, CSV
  rows, and file uploads.
- All queries go through Prisma. No raw query string interpolation, no `$queryRawUnsafe`.
- No `dangerouslySetInnerHTML` anywhere in the guest portal. Guest-supplied text
  (dietary notes, accessibility needs, extra-seat reasons) renders as text nodes only.
- File upload restricted to `image/png`, `image/jpeg`, `image/webp`; magic-byte verified,
  not trusted by extension or declared MIME type; 8MB cap; dimensions validated.
- Response headers: `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`,
  `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`,
  `Permissions-Policy: camera=(self), microphone=(), geolocation=()`.
- CSP with per-request nonce for scripts. Camera access is same-origin only.
- Guest portal pages carry `noindex, nofollow`.
- No secrets in client bundles. `DATABASE_URL` (a MongoDB replica-set URI), `SESSION_SECRET`, and `ADMIN_SEED_*` are
  server-only and asserted present at startup — the app refuses to boot without them.
- Tokens are never written to logs or error messages.
- Every admin mutation writes an `AuditLog` row within the same transaction.

---

## 12. Testing

**Unit (Vitest)** — token generation and hash lookup; CSV parsing and validation rules;
seat-allowance enforcement; invite status derivation; meal and headcount aggregation;
device-tier classification; `.ics` generation.

**Integration (Vitest against a test MongoDB database)** — route handlers and server actions
end-to-end through the database: RSVP submission transaction, CSV commit atomicity, role
enforcement on every protected route, session lifecycle, check-in idempotency.

**E2E (Playwright)** — scan → RSVP → confirm; decline path; extra-seat request and admin
approval; admin login and role gating; CSV import including the error path; check-in scan
including a duplicate scan.

**Visual regression** — 375 / 768 / 1440, both themes, guest acts and key admin screens.

**Accessibility** — automated axe checks per route; keyboard navigation through the full
RSVP flow; reduced-motion rendering verified; contrast validated against the token palette.

**Coverage target:** 80% minimum, per project standards.

---

## 13. Build phases

| Phase | Deliverable | Done when |
| --- | --- | --- |
| 0 | Scaffold, Prisma schema, migrations, seed | `pnpm dev` runs, seeded DB, CI green |
| 1 | Admin auth, shell, admin user management | OWNER can create and manage admins; roles enforced |
| 2 | Invite/guest CRUD, CSV import, QR generation | 500 invites importable; QR PDF prints correctly |
| 3 | Guest portal: token resolution, full RSVP flow | A scan completes an RSVP end to end, unanimated |
| 4 | Motion layer | Six acts animate; reduced-motion and low-tier paths verified |
| 5 | Event settings, agenda editor, floorplan, table markers | Admin configures the event without touching code |
| 6 | Check-in scanner | Staff check in guests, including offline |
| 7 | Dashboard analytics, exports, audit log | Live counts accurate; CSV export matches DB |
| 8 | Hardening | Security review, a11y audit, CWV targets met, E2E green |

Phases 1–3 produce a portal that can genuinely be sent to guests. Phase 4 makes it
beautiful. Phases 5–8 make it operable.

---

## 14. Known risks

| Risk | Mitigation |
| --- | --- |
| Three.js hero janks on older Android | Isolated behind the device-tier gate and a dynamic import; removable without touching any other module |
| QR link forwarded to an unintended recipient | Per-invite scope limits blast radius; tokens regeneratable; deadline closes the write window |
| Venue wifi fails during check-in | IndexedDB queue with optimistic UI and deferred sync |
| Floorplan in MongoDB grows unwieldy | Acceptable at one image; if it becomes several, `MediaAsset` is already an indirection layer and can be repointed at object storage without schema change elsewhere |
| Scroll-driven motion conflicts with mobile browser chrome resize | Scroll progress computed against a fixed container height, not `100vh` |

## 15. Future work (explicitly out of scope)

Email delivery of invitations and reminders; multi-event support; guest-uploaded
headshots for badges; per-agenda-segment RSVP; SMS reminders; seating-chart drag-and-drop
assignment.

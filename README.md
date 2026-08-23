# Gala RSVP Portal

QR-based RSVP portal for a single corporate gala, with an admin backend for
guest-list management, QR generation, and door check-in.

## Requirements

- Node.js 20.11 or later, and npm 10 (this repo uses npm, not pnpm/yarn — there
  is only a `package-lock.json`)
- MongoDB 8 (Community Edition is fine). Prisma uses transactions, and
  MongoDB only supports transactions on a **replica set**, so a plain
  standalone `mongod` will not work. This repo runs its own single-node
  replica set locally on port **27018**, separate from any MongoDB you may
  already have running on the default port.

## Setup

```bash
npm install
cp .env.example .env        # fill in the values described below

# Start the project-local replica set (keep this running in its own
# terminal, or background it as shown). Data lives in ./.mongo/data.
mkdir -p .mongo/data
npm run db:start &

# One-time only: turn that single mongod into a one-node replica set.
# Re-running this after the replica set already exists is a harmless no-op
# error ("already initialized").
npx -y mongosh@2 --port 27018 --eval \
  'rs.initiate({ _id: "rs0", members: [{ _id: 0, host: "127.0.0.1:27018" }] })'

# Push the Prisma schema to the app database and the integration-test
# database. MongoDB has no migration files, so this is always `db push`,
# never `prisma migrate`.
npx prisma db push
DATABASE_URL="$DATABASE_URL_TEST" npx prisma db push

npm run db:seed
npm run dev
```

Sign in at http://localhost:3000/admin/login using `ADMIN_SEED_EMAIL` and
`ADMIN_SEED_PASSWORD`. Change the password immediately.

The Playwright E2E suite (`npm run test:e2e`) manages its own database: its
global setup pushes the schema to `DATABASE_URL_E2E` and wipes/reseeds it on
every run, so you never need to push to it by hand.

## Door check-in

`/admin/checkin` is reachable by the **STAFF** role (and by ADMIN/OWNER, who
outrank it) — it is the *only* screen STAFF can reach; every other admin
route redirects a STAFF session back to it.

- **Scanner URL:** sign in at `/admin/login` with a STAFF account and you
  land on `/admin/checkin` directly. Point a phone or tablet at it and grant
  camera access when prompted.
- **HTTPS is required for the camera.** `getUserMedia` only works on a
  **secure context** — `localhost` in development, or a real HTTPS origin in
  production. Loading the check-in page over plain HTTP on a phone shows
  "Camera unavailable — paste the invitation link below" instead of a
  viewfinder; that fallback field accepts the same URL a QR code encodes.
- **Check-ins queue offline.** Tapping a guest updates the row immediately
  and queues the check-in in the browser's IndexedDB. A red "Offline" badge
  and an amber "N to sync" counter appear whenever the venue Wi-Fi drops;
  nothing blocks on the network, and the queue survives a reload. Every
  queued check-in flushes automatically the moment the connection returns
  (an `online` event fires, and a 15-second interval retries regardless, in
  case the browser's own event never fires).
- **Undoing a mistap:** tap the same guest a second time. Check-in is
  idempotent either direction — undo, then tap again to re-check them in —
  and every transition (`guest.checkIn` / `guest.undoCheckIn`) is written to
  the audit log with the staff member who did it, visible to an OWNER at
  `/admin/audit`.

## Going live

Work through this checklist before the first real invitation goes out:

1. **Host MongoDB as a real replica set.** A managed service (Atlas, or any
   MongoDB 8 deployment with `replicaSet` configured) — Prisma's
   transactions require it; a standalone `mongod` will not work in
   production any more than it does locally.
2. **Set a real `SESSION_SECRET`** — 32+ random bytes
   (`openssl rand -base64 32`), not the value in `.env.example`. **Rotating
   it later stops every already-printed QR code from decrypting for bulk
   re-export** (see the Environment section below) — set it once, keep it.
3. **Set `APP_URL` to the public HTTPS origin** the event will actually run
   on. The check-in scanner's `extractToken()` refuses a scanned QR code
   whose origin doesn't match `APP_URL` exactly, so a mismatched value
   (a staging domain, a trailing slash, `http://` instead of `https://`)
   makes every printed QR code unscannable at the door.
4. **Upload the real floorplan** on `/admin/event` and place the table
   markers so the guest portal's seat map points at the right table.
5. **Configure the event** — name, date, venue, dress code, agenda, meal
   options, RSVP deadline — on `/admin/event`.
6. **Run the seed exactly once** (`npm run db:seed`) against the production
   database, after the above, then change the seeded owner password
   immediately.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Development server |
| `npm test` | Unit and integration tests (Vitest) |
| `npm run test:coverage` | Same tests, with the 80% coverage gate enforced |
| `npm run test:e2e` | Playwright end-to-end tests |
| `npm run typecheck` | TypeScript, no emit |
| `npm run lint` | ESLint 9 flat config (`eslint-config-next` + TypeScript). Run in CI after typecheck. |
| `npm run build` | Production build (`prisma generate && next build`) |
| `npm run db:start` | Local single-node MongoDB replica set on port 27018 |
| `npm run db:push` | Sync the Prisma schema to `DATABASE_URL` |
| `npm run db:seed` | Idempotent seed (owner account, sample event, sample invites) |
| `npm run db:studio` | Prisma Studio |

## Routes

| Route | Role | Purpose |
| --- | --- | --- |
| `/i/[token]` | Public (token) | Guest RSVP portal |
| `/admin/login` | Public | Admin sign-in |
| `/admin` | ADMIN | Live dashboard — response counts, meal tallies, arrivals |
| `/admin/invites` | ADMIN | Invite list, creation, CSV import |
| `/admin/guests` | ADMIN | Every guest across every party, filterable, exportable |
| `/admin/event` | ADMIN | Event, agenda, meal options, floorplan |
| `/admin/checkin` | STAFF | Door scanner — STAFF's only reachable screen |
| `/admin/users` | OWNER | Admin account management |
| `/admin/audit` | OWNER | Who changed what, and when |
| `/api/admin/guests/export` | ADMIN | Streamed, formula-injection-safe guest CSV |

## Environment

Every variable in `.env.example` is required (the app refuses to start
without them), except `DATABASE_URL_E2E`, which defaults to
`mongodb://127.0.0.1:27018/gala_e2e?replicaSet=rs0` when unset.

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | The application database. |
| `DATABASE_URL_TEST` | The Vitest integration-suite database. Must resolve to a physically distinct database from `DATABASE_URL` — `tests/helpers/db.ts` checks this and refuses to run otherwise, so it can never `deleteMany()` against real data. |
| `DATABASE_URL_E2E` | The Playwright E2E database. Also must be distinct from `DATABASE_URL`. It is wiped completely and reseeded before every `npm run test:e2e` run — never point it at data you want to keep. |
| `APP_URL` | Public origin, used to build QR code URLs. No trailing slash. |
| `SESSION_SECRET` | 32+ random bytes, base64 (`openssl rand -base64 32`). |
| `ADMIN_SEED_EMAIL` | Owner account created by `npm run db:seed`. |
| `ADMIN_SEED_PASSWORD` | Password for that seeded owner account (min 12 characters). Change it after first login. |

**`SESSION_SECRET` does double duty: it signs admin sessions, and it
encrypts invite tokens at rest.** Rotating it makes every existing QR code
unrecoverable for bulk re-export — guests can still scan their own codes,
because invite lookup by token uses a hash rather than decryption, but you
could not reprint a lost sheet without regenerating tokens for those
invites. Treat `SESSION_SECRET` as a value you set once and keep, not one
you rotate casually.

## CI

`.github/workflows/ci.yml` runs on every push to `main` and every pull
request: `npm ci`, start and initiate a single-node MongoDB replica set,
push the Prisma schema to the app and integration-test databases,
`npm run typecheck`, `npm run test:coverage` (the 80% coverage gate),
`npm run build`, `npx playwright install --with-deps chromium` (the axe
scans and the CDP-based performance test both need a real Chromium, not
just the Playwright test runner), then the Playwright suite against its own
database. `perf.spec.ts` prints the guest route's real script-byte counts
(lite tier, full tier, motion-layer breakdown) as plain `console.log` lines
during that step, so the CI job log carries the actual figures on every
run, not just on failure. On E2E failure, `playwright-report/` and
`test-results/` are uploaded as build artifacts.

## Documentation

- Design: `docs/superpowers/specs/2026-08-21-gala-rsvp-portal-design.md`
- Plan: `docs/superpowers/plans/2026-08-21-foundation-and-admin-backend.md`

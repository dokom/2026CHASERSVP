# Foundation & Admin Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the scaffold, database, admin authentication, admin user management, invite/guest management, CSV import, and QR code generation — a working backend that can manage a 1000-person guest list and produce print-ready QR invitations.

**Architecture:** A single Next.js 16 App Router application in TypeScript. Business logic lives in plain, framework-free modules under `src/lib/` so it can be unit-tested without a server; route handlers and server actions are thin wrappers that validate input with Zod, call a lib function, and write an audit row. MongoDB via Prisma (mongodb connector). Admin identity is a DB-backed session referenced by an httpOnly cookie; guest identity (built in Plan 2) is a hashed opaque token.

**Tech Stack:** Next.js 16, React 19, TypeScript 5.9, Tailwind CSS v4, MongoDB 8, Prisma 6.19.3, Zod 3.25, `@node-rs/argon2`, `papaparse`, `qrcode`, `jszip`, `pdf-lib`, Vitest 4, Playwright 1.62.

**Spec:** `docs/superpowers/specs/2026-08-21-gala-rsvp-portal-design.md`

## Global Constraints

- Node.js >= 20.11. Package manager: `npm` (pnpm cannot be installed here - EPERM writing to C:\Program Files\nodejs).
- Database is **MongoDB**, via Prisma's `mongodb` connector. Schema changes ship with
  `npx prisma db push`; there are no migration files.
- Dev and test run against a project-local single-node replica set on port 27018
  (`npm run db:start`). The replica set is mandatory - Prisma uses transactions and MongoDB
  requires a replica set for them. The machine's default standalone mongod on 27017 is untouched.
- Every module under `src/lib/` must be importable in a plain Node test — no `next/*` imports, no React, no `server-only`.
- All external input is validated with Zod at the boundary. No unvalidated `request.json()` reaches a lib function.
- Roles are `OWNER` > `ADMIN` > `STAFF`. Every admin route checks role **server-side**. Client-side gating is presentation only.
- The system refuses to delete, deactivate, or demote the last active `OWNER`.
- Every admin mutation writes an `AuditLog` row **inside the same transaction** as the mutation.
- Invite tokens are never logged, never included in error messages, and stored only as `sha256` hex.
- Files stay under 400 lines. Functions stay under 50 lines.
- Test coverage floor: 80%.
- Secrets come from `src/lib/env.ts` only. No direct `process.env` access outside that file.

---

## File Structure

**Configuration**
- `package.json`, `tsconfig.json`, `next.config.ts`, `postcss.config.mjs` — project setup
- `vitest.config.ts` — unit + integration test runner
- `playwright.config.ts` — E2E runner
- `.env.example` — documented environment contract
- `.github/workflows/ci.yml` — lint, typecheck, test, build

**Data**
- `prisma/schema.prisma` — full schema (all models, including ones Plan 2 consumes)
- `prisma/seed.ts` — seeds one Event, meal options, agenda, an OWNER, and sample invites

**Library — pure, testable, no framework imports**
- `src/lib/env.ts` — validated environment access, the only `process.env` reader
- `src/lib/db.ts` — Prisma client singleton
- `src/lib/crypto/tokens.ts` — invite token generation and hashing
- `src/lib/crypto/secret-box.ts` — AES-256-GCM seal/open for token recovery
- `src/lib/crypto/password.ts` — Argon2id hash and verify
- `src/lib/auth/roles.ts` — role ranking and comparison
- `src/lib/auth/session.ts` — session create / resolve / destroy
- `src/lib/auth/rate-limit.ts` — failed-login throttling
- `src/lib/audit.ts` — audit row writer
- `src/lib/invites/status.ts` — invite status derivation
- `src/lib/invites/repository.ts` — invite and guest data access
- `src/lib/invites/csv.ts` — CSV parsing and row validation
- `src/lib/invites/qr.ts` — QR URL, PNG, ZIP, and PDF generation
- `src/lib/admin-users/repository.ts` — admin user data access with last-OWNER protection
- `src/lib/validation/admin.ts` — Zod schemas for admin forms

**Framework layer — thin**
- `src/lib/auth/guard.ts` — `getCurrentUser`, `requireRole` (imports `next/headers`)
- `src/lib/auth/csrf.ts` — CSRF token issue and verify
- `src/app/admin/login/page.tsx`, `src/app/admin/login/actions.ts`
- `src/app/admin/layout.tsx`, `src/app/admin/nav.tsx`
- `src/app/admin/page.tsx` — placeholder dashboard (real one in Plan 4)
- `src/app/admin/users/page.tsx`, `src/app/admin/users/actions.ts`
- `src/app/admin/invites/page.tsx`, `src/app/admin/invites/[id]/page.tsx`, `src/app/admin/invites/actions.ts`
- `src/app/admin/invites/import/page.tsx`, `src/app/admin/invites/import/actions.ts`
- `src/app/api/admin/qr/route.ts` — streams ZIP or PDF

**Tests**
- `tests/unit/*.test.ts` — one file per lib module
- `tests/integration/*.test.ts` — against a real test database
- `tests/e2e/*.spec.ts` — Playwright
- `tests/helpers/db.ts` — test database reset helper

---

## Task 1: Project scaffold and test harness

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `postcss.config.mjs`, `vitest.config.ts`, `.env.example`, `src/app/layout.tsx`, `src/app/page.tsx`, `src/app/globals.css`
- Test: `tests/unit/smoke.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `npm run dev`, `npm run build`, `npm test`, `npm run test:e2e`, `npm run lint`, `npm run typecheck` scripts

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "gala-rsvp-portal",
  "version": "0.1.0",
  "private": true,
  "engines": {
    "node": ">=20.11"
  },
  "scripts": {
    "dev": "next dev",
    "build": "prisma generate && next build",
    "start": "next start",
    "lint": "next lint",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage",
    "test:e2e": "playwright test",
    "db:push": "prisma db push",
    "db:seed": "tsx prisma/seed.ts",
    "db:studio": "prisma studio",
    "db:start": "mongod --replSet rs0 --port 27018 --bind_ip 127.0.0.1 --dbpath .mongo/data"
  },
  "dependencies": {
    "@node-rs/argon2": "^2.1.0",
    "@prisma/client": "^6.19.3",
    "jszip": "^3.10.1",
    "next": "^16.3.2",
    "papaparse": "^5.4.1",
    "pdf-lib": "^1.17.1",
    "qrcode": "^1.5.4",
    "react": "^19.2.8",
    "react-dom": "^19.2.8",
    "zod": "^3.25.76"
  },
  "devDependencies": {
    "@playwright/test": "^1.62.1",
    "@tailwindcss/postcss": "^4.0.0",
    "@types/node": "^26.2.0",
    "@types/papaparse": "^5.3.15",
    "@types/qrcode": "^1.5.5",
    "@types/react": "^19.2.18",
    "@types/react-dom": "^19.2.4",
    "@vitest/coverage-v8": "^4.1.11",
    "dotenv": "^16.4.7",
    "eslint": "^9.18.0",
    "eslint-config-next": "^16.3.2",
    "prisma": "^6.19.3",
    "tailwindcss": "^4.0.0",
    "tsx": "^4.19.2",
    "typescript": "^5.9.3",
    "vitest": "^4.1.11"
  }
}
```

- [ ] **Step 2: Create the config files**

`tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "ES2022"],
    "allowJs": false,
    "skipLibCheck": true,
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

`next.config.ts`:

```ts
import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ['@node-rs/argon2'],
}

export default nextConfig
```

`postcss.config.mjs`:

```js
export default { plugins: { '@tailwindcss/postcss': {} } }
```

`vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts'],
    setupFiles: ['./tests/helpers/setup-env.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/lib/**'],
      thresholds: { lines: 80, functions: 80, branches: 80, statements: 80 },
    },
  },
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
})
```

- [ ] **Step 3: Create `.env.example`**

```bash
# MongoDB connection string. Must point at a REPLICA SET - Prisma uses transactions.
# Start the local one with `npm run db:start`.
DATABASE_URL="mongodb://127.0.0.1:27018/gala?replicaSet=rs0"

# Separate database used by integration tests. MUST differ from DATABASE_URL.
DATABASE_URL_TEST="mongodb://127.0.0.1:27018/gala_test?replicaSet=rs0"

# Public origin, used to build QR code URLs. No trailing slash.
APP_URL="http://localhost:3000"

# 32+ random bytes, base64. Generate: openssl rand -base64 32
SESSION_SECRET="replace-me-with-32-plus-random-bytes"

# Seeded on first `npm run db:seed`. Change the password after first login.
ADMIN_SEED_EMAIL="owner@example.com"
ADMIN_SEED_PASSWORD="change-me-immediately"
```

- [ ] **Step 4: Create the minimal app shell**

`src/app/globals.css`:

```css
@import "tailwindcss";

:root {
  --color-ink: oklch(16% 0.03 265);
  --color-ink-deep: oklch(9% 0.02 265);
  --color-bone: oklch(96% 0.01 85);
  --color-brass: oklch(76% 0.13 78);
  --color-brass-dim: oklch(62% 0.10 78);
  --color-surface: oklch(21% 0.03 265);
  --color-border: oklch(31% 0.02 265);
  --color-text: oklch(94% 0.01 85);
  --color-text-muted: oklch(70% 0.01 85);
  --color-danger: oklch(62% 0.19 25);
  --color-success: oklch(70% 0.15 150);
}

body {
  background: var(--color-ink-deep);
  color: var(--color-text);
  -webkit-font-smoothing: antialiased;
}
```

`src/app/layout.tsx`:

```tsx
import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Gala RSVP',
  robots: { index: false, follow: false },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
```

`src/app/page.tsx`:

```tsx
export default function Home() {
  return <main className="p-8">Gala RSVP Portal</main>
}
```

- [ ] **Step 5: Write the smoke test**

`tests/unit/smoke.test.ts`:

```ts
import { describe, it, expect } from 'vitest'

describe('test harness', () => {
  it('runs', () => {
    expect(1 + 1).toBe(2)
  })
})
```

- [ ] **Step 6: Install and verify**

Run: `npm install && npm test && npm run typecheck`
Expected: install succeeds, one test passes, zero type errors.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore: scaffold Next.js app with Vitest harness"
```

---

## Task 2: Validated environment access

**Files:**
- Create: `src/lib/env.ts`
- Test: `tests/unit/env.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `getEnv(): Env` and the `Env` type. `Env` has `DATABASE_URL`, `DATABASE_URL_TEST`, `APP_URL`, `SESSION_SECRET`, `ADMIN_SEED_EMAIL`, `ADMIN_SEED_PASSWORD` — all `string`. Also exports `parseEnv(source: Record<string, string | undefined>): Env` for testing.

- [ ] **Step 1: Write the failing test**

`tests/unit/env.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { parseEnv } from '@/lib/env'

const valid = {
  DATABASE_URL: 'mongodb://127.0.0.1:27018/gala?replicaSet=rs0',
  DATABASE_URL_TEST: 'mongodb://127.0.0.1:27018/gala_test?replicaSet=rs0',
  APP_URL: 'https://gala.example.com',
  SESSION_SECRET: 'a'.repeat(32),
  ADMIN_SEED_EMAIL: 'owner@example.com',
  ADMIN_SEED_PASSWORD: 'hunter2hunter2',
}

describe('parseEnv', () => {
  it('returns a typed config for valid input', () => {
    expect(parseEnv(valid).APP_URL).toBe('https://gala.example.com')
  })

  it('throws naming the missing variable', () => {
    const { SESSION_SECRET, ...rest } = valid
    expect(() => parseEnv(rest)).toThrow(/SESSION_SECRET/)
  })

  it('rejects a session secret under 32 characters', () => {
    expect(() => parseEnv({ ...valid, SESSION_SECRET: 'short' })).toThrow(/SESSION_SECRET/)
  })

  it('rejects a non-URL APP_URL', () => {
    expect(() => parseEnv({ ...valid, APP_URL: 'not-a-url' })).toThrow(/APP_URL/)
  })

  it('strips a trailing slash from APP_URL', () => {
    expect(parseEnv({ ...valid, APP_URL: 'https://gala.example.com/' }).APP_URL)
      .toBe('https://gala.example.com')
  })

  it('rejects a test database identical to the app database', () => {
    expect(() => parseEnv({ ...valid, DATABASE_URL_TEST: valid.DATABASE_URL }))
      .toThrow(/must differ/i)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/env.test.ts`
Expected: FAIL — cannot resolve `@/lib/env`.

- [ ] **Step 3: Implement `src/lib/env.ts`**

```ts
import { z } from 'zod'

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  DATABASE_URL_TEST: z.string().min(1),
  APP_URL: z.string().url().transform((v) => v.replace(/\/+$/, '')),
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters'),
  ADMIN_SEED_EMAIL: z.string().email(),
  ADMIN_SEED_PASSWORD: z.string().min(12),
})

export type Env = z.infer<typeof schema>

export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = schema.safeParse(source)
  if (!result.success) {
    const detail = result.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ')
    throw new Error(`Invalid environment: ${detail}`)
  }
  if (result.data.DATABASE_URL_TEST === result.data.DATABASE_URL) {
    throw new Error('Invalid environment: DATABASE_URL_TEST must differ from DATABASE_URL')
  }
  return result.data
}

let cached: Env | null = null

export function getEnv(): Env {
  if (!cached) cached = parseEnv(process.env)
  return cached
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/env.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/env.ts tests/unit/env.test.ts
git commit -m "feat: validated environment access"
```

---

## Task 3: Prisma schema, migration, and test database harness

**Files:**
- Create: `prisma/schema.prisma`, `src/lib/db.ts`, `tests/helpers/db.ts`, `tests/helpers/setup-env.ts`
- Test: `tests/integration/schema.test.ts`

**Interfaces:**
- Consumes: `getEnv` from Task 2
- Produces: `prisma` (a `PrismaClient` singleton) from `@/lib/db`. Test helper exports `testDb: PrismaClient` and `resetDb(): Promise<void>`. All model names and field names below are relied on by every later task.

- [ ] **Step 1: Write `prisma/schema.prisma`**

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "mongodb"
  url      = env("DATABASE_URL")
}

enum Role {
  OWNER
  ADMIN
  STAFF
}

enum InviteStatus {
  PENDING
  ATTENDING
  DECLINED
  PARTIAL
}

enum ExtraSeatsStatus {
  NONE
  PENDING
  APPROVED
  DENIED
}

model AdminUser {
  id                 String         @id @default(auto()) @map("_id") @db.ObjectId
  email              String         @unique
  name               String
  passwordHash       String
  role               Role           @default(ADMIN)
  isActive           Boolean        @default(true)
  mustChangePassword Boolean        @default(false)
  lastLoginAt        DateTime?
  createdAt          DateTime       @default(now())
  updatedAt          DateTime       @updatedAt
  sessions           AdminSession[]
  auditLogs          AuditLog[]
  checkedInGuests    Guest[]        @relation("CheckedInBy")
}

model AdminSession {
  id        String    @id @default(auto()) @map("_id") @db.ObjectId
  tokenHash String    @unique
  userId    String    @db.ObjectId
  user      AdminUser @relation(fields: [userId], references: [id], onDelete: Cascade)
  expiresAt DateTime
  ip        String?
  userAgent String?
  createdAt DateTime  @default(now())

  @@index([userId])
  @@index([expiresAt])
}

model LoginAttempt {
  id        String   @id @default(auto()) @map("_id") @db.ObjectId
  email     String
  succeeded Boolean
  ip        String?
  createdAt DateTime @default(now())

  @@index([email, createdAt])
}

model MediaAsset {
  id        String   @id @default(auto()) @map("_id") @db.ObjectId
  filename  String
  mimeType  String
  bytes     Bytes
  width     Int
  height    Int
  createdAt DateTime @default(now())
  events    Event[]
}

model Event {
  id               String        @id @default(auto()) @map("_id") @db.ObjectId
  name             String
  tagline          String?
  startsAt         DateTime
  timezone         String        @default("UTC")
  venueName        String
  address          String
  dressCode        String?
  rsvpDeadline     DateTime
  brandTokens      Json?
  floorplanAssetId String?       @db.ObjectId
  floorplanAsset   MediaAsset?   @relation(fields: [floorplanAssetId], references: [id])
  createdAt        DateTime      @default(now())
  updatedAt        DateTime      @updatedAt
  agendaItems      AgendaItem[]
  mealOptions      MealOption[]
  tableMarkers     TableMarker[]
}

model AgendaItem {
  id          String   @id @default(auto()) @map("_id") @db.ObjectId
  eventId     String   @db.ObjectId
  event       Event    @relation(fields: [eventId], references: [id], onDelete: Cascade)
  startsAt    DateTime
  title       String
  description String?
  icon        String?
  sortOrder   Int      @default(0)

  @@index([eventId, sortOrder])
}

model MealOption {
  id          String  @id @default(auto()) @map("_id") @db.ObjectId
  eventId     String  @db.ObjectId
  event       Event   @relation(fields: [eventId], references: [id], onDelete: Cascade)
  label       String
  description String?
  sortOrder   Int     @default(0)
  isActive    Boolean @default(true)
  guests      Guest[]

  @@index([eventId, sortOrder])
}

model TableMarker {
  id          String @id @default(auto()) @map("_id") @db.ObjectId
  eventId     String @db.ObjectId
  event       Event  @relation(fields: [eventId], references: [id], onDelete: Cascade)
  tableNumber String
  x           Float
  y           Float

  @@unique([eventId, tableNumber])
}

model Invite {
  id                  String           @id @default(auto()) @map("_id") @db.ObjectId
  tokenHash           String           @unique
  tokenCipher         String
  label               String
  seatsAllotted       Int              @default(1)
  extraSeatsRequested Int              @default(0)
  extraSeatsStatus    ExtraSeatsStatus @default(NONE)
  extraSeatsReason    String?
  status              InviteStatus     @default(PENDING)
  tableNumber         String?
  adminNotes          String?
  respondedAt         DateTime?
  createdAt           DateTime         @default(now())
  updatedAt           DateTime         @updatedAt
  guests              Guest[]

  @@index([status])
  @@index([label])
  @@index([createdAt])
}

model Guest {
  id                 String      @id @default(auto()) @map("_id") @db.ObjectId
  inviteId           String      @db.ObjectId
  invite             Invite      @relation(fields: [inviteId], references: [id], onDelete: Cascade)
  firstName          String
  lastName           String
  badgeName          String?
  company            String?
  title              String?
  email              String?
  phone              String?
  isPrimary          Boolean     @default(false)
  attending          Boolean?
  mealOptionId       String?     @db.ObjectId
  mealOption         MealOption? @relation(fields: [mealOptionId], references: [id])
  dietary            String[]    @default([])
  accessibilityNeeds String?
  tableNumber        String?
  checkedInAt        DateTime?
  checkedInById      String?     @db.ObjectId
  checkedInBy        AdminUser?  @relation("CheckedInBy", fields: [checkedInById], references: [id])
  createdAt          DateTime    @default(now())
  updatedAt          DateTime    @updatedAt

  @@index([inviteId])
  @@index([attending])
  @@index([email])
}

model AuditLog {
  id        String     @id @default(auto()) @map("_id") @db.ObjectId
  actorId   String?    @db.ObjectId
  actor     AdminUser? @relation(fields: [actorId], references: [id], onDelete: SetNull)
  action    String
  entity    String
  entityId  String?
  meta      Json?
  ip        String?
  createdAt DateTime   @default(now())

  @@index([createdAt])
  @@index([entity, entityId])
}
```

**Why `Invite.tokenCipher` exists:** `tokenHash` is what lookups use, but a hash is
one-way — so bulk QR re-export would be impossible without rotating every token.
`tokenCipher` stores the same token encrypted with AES-256-GCM (Task 4a). A database
leak alone still yields nothing usable: decryption requires `SESSION_SECRET`, which
lives outside the database. This refines spec section 7.1, which described hash-only
storage before the export requirement was worked through.

- [ ] **Step 2: Create the Prisma client singleton**

`src/lib/db.ts`:

```ts
import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma
```

- [ ] **Step 3: Create the test database helper**

`tests/helpers/db.ts`:

```ts
import { PrismaClient } from '@prisma/client'

const url = process.env.DATABASE_URL_TEST
if (!url) throw new Error('DATABASE_URL_TEST is required to run integration tests')

export const testDb = new PrismaClient({ datasources: { db: { url } } })

/** Child collections first, so cascade emulation never races a parent delete. */
const MODELS = [
  'auditLog', 'guest', 'invite', 'tableMarker', 'mealOption',
  'agendaItem', 'event', 'mediaAsset', 'loginAttempt',
  'adminSession', 'adminUser',
] as const

// MongoDB has no TRUNCATE; deleteMany per collection is the equivalent.
export async function resetDb(): Promise<void> {
  for (const model of MODELS) {
    await (testDb[model] as { deleteMany: () => Promise<unknown> }).deleteMany()
  }
}
```

- [ ] **Step 3b: Create the test environment setup file**

`tests/helpers/setup-env.ts` — loads `.env` so integration tests see the same
configuration the app does, without any test hardcoding secrets:

```ts
import { config } from 'dotenv'

config({ path: '.env' })

process.env.SESSION_SECRET ??= 'test-session-secret-at-least-32-chars'
process.env.APP_URL ??= 'http://localhost:3000'
```

Add `dotenv` to devDependencies: `npm i -D dotenv`.

- [ ] **Step 4: Write the schema integration test**

`tests/integration/schema.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { testDb, resetDb } from '../helpers/db'

beforeEach(resetDb)
afterAll(() => testDb.$disconnect())

describe('schema', () => {
  it('cascades guest deletion when its invite is deleted', async () => {
    const invite = await testDb.invite.create({
      data: {
        tokenHash: 'hash-1',
        tokenCipher: 'cipher-1',
        label: 'Reyes Party',
        seatsAllotted: 2,
        guests: { create: { firstName: 'Jordan', lastName: 'Reyes', isPrimary: true } },
      },
    })
    await testDb.invite.delete({ where: { id: invite.id } })
    expect(await testDb.guest.count()).toBe(0)
  })

  it('rejects a duplicate invite token hash', async () => {
    await testDb.invite.create({ data: { tokenHash: 'dupe', tokenCipher: 'c1', label: 'A' } })
    await expect(
      testDb.invite.create({ data: { tokenHash: 'dupe', tokenCipher: 'c2', label: 'B' } }),
    ).rejects.toThrow()
  })

  it('preserves audit rows when the actor is deleted', async () => {
    const user = await testDb.adminUser.create({
      data: { email: 'a@example.com', name: 'A', passwordHash: 'x', role: 'ADMIN' },
    })
    await testDb.auditLog.create({
      data: { actorId: user.id, action: 'invite.create', entity: 'Invite', entityId: 'i1' },
    })
    await testDb.adminUser.delete({ where: { id: user.id } })
    const log = await testDb.auditLog.findFirst()
    expect(log?.actorId).toBeNull()
    expect(log?.action).toBe('invite.create')
  })

  it('defaults an invite to PENDING with no extra seats', async () => {
    const invite = await testDb.invite.create({
      data: { tokenHash: 'h2', tokenCipher: 'c3', label: 'C' },
    })
    expect(invite.status).toBe('PENDING')
    expect(invite.extraSeatsStatus).toBe('NONE')
    expect(invite.seatsAllotted).toBe(1)
  })
})
```

- [ ] **Step 5: Create the databases and run the migration**

```bash
cp .env.example .env          # defaults already point at 127.0.0.1:27018

# Start the project-local single-node replica set (leave it running).
mkdir -p .mongo/data
npm run db:start &

# One-time: promote it to a replica set. Safe to re-run; errors if already initiated.
npx -y mongosh@2 --quiet --port 27018 --eval 'rs.initiate({_id:"rs0",members:[{_id:0,host:"127.0.0.1:27018"}]})'

# Push the schema to BOTH databases. MongoDB has no migration files.
npx prisma db push
DATABASE_URL="mongodb://127.0.0.1:27018/gala_test?replicaSet=rs0" npx prisma db push
```

Expected: `rs.status()` reports `PRIMARY`, and both databases report indexes in sync.

- [ ] **Step 6: Run the integration test**

Run: `npx vitest run tests/integration/schema.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 7: Commit**

```bash
git add prisma src/lib/db.ts tests/helpers/db.ts tests/integration/schema.test.ts
git commit -m "feat: database schema and test harness"
```

---

## Task 4: Invite token generation and hashing

**Files:**
- Create: `src/lib/crypto/tokens.ts`
- Test: `tests/unit/tokens.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `generateInviteToken(): string` — 32-character base64url. `hashToken(token: string): string` — lowercase sha256 hex, 64 chars. `TOKEN_BYTE_LENGTH = 24`.

- [ ] **Step 1: Write the failing test**

`tests/unit/tokens.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { generateInviteToken, hashToken, TOKEN_BYTE_LENGTH } from '@/lib/crypto/tokens'

describe('generateInviteToken', () => {
  it('produces 32 base64url characters', () => {
    const token = generateInviteToken()
    expect(token).toMatch(/^[A-Za-z0-9_-]{32}$/)
  })

  it('encodes 24 bytes of entropy', () => {
    expect(TOKEN_BYTE_LENGTH).toBe(24)
  })

  it('does not repeat across 1000 generations', () => {
    const seen = new Set(Array.from({ length: 1000 }, generateInviteToken))
    expect(seen.size).toBe(1000)
  })
})

describe('hashToken', () => {
  it('returns 64 lowercase hex characters', () => {
    expect(hashToken('abc')).toMatch(/^[0-9a-f]{64}$/)
  })

  it('is deterministic', () => {
    expect(hashToken('abc')).toBe(hashToken('abc'))
  })

  it('differs for different input', () => {
    expect(hashToken('abc')).not.toBe(hashToken('abd'))
  })

  it('never returns the input', () => {
    const token = generateInviteToken()
    expect(hashToken(token)).not.toContain(token)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/tokens.test.ts`
Expected: FAIL — cannot resolve `@/lib/crypto/tokens`.

- [ ] **Step 3: Implement `src/lib/crypto/tokens.ts`**

```ts
import { randomBytes, createHash } from 'node:crypto'

/** 24 bytes = 192 bits of entropy, encoding to exactly 32 base64url characters. */
export const TOKEN_BYTE_LENGTH = 24

/**
 * Generates an opaque invite token. The plaintext is shown to an operator
 * exactly once (when a QR code is rendered) and is never persisted.
 */
export function generateInviteToken(): string {
  return randomBytes(TOKEN_BYTE_LENGTH).toString('base64url')
}

/**
 * Hashes a token for storage and lookup. Only the hash is persisted, so a
 * database leak does not yield working invite links.
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/tokens.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/crypto/tokens.ts tests/unit/tokens.test.ts
git commit -m "feat: invite token generation and hashing"
```

---

## Task 4a: Reversible token encryption

**Files:**
- Create: `src/lib/crypto/secret-box.ts`
- Test: `tests/unit/secret-box.test.ts`

**Interfaces:**
- Consumes: nothing (the key is passed in, keeping the module unit-testable)
- Produces: `deriveKey(secret: string): Buffer` (scrypt, 32 bytes), `seal(plaintext: string, secret: string): string` (returns `v1.<iv>.<tag>.<ciphertext>`, all base64url), `open(sealed: string, secret: string): string`, `SealError`.

Used to store `Invite.tokenCipher` so QR codes can be re-exported in bulk without rotating tokens. `hashToken` remains the lookup path; this is the recovery path.

- [ ] **Step 1: Write the failing test**

`tests/unit/secret-box.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { seal, open, deriveKey, SealError } from '@/lib/crypto/secret-box'

const SECRET = 'a'.repeat(32)

describe('secret box', () => {
  it('round-trips a value', () => {
    expect(open(seal('hello world', SECRET), SECRET)).toBe('hello world')
  })

  it('produces a versioned four-part envelope', () => {
    const sealed = seal('hello', SECRET)
    const parts = sealed.split('.')
    expect(parts).toHaveLength(4)
    expect(parts[0]).toBe('v1')
  })

  it('never contains the plaintext', () => {
    expect(seal('super-secret-token', SECRET)).not.toContain('super-secret-token')
  })

  it('uses a fresh IV, so the same input seals differently', () => {
    expect(seal('hello', SECRET)).not.toBe(seal('hello', SECRET))
  })

  it('fails to open with the wrong secret', () => {
    expect(() => open(seal('hello', SECRET), 'b'.repeat(32))).toThrow(SealError)
  })

  it('rejects a tampered ciphertext', () => {
    const parts = seal('hello', SECRET).split('.')
    parts[3] = Buffer.from('tampered').toString('base64url')
    expect(() => open(parts.join('.'), SECRET)).toThrow(SealError)
  })

  it('rejects a malformed envelope', () => {
    expect(() => open('garbage', SECRET)).toThrow(SealError)
  })

  it('rejects an unknown version prefix', () => {
    const parts = seal('hello', SECRET).split('.')
    parts[0] = 'v2'
    expect(() => open(parts.join('.'), SECRET)).toThrow(SealError)
  })

  it('derives a 32-byte key deterministically', () => {
    expect(deriveKey(SECRET)).toHaveLength(32)
    expect(deriveKey(SECRET).equals(deriveKey(SECRET))).toBe(true)
  })

  it('derives different keys for different secrets', () => {
    expect(deriveKey(SECRET).equals(deriveKey('b'.repeat(32)))).toBe(false)
  })

  it('round-trips an empty string', () => {
    expect(open(seal('', SECRET), SECRET)).toBe('')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/secret-box.test.ts`
Expected: FAIL — cannot resolve `@/lib/crypto/secret-box`.

- [ ] **Step 3: Implement `src/lib/crypto/secret-box.ts`**

```ts
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto'

export class SealError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SealError'
  }
}

const VERSION = 'v1'
const IV_BYTES = 12
const KEY_BYTES = 32
/** Fixed salt: the secret is already high-entropy, and a per-value salt would
 *  force a scrypt derivation on every read. */
const SALT = 'gala-rsvp-token-vault'

const keyCache = new Map<string, Buffer>()

export function deriveKey(secret: string): Buffer {
  const cached = keyCache.get(secret)
  if (cached) return cached
  const key = scryptSync(secret, SALT, KEY_BYTES)
  keyCache.set(secret, key)
  return key
}

export function seal(plaintext: string, secret: string): string {
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv('aes-256-gcm', deriveKey(secret), iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  return [
    VERSION,
    iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    ciphertext.toString('base64url'),
  ].join('.')
}

export function open(sealed: string, secret: string): string {
  const parts = sealed.split('.')
  if (parts.length !== 4) throw new SealError('Malformed sealed value')

  const [version, ivPart, tagPart, dataPart] = parts as [string, string, string, string]
  if (version !== VERSION) throw new SealError(`Unsupported seal version: ${version}`)

  try {
    const decipher = createDecipheriv(
      'aes-256-gcm',
      deriveKey(secret),
      Buffer.from(ivPart, 'base64url'),
    )
    decipher.setAuthTag(Buffer.from(tagPart, 'base64url'))
    return Buffer.concat([
      decipher.update(Buffer.from(dataPart, 'base64url')),
      decipher.final(),
    ]).toString('utf8')
  } catch {
    throw new SealError('Could not open sealed value')
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/secret-box.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/crypto/secret-box.ts tests/unit/secret-box.test.ts
git commit -m "feat: AES-256-GCM secret box for token recovery"
```

---

## Task 5: Password hashing

**Files:**
- Create: `src/lib/crypto/password.ts`
- Test: `tests/unit/password.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `hashPassword(plain: string): Promise<string>`, `verifyPassword(hash: string, plain: string): Promise<boolean>`, `MIN_PASSWORD_LENGTH = 12`.

- [ ] **Step 1: Write the failing test**

`tests/unit/password.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { hashPassword, verifyPassword, MIN_PASSWORD_LENGTH } from '@/lib/crypto/password'

describe('password hashing', () => {
  it('produces an argon2id hash', async () => {
    const hash = await hashPassword('correct horse battery')
    expect(hash.startsWith('$argon2id$')).toBe(true)
  })

  it('never stores the plaintext', async () => {
    const hash = await hashPassword('correct horse battery')
    expect(hash).not.toContain('correct horse battery')
  })

  it('salts — the same password hashes differently each time', async () => {
    const a = await hashPassword('correct horse battery')
    const b = await hashPassword('correct horse battery')
    expect(a).not.toBe(b)
  })

  it('verifies the correct password', async () => {
    const hash = await hashPassword('correct horse battery')
    expect(await verifyPassword(hash, 'correct horse battery')).toBe(true)
  })

  it('rejects the wrong password', async () => {
    const hash = await hashPassword('correct horse battery')
    expect(await verifyPassword(hash, 'wrong horse battery')).toBe(false)
  })

  it('returns false rather than throwing on a malformed hash', async () => {
    expect(await verifyPassword('not-a-hash', 'anything')).toBe(false)
  })

  it('rejects a password shorter than the minimum', async () => {
    await expect(hashPassword('short')).rejects.toThrow(/at least/)
  })

  it('requires at least 12 characters', () => {
    expect(MIN_PASSWORD_LENGTH).toBe(12)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/password.test.ts`
Expected: FAIL — cannot resolve `@/lib/crypto/password`.

- [ ] **Step 3: Implement `src/lib/crypto/password.ts`**

```ts
import { hash, verify, Algorithm } from '@node-rs/argon2'

export const MIN_PASSWORD_LENGTH = 12

const OPTIONS = {
  algorithm: Algorithm.Argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const

export async function hashPassword(plain: string): Promise<string> {
  if (plain.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`)
  }
  return hash(plain, OPTIONS)
}

/**
 * Returns false for a malformed stored hash rather than throwing, so a
 * corrupted row denies access instead of crashing the login route.
 */
export async function verifyPassword(storedHash: string, plain: string): Promise<boolean> {
  try {
    return await verify(storedHash, plain)
  } catch {
    return false
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/password.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/crypto/password.ts tests/unit/password.test.ts
git commit -m "feat: argon2id password hashing"
```

---

## Task 6: Role ranking and comparison

**Files:**
- Create: `src/lib/auth/roles.ts`
- Test: `tests/unit/roles.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `type Role = 'OWNER' | 'ADMIN' | 'STAFF'`, `ROLE_RANK: Record<Role, number>`, `hasRole(actual: Role, minimum: Role): boolean`, `landingPathFor(role: Role): string`.

- [ ] **Step 1: Write the failing test**

`tests/unit/roles.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { hasRole, landingPathFor, ROLE_RANK } from '@/lib/auth/roles'

describe('hasRole', () => {
  it('grants OWNER every level', () => {
    expect(hasRole('OWNER', 'OWNER')).toBe(true)
    expect(hasRole('OWNER', 'ADMIN')).toBe(true)
    expect(hasRole('OWNER', 'STAFF')).toBe(true)
  })

  it('denies ADMIN owner-level access', () => {
    expect(hasRole('ADMIN', 'OWNER')).toBe(false)
    expect(hasRole('ADMIN', 'ADMIN')).toBe(true)
    expect(hasRole('ADMIN', 'STAFF')).toBe(true)
  })

  it('grants STAFF staff-level only', () => {
    expect(hasRole('STAFF', 'STAFF')).toBe(true)
    expect(hasRole('STAFF', 'ADMIN')).toBe(false)
    expect(hasRole('STAFF', 'OWNER')).toBe(false)
  })

  it('ranks OWNER above ADMIN above STAFF', () => {
    expect(ROLE_RANK.OWNER).toBeGreaterThan(ROLE_RANK.ADMIN)
    expect(ROLE_RANK.ADMIN).toBeGreaterThan(ROLE_RANK.STAFF)
  })
})

describe('landingPathFor', () => {
  it('sends STAFF straight to the check-in scanner', () => {
    expect(landingPathFor('STAFF')).toBe('/admin/checkin')
  })

  it('sends ADMIN and OWNER to the dashboard', () => {
    expect(landingPathFor('ADMIN')).toBe('/admin')
    expect(landingPathFor('OWNER')).toBe('/admin')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/roles.test.ts`
Expected: FAIL — cannot resolve `@/lib/auth/roles`.

- [ ] **Step 3: Implement `src/lib/auth/roles.ts`**

```ts
export type Role = 'OWNER' | 'ADMIN' | 'STAFF'

export const ROLE_RANK: Record<Role, number> = {
  STAFF: 1,
  ADMIN: 2,
  OWNER: 3,
}

export function hasRole(actual: Role, minimum: Role): boolean {
  return ROLE_RANK[actual] >= ROLE_RANK[minimum]
}

/** Where a user lands after signing in. STAFF has access to nothing else. */
export function landingPathFor(role: Role): string {
  return role === 'STAFF' ? '/admin/checkin' : '/admin'
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/roles.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/auth/roles.ts tests/unit/roles.test.ts
git commit -m "feat: role ranking and landing paths"
```

---

## Task 7: Session lifecycle

**Files:**
- Create: `src/lib/auth/session.ts`
- Test: `tests/integration/session.test.ts`

**Interfaces:**
- Consumes: `hashToken` (Task 4), `prisma` (Task 3)
- Produces: `SESSION_COOKIE = 'gala_admin_session'`, `SESSION_TTL_MS`, `createSession(db, userId, meta): Promise<{ token: string; expiresAt: Date }>`, `resolveSession(db, token): Promise<SessionUser | null>`, `destroySession(db, token): Promise<void>`, `purgeExpiredSessions(db): Promise<number>`. `SessionUser` is `{ id, email, name, role, mustChangePassword }`.

The `db` parameter is a `PrismaClient` so tests can pass the test client. Production callers pass the singleton.

- [ ] **Step 1: Write the failing test**

`tests/integration/session.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { testDb, resetDb } from '../helpers/db'
import {
  createSession, resolveSession, destroySession,
  purgeExpiredSessions, SESSION_COOKIE, SESSION_TTL_MS,
} from '@/lib/auth/session'
import { hashToken } from '@/lib/crypto/tokens'

beforeEach(resetDb)
afterAll(() => testDb.$disconnect())

async function makeUser() {
  return testDb.adminUser.create({
    data: { email: 'a@example.com', name: 'Ada', passwordHash: 'x', role: 'ADMIN' },
  })
}

describe('sessions', () => {
  it('names the cookie', () => {
    expect(SESSION_COOKIE).toBe('gala_admin_session')
  })

  it('creates a session resolvable by its token', async () => {
    const user = await makeUser()
    const { token } = await createSession(testDb, user.id, { ip: '1.1.1.1', userAgent: 'jest' })
    const resolved = await resolveSession(testDb, token)
    expect(resolved).toMatchObject({ id: user.id, email: 'a@example.com', role: 'ADMIN' })
  })

  it('stores only the hash of the session token', async () => {
    const user = await makeUser()
    const { token } = await createSession(testDb, user.id, {})
    const row = await testDb.adminSession.findFirst()
    expect(row?.tokenHash).toBe(hashToken(token))
    expect(row?.tokenHash).not.toBe(token)
  })

  it('sets expiry to the configured TTL', async () => {
    const user = await makeUser()
    const before = Date.now()
    const { expiresAt } = await createSession(testDb, user.id, {})
    expect(expiresAt.getTime()).toBeGreaterThanOrEqual(before + SESSION_TTL_MS - 1000)
  })

  it('returns null for an unknown token', async () => {
    expect(await resolveSession(testDb, 'nope')).toBeNull()
  })

  it('returns null for an expired session and deletes it', async () => {
    const user = await makeUser()
    const { token } = await createSession(testDb, user.id, {})
    await testDb.adminSession.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } })
    expect(await resolveSession(testDb, token)).toBeNull()
    expect(await testDb.adminSession.count()).toBe(0)
  })

  it('returns null for a deactivated user', async () => {
    const user = await makeUser()
    const { token } = await createSession(testDb, user.id, {})
    await testDb.adminUser.update({ where: { id: user.id }, data: { isActive: false } })
    expect(await resolveSession(testDb, token)).toBeNull()
  })

  it('destroys a session', async () => {
    const user = await makeUser()
    const { token } = await createSession(testDb, user.id, {})
    await destroySession(testDb, token)
    expect(await resolveSession(testDb, token)).toBeNull()
  })

  it('purges only expired sessions', async () => {
    const user = await makeUser()
    await createSession(testDb, user.id, {})
    await testDb.adminSession.create({
      data: { tokenHash: 'old', userId: user.id, expiresAt: new Date(Date.now() - 1000) },
    })
    expect(await purgeExpiredSessions(testDb)).toBe(1)
    expect(await testDb.adminSession.count()).toBe(1)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/integration/session.test.ts`
Expected: FAIL — cannot resolve `@/lib/auth/session`.

- [ ] **Step 3: Implement `src/lib/auth/session.ts`**

```ts
import type { PrismaClient } from '@prisma/client'
import { randomBytes } from 'node:crypto'
import { hashToken } from '@/lib/crypto/tokens'
import type { Role } from './roles'

export const SESSION_COOKIE = 'gala_admin_session'
export const SESSION_TTL_MS = 1000 * 60 * 60 * 12

export type SessionUser = {
  id: string
  email: string
  name: string
  role: Role
  mustChangePassword: boolean
}

export type SessionMeta = { ip?: string; userAgent?: string }

export async function createSession(
  db: PrismaClient,
  userId: string,
  meta: SessionMeta,
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString('base64url')
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS)
  await db.adminSession.create({
    data: {
      tokenHash: hashToken(token),
      userId,
      expiresAt,
      ip: meta.ip ?? null,
      userAgent: meta.userAgent ?? null,
    },
  })
  return { token, expiresAt }
}

export async function resolveSession(
  db: PrismaClient,
  token: string,
): Promise<SessionUser | null> {
  if (!token) return null
  const session = await db.adminSession.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true },
  })
  if (!session) return null

  if (session.expiresAt.getTime() <= Date.now()) {
    await db.adminSession.delete({ where: { id: session.id } }).catch(() => undefined)
    return null
  }
  if (!session.user.isActive) return null

  return {
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
    role: session.user.role as Role,
    mustChangePassword: session.user.mustChangePassword,
  }
}

export async function destroySession(db: PrismaClient, token: string): Promise<void> {
  if (!token) return
  await db.adminSession
    .deleteMany({ where: { tokenHash: hashToken(token) } })
    .catch(() => undefined)
}

export async function purgeExpiredSessions(db: PrismaClient): Promise<number> {
  const { count } = await db.adminSession.deleteMany({
    where: { expiresAt: { lte: new Date() } },
  })
  return count
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/integration/session.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/auth/session.ts tests/integration/session.test.ts
git commit -m "feat: DB-backed admin sessions"
```

---

## Task 8: Failed-login rate limiting

**Files:**
- Create: `src/lib/auth/rate-limit.ts`
- Test: `tests/integration/rate-limit.test.ts`

**Interfaces:**
- Consumes: `prisma` (Task 3)
- Produces: `MAX_ATTEMPTS = 5`, `WINDOW_MS`, `recordLoginAttempt(db, { email, succeeded, ip }): Promise<void>`, `isLockedOut(db, email): Promise<boolean>`, `clearAttempts(db, email): Promise<void>`.

- [ ] **Step 1: Write the failing test**

`tests/integration/rate-limit.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { testDb, resetDb } from '../helpers/db'
import {
  recordLoginAttempt, isLockedOut, clearAttempts, MAX_ATTEMPTS, WINDOW_MS,
} from '@/lib/auth/rate-limit'

beforeEach(resetDb)
afterAll(() => testDb.$disconnect())

async function fail(times: number, email = 'a@example.com') {
  for (let i = 0; i < times; i++) {
    await recordLoginAttempt(testDb, { email, succeeded: false, ip: '1.1.1.1' })
  }
}

describe('login rate limiting', () => {
  it('allows a fresh email', async () => {
    expect(await isLockedOut(testDb, 'a@example.com')).toBe(false)
  })

  it('allows up to the limit minus one', async () => {
    await fail(MAX_ATTEMPTS - 1)
    expect(await isLockedOut(testDb, 'a@example.com')).toBe(false)
  })

  it('locks out at the limit', async () => {
    await fail(MAX_ATTEMPTS)
    expect(await isLockedOut(testDb, 'a@example.com')).toBe(true)
  })

  it('scopes lockout to one email', async () => {
    await fail(MAX_ATTEMPTS)
    expect(await isLockedOut(testDb, 'b@example.com')).toBe(false)
  })

  it('is case-insensitive on email', async () => {
    await fail(MAX_ATTEMPTS, 'a@example.com')
    expect(await isLockedOut(testDb, 'A@Example.COM')).toBe(true)
  })

  it('ignores attempts older than the window', async () => {
    await fail(MAX_ATTEMPTS)
    await testDb.loginAttempt.updateMany({
      data: { createdAt: new Date(Date.now() - WINDOW_MS - 1000) },
    })
    expect(await isLockedOut(testDb, 'a@example.com')).toBe(false)
  })

  it('does not count successful attempts toward lockout', async () => {
    for (let i = 0; i < MAX_ATTEMPTS + 2; i++) {
      await recordLoginAttempt(testDb, { email: 'a@example.com', succeeded: true })
    }
    expect(await isLockedOut(testDb, 'a@example.com')).toBe(false)
  })

  it('clears attempts on demand', async () => {
    await fail(MAX_ATTEMPTS)
    await clearAttempts(testDb, 'a@example.com')
    expect(await isLockedOut(testDb, 'a@example.com')).toBe(false)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/integration/rate-limit.test.ts`
Expected: FAIL — cannot resolve `@/lib/auth/rate-limit`.

- [ ] **Step 3: Implement `src/lib/auth/rate-limit.ts`**

```ts
import type { PrismaClient } from '@prisma/client'

export const MAX_ATTEMPTS = 5
export const WINDOW_MS = 1000 * 60 * 15

function normalize(email: string): string {
  return email.trim().toLowerCase()
}

export async function recordLoginAttempt(
  db: PrismaClient,
  input: { email: string; succeeded: boolean; ip?: string },
): Promise<void> {
  await db.loginAttempt.create({
    data: {
      email: normalize(input.email),
      succeeded: input.succeeded,
      ip: input.ip ?? null,
    },
  })
}

export async function isLockedOut(db: PrismaClient, email: string): Promise<boolean> {
  const failures = await db.loginAttempt.count({
    where: {
      email: normalize(email),
      succeeded: false,
      createdAt: { gte: new Date(Date.now() - WINDOW_MS) },
    },
  })
  return failures >= MAX_ATTEMPTS
}

export async function clearAttempts(db: PrismaClient, email: string): Promise<void> {
  await db.loginAttempt.deleteMany({ where: { email: normalize(email) } })
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/integration/rate-limit.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/auth/rate-limit.ts tests/integration/rate-limit.test.ts
git commit -m "feat: failed-login rate limiting"
```

---

## Task 9: Audit logging

**Files:**
- Create: `src/lib/audit.ts`
- Test: `tests/integration/audit.test.ts`

**Interfaces:**
- Consumes: `prisma` (Task 3)
- Produces: `type AuditClient` (a Prisma client or transaction client), `writeAudit(tx: AuditClient, entry: AuditEntry): Promise<void>` where `AuditEntry` is `{ actorId: string | null; action: string; entity: string; entityId?: string | null; meta?: Record<string, unknown>; ip?: string | null }`. Also `REDACTED_KEYS` — key names scrubbed from `meta`.

- [ ] **Step 1: Write the failing test**

`tests/integration/audit.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { testDb, resetDb } from '../helpers/db'
import { writeAudit } from '@/lib/audit'

beforeEach(resetDb)
afterAll(() => testDb.$disconnect())

describe('writeAudit', () => {
  it('writes a row', async () => {
    await writeAudit(testDb, {
      actorId: null, action: 'invite.create', entity: 'Invite', entityId: 'i1',
    })
    const row = await testDb.auditLog.findFirst()
    expect(row).toMatchObject({ action: 'invite.create', entity: 'Invite', entityId: 'i1' })
  })

  it('redacts sensitive keys from meta', async () => {
    await writeAudit(testDb, {
      actorId: null,
      action: 'invite.regenerateToken',
      entity: 'Invite',
      entityId: 'i1',
      meta: { token: 'super-secret', label: 'Reyes Party', passwordHash: 'x' },
    })
    const row = await testDb.auditLog.findFirst()
    const meta = row?.meta as Record<string, unknown>
    expect(meta.token).toBe('[redacted]')
    expect(meta.passwordHash).toBe('[redacted]')
    expect(meta.label).toBe('Reyes Party')
  })

  it('rolls back with its transaction', async () => {
    await expect(
      testDb.$transaction(async (tx) => {
        await writeAudit(tx, { actorId: null, action: 'invite.create', entity: 'Invite' })
        throw new Error('boom')
      }),
    ).rejects.toThrow('boom')
    expect(await testDb.auditLog.count()).toBe(0)
  })

  it('accepts a null entityId', async () => {
    await writeAudit(testDb, { actorId: null, action: 'csv.import', entity: 'Invite' })
    const row = await testDb.auditLog.findFirst()
    expect(row?.entityId).toBeNull()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/integration/audit.test.ts`
Expected: FAIL — cannot resolve `@/lib/audit`.

- [ ] **Step 3: Implement `src/lib/audit.ts`**

```ts
import type { PrismaClient, Prisma } from '@prisma/client'

export type AuditClient = PrismaClient | Prisma.TransactionClient

export type AuditEntry = {
  actorId: string | null
  action: string
  entity: string
  entityId?: string | null
  meta?: Record<string, unknown>
  ip?: string | null
}

/** Keys whose values must never reach the audit table. */
export const REDACTED_KEYS = new Set([
  'token', 'tokenHash', 'password', 'passwordHash', 'sessionToken', 'secret',
])

function redact(meta: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(meta).map(([k, v]) => [k, REDACTED_KEYS.has(k) ? '[redacted]' : v]),
  )
}

/**
 * Writes an audit row. Pass the transaction client when auditing a mutation so
 * the log and the change commit or roll back together.
 */
export async function writeAudit(tx: AuditClient, entry: AuditEntry): Promise<void> {
  await tx.auditLog.create({
    data: {
      actorId: entry.actorId,
      action: entry.action,
      entity: entry.entity,
      entityId: entry.entityId ?? null,
      meta: entry.meta ? redact(entry.meta) : undefined,
      ip: entry.ip ?? null,
    },
  })
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/integration/audit.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/audit.ts tests/integration/audit.test.ts
git commit -m "feat: transactional audit logging"
```

---

## Task 10: Invite status derivation

**Files:**
- Create: `src/lib/invites/status.ts`
- Test: `tests/unit/invite-status.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `type InviteStatus = 'PENDING' | 'ATTENDING' | 'DECLINED' | 'PARTIAL'`, `deriveInviteStatus(guests: { attending: boolean | null }[]): InviteStatus`.

- [ ] **Step 1: Write the failing test**

`tests/unit/invite-status.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { deriveInviteStatus } from '@/lib/invites/status'

const yes = { attending: true }
const no = { attending: false }
const unset = { attending: null }

describe('deriveInviteStatus', () => {
  it('is PENDING when no guest has answered', () => {
    expect(deriveInviteStatus([unset, unset])).toBe('PENDING')
  })

  it('is PENDING for an invite with no guests', () => {
    expect(deriveInviteStatus([])).toBe('PENDING')
  })

  it('is ATTENDING when every guest is attending', () => {
    expect(deriveInviteStatus([yes, yes])).toBe('ATTENDING')
  })

  it('is DECLINED when every guest declined', () => {
    expect(deriveInviteStatus([no, no])).toBe('DECLINED')
  })

  it('is PARTIAL when guests disagree', () => {
    expect(deriveInviteStatus([yes, no])).toBe('PARTIAL')
  })

  it('is PARTIAL when some are attending and some have not answered', () => {
    expect(deriveInviteStatus([yes, unset])).toBe('PARTIAL')
  })

  it('is PARTIAL when some declined and some have not answered', () => {
    expect(deriveInviteStatus([no, unset])).toBe('PARTIAL')
  })

  it('handles a single attending guest', () => {
    expect(deriveInviteStatus([yes])).toBe('ATTENDING')
  })

  it('handles a single declining guest', () => {
    expect(deriveInviteStatus([no])).toBe('DECLINED')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/invite-status.test.ts`
Expected: FAIL — cannot resolve `@/lib/invites/status`.

- [ ] **Step 3: Implement `src/lib/invites/status.ts`**

```ts
export type InviteStatus = 'PENDING' | 'ATTENDING' | 'DECLINED' | 'PARTIAL'

export type GuestAttendance = { attending: boolean | null }

/**
 * Derives an invite's status from its guests.
 *
 * PENDING   — nobody has answered
 * ATTENDING — everybody is coming
 * DECLINED  — nobody is coming
 * PARTIAL   — anything else, including a partially answered invite
 */
export function deriveInviteStatus(guests: GuestAttendance[]): InviteStatus {
  if (guests.length === 0) return 'PENDING'

  let attending = 0
  let declined = 0
  let unanswered = 0

  for (const guest of guests) {
    if (guest.attending === true) attending++
    else if (guest.attending === false) declined++
    else unanswered++
  }

  if (unanswered === guests.length) return 'PENDING'
  if (attending === guests.length) return 'ATTENDING'
  if (declined === guests.length) return 'DECLINED'
  return 'PARTIAL'
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/invite-status.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/invites/status.ts tests/unit/invite-status.test.ts
git commit -m "feat: invite status derivation"
```

---

## Task 11: Request guard and CSRF

**Files:**
- Create: `src/lib/auth/guard.ts`, `src/lib/auth/csrf.ts`
- Test: `tests/unit/csrf.test.ts`

**Interfaces:**
- Consumes: `resolveSession`, `SESSION_COOKIE` (Task 7), `hasRole`, `landingPathFor`, `Role` (Task 6), `prisma` (Task 3), `getEnv` (Task 2)
- Produces:
  - `src/lib/auth/csrf.ts` — `CSRF_COOKIE = 'gala_csrf'`, `issueCsrfToken(): string`, `verifyCsrfToken(cookieValue: string | undefined, formValue: unknown): boolean`
  - `src/lib/auth/guard.ts` — `getCurrentUser(): Promise<SessionUser | null>`, `requireRole(minimum: Role): Promise<SessionUser>` (redirects to `/admin/login` when unauthenticated, to `landingPathFor(user.role)` when under-privileged), `requireCsrf(formData: FormData): Promise<void>` (throws `Error('Invalid CSRF token')`).

`guard.ts` is the one lib file permitted to import `next/*`, because it reads cookies. It is covered by integration and E2E tests rather than unit tests.

- [ ] **Step 1: Write the failing test for CSRF**

`tests/unit/csrf.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { issueCsrfToken, verifyCsrfToken, CSRF_COOKIE } from '@/lib/auth/csrf'

describe('csrf', () => {
  it('names the cookie', () => {
    expect(CSRF_COOKIE).toBe('gala_csrf')
  })

  it('issues a 43-character base64url token', () => {
    expect(issueCsrfToken()).toMatch(/^[A-Za-z0-9_-]{43}$/)
  })

  it('issues a distinct token each call', () => {
    expect(issueCsrfToken()).not.toBe(issueCsrfToken())
  })

  it('accepts a matching pair', () => {
    const token = issueCsrfToken()
    expect(verifyCsrfToken(token, token)).toBe(true)
  })

  it('rejects a mismatched pair', () => {
    expect(verifyCsrfToken(issueCsrfToken(), issueCsrfToken())).toBe(false)
  })

  it('rejects a missing cookie', () => {
    expect(verifyCsrfToken(undefined, issueCsrfToken())).toBe(false)
  })

  it('rejects a missing form value', () => {
    expect(verifyCsrfToken(issueCsrfToken(), null)).toBe(false)
  })

  it('rejects a non-string form value', () => {
    const token = issueCsrfToken()
    expect(verifyCsrfToken(token, 42)).toBe(false)
  })

  it('rejects an empty pair', () => {
    expect(verifyCsrfToken('', '')).toBe(false)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/csrf.test.ts`
Expected: FAIL — cannot resolve `@/lib/auth/csrf`.

- [ ] **Step 3: Implement `src/lib/auth/csrf.ts`**

```ts
import { randomBytes, timingSafeEqual } from 'node:crypto'

export const CSRF_COOKIE = 'gala_csrf'

/** 32 bytes encodes to 43 base64url characters. */
export function issueCsrfToken(): string {
  return randomBytes(32).toString('base64url')
}

/**
 * Double-submit verification: the cookie value must equal the value posted in
 * the form body. Compared in constant time.
 */
export function verifyCsrfToken(cookieValue: string | undefined, formValue: unknown): boolean {
  if (!cookieValue || typeof formValue !== 'string' || formValue.length === 0) return false
  const a = Buffer.from(cookieValue)
  const b = Buffer.from(formValue)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/csrf.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Implement `src/lib/auth/guard.ts`**

```ts
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/db'
import { resolveSession, SESSION_COOKIE, type SessionUser } from './session'
import { hasRole, landingPathFor, type Role } from './roles'
import { CSRF_COOKIE, verifyCsrfToken } from './csrf'

export async function getCurrentUser(): Promise<SessionUser | null> {
  const store = await cookies()
  const token = store.get(SESSION_COOKIE)?.value
  if (!token) return null
  return resolveSession(prisma, token)
}

/**
 * Gates a page or action. Redirects rather than throwing so the caller does not
 * need error handling. Never returns for an unauthorized request.
 */
export async function requireRole(minimum: Role): Promise<SessionUser> {
  const user = await getCurrentUser()
  if (!user) redirect('/admin/login')
  if (!hasRole(user.role, minimum)) redirect(landingPathFor(user.role))
  return user
}

export async function requireCsrf(formData: FormData): Promise<void> {
  const store = await cookies()
  const cookieValue = store.get(CSRF_COOKIE)?.value
  if (!verifyCsrfToken(cookieValue, formData.get('csrf'))) {
    throw new Error('Invalid CSRF token')
  }
}
```

- [ ] **Step 6: Verify it typechecks**

Run: `npm run typecheck`
Expected: zero errors.

- [ ] **Step 7: Commit**

```bash
git add src/lib/auth/csrf.ts src/lib/auth/guard.ts tests/unit/csrf.test.ts
git commit -m "feat: request guard and CSRF double-submit"
```

---

## Task 12: Admin login and logout

**Files:**
- Create: `src/lib/validation/admin.ts`, `src/lib/auth/login.ts`, `src/app/admin/login/page.tsx`, `src/app/admin/login/actions.ts`, `src/components/admin/field.tsx`
- Test: `tests/integration/login.test.ts`

**Interfaces:**
- Consumes: `verifyPassword` (Task 5), `createSession`/`destroySession` (Task 7), rate-limit functions (Task 8), `writeAudit` (Task 9), `landingPathFor` (Task 6)
- Produces:
  - `src/lib/validation/admin.ts` — `loginSchema` (`{ email: string; password: string }`)
  - `src/lib/auth/login.ts` — `attemptLogin(db, input, meta): Promise<LoginResult>` where `LoginResult` is `{ ok: true; user: SessionUser; token: string; expiresAt: Date }` or `{ ok: false; reason: 'INVALID' | 'LOCKED_OUT' | 'INACTIVE' }`
  - `src/components/admin/field.tsx` — `<Field label name type defaultValue required error />`

- [ ] **Step 1: Write the failing test**

`tests/integration/login.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { testDb, resetDb } from '../helpers/db'
import { attemptLogin } from '@/lib/auth/login'
import { hashPassword } from '@/lib/crypto/password'
import { resolveSession } from '@/lib/auth/session'
import { MAX_ATTEMPTS } from '@/lib/auth/rate-limit'

const PASSWORD = 'correct horse battery'

beforeEach(resetDb)
afterAll(() => testDb.$disconnect())

async function seedUser(overrides: Record<string, unknown> = {}) {
  return testDb.adminUser.create({
    data: {
      email: 'ada@example.com',
      name: 'Ada',
      passwordHash: await hashPassword(PASSWORD),
      role: 'ADMIN',
      ...overrides,
    },
  })
}

describe('attemptLogin', () => {
  it('succeeds with correct credentials and returns a usable session', async () => {
    const user = await seedUser()
    const result = await attemptLogin(testDb, { email: 'ada@example.com', password: PASSWORD }, {})
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.user.id).toBe(user.id)
    expect(await resolveSession(testDb, result.token)).toMatchObject({ id: user.id })
  })

  it('matches email case-insensitively', async () => {
    await seedUser()
    const result = await attemptLogin(testDb, { email: 'ADA@Example.com', password: PASSWORD }, {})
    expect(result.ok).toBe(true)
  })

  it('rejects a wrong password', async () => {
    await seedUser()
    const result = await attemptLogin(testDb, { email: 'ada@example.com', password: 'nope-nope-nope' }, {})
    expect(result).toEqual({ ok: false, reason: 'INVALID' })
  })

  it('reports INVALID — not a distinct reason — for an unknown email', async () => {
    const result = await attemptLogin(testDb, { email: 'ghost@example.com', password: PASSWORD }, {})
    expect(result).toEqual({ ok: false, reason: 'INVALID' })
  })

  it('rejects a deactivated user', async () => {
    await seedUser({ isActive: false })
    const result = await attemptLogin(testDb, { email: 'ada@example.com', password: PASSWORD }, {})
    expect(result).toEqual({ ok: false, reason: 'INACTIVE' })
  })

  it('locks out after too many failures', async () => {
    await seedUser()
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      await attemptLogin(testDb, { email: 'ada@example.com', password: 'wrong-wrong-wrong' }, {})
    }
    const result = await attemptLogin(testDb, { email: 'ada@example.com', password: PASSWORD }, {})
    expect(result).toEqual({ ok: false, reason: 'LOCKED_OUT' })
  })

  it('clears the failure counter on success', async () => {
    await seedUser()
    await attemptLogin(testDb, { email: 'ada@example.com', password: 'wrong-wrong-wrong' }, {})
    await attemptLogin(testDb, { email: 'ada@example.com', password: PASSWORD }, {})
    const failures = await testDb.loginAttempt.count({ where: { succeeded: false } })
    expect(failures).toBe(0)
  })

  it('stamps lastLoginAt and audits the login', async () => {
    const user = await seedUser()
    await attemptLogin(testDb, { email: 'ada@example.com', password: PASSWORD }, { ip: '9.9.9.9' })
    const fresh = await testDb.adminUser.findUniqueOrThrow({ where: { id: user.id } })
    expect(fresh.lastLoginAt).not.toBeNull()
    const log = await testDb.auditLog.findFirst({ where: { action: 'auth.login' } })
    expect(log?.actorId).toBe(user.id)
  })

  it('never writes the password into the audit meta', async () => {
    await seedUser()
    await attemptLogin(testDb, { email: 'ada@example.com', password: PASSWORD }, {})
    const logs = await testDb.auditLog.findMany()
    expect(JSON.stringify(logs)).not.toContain(PASSWORD)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/integration/login.test.ts`
Expected: FAIL — cannot resolve `@/lib/auth/login`.

- [ ] **Step 3: Implement the validation schema and login logic**

`src/lib/validation/admin.ts`:

```ts
import { z } from 'zod'
import { MIN_PASSWORD_LENGTH } from '@/lib/crypto/password'

export const loginSchema = z.object({
  email: z.string().trim().email('Enter a valid email address'),
  password: z.string().min(1, 'Enter your password'),
})

export const createAdminSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address'),
  name: z.string().trim().min(1, 'Name is required').max(120),
  role: z.enum(['OWNER', 'ADMIN', 'STAFF']),
  password: z
    .string()
    .min(MIN_PASSWORD_LENGTH, `Password must be at least ${MIN_PASSWORD_LENGTH} characters`),
})

export const updateAdminRoleSchema = z.object({
  userId: z.string().min(1),
  role: z.enum(['OWNER', 'ADMIN', 'STAFF']),
})

export const setAdminActiveSchema = z.object({
  userId: z.string().min(1),
  isActive: z.coerce.boolean(),
})

export const resetAdminPasswordSchema = z.object({
  userId: z.string().min(1),
  password: z
    .string()
    .min(MIN_PASSWORD_LENGTH, `Password must be at least ${MIN_PASSWORD_LENGTH} characters`),
})
```

`src/lib/auth/login.ts`:

```ts
import type { PrismaClient } from '@prisma/client'
import { verifyPassword } from '@/lib/crypto/password'
import { writeAudit } from '@/lib/audit'
import { createSession, type SessionMeta, type SessionUser } from './session'
import { isLockedOut, recordLoginAttempt, clearAttempts } from './rate-limit'
import type { Role } from './roles'

export type LoginInput = { email: string; password: string }

export type LoginResult =
  | { ok: true; user: SessionUser; token: string; expiresAt: Date }
  | { ok: false; reason: 'INVALID' | 'LOCKED_OUT' | 'INACTIVE' }

export async function attemptLogin(
  db: PrismaClient,
  input: LoginInput,
  meta: SessionMeta,
): Promise<LoginResult> {
  const email = input.email.trim().toLowerCase()

  if (await isLockedOut(db, email)) {
    await recordLoginAttempt(db, { email, succeeded: false, ip: meta.ip })
    return { ok: false, reason: 'LOCKED_OUT' }
  }

  const user = await db.adminUser.findUnique({ where: { email } })

  // Hash-compare even when the user is missing so timing does not reveal
  // whether an account exists.
  const passwordOk = user
    ? await verifyPassword(user.passwordHash, input.password)
    : await verifyPassword('$argon2id$v=19$m=19456,t=2,p=1$aaaaaaaaaaaaaaaa$aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', input.password)

  if (!user || !passwordOk) {
    await recordLoginAttempt(db, { email, succeeded: false, ip: meta.ip })
    return { ok: false, reason: 'INVALID' }
  }

  if (!user.isActive) {
    await recordLoginAttempt(db, { email, succeeded: false, ip: meta.ip })
    return { ok: false, reason: 'INACTIVE' }
  }

  await clearAttempts(db, email)
  await recordLoginAttempt(db, { email, succeeded: true, ip: meta.ip })
  await db.adminUser.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } })
  await writeAudit(db, {
    actorId: user.id,
    action: 'auth.login',
    entity: 'AdminUser',
    entityId: user.id,
    ip: meta.ip ?? null,
  })

  const { token, expiresAt } = await createSession(db, user.id, meta)
  return {
    ok: true,
    token,
    expiresAt,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role as Role,
      mustChangePassword: user.mustChangePassword,
    },
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/integration/login.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Build the login page and its action**

`src/components/admin/field.tsx`:

```tsx
export function Field(props: {
  label: string
  name: string
  type?: string
  defaultValue?: string
  required?: boolean
  autoComplete?: string
}) {
  const { label, name, type = 'text', defaultValue, required, autoComplete } = props
  return (
    <label className="block">
      <span className="mb-1 block text-sm text-[var(--color-text-muted)]">{label}</span>
      <input
        className="w-full rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-[var(--color-text)] outline-none focus:border-[var(--color-brass)]"
        name={name}
        type={type}
        defaultValue={defaultValue}
        required={required}
        autoComplete={autoComplete}
      />
    </label>
  )
}
```

`src/app/admin/login/actions.ts`:

```ts
'use server'

import { cookies, headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/db'
import { attemptLogin } from '@/lib/auth/login'
import { loginSchema } from '@/lib/validation/admin'
import { SESSION_COOKIE, destroySession } from '@/lib/auth/session'
import { landingPathFor } from '@/lib/auth/roles'
import { CSRF_COOKIE, verifyCsrfToken } from '@/lib/auth/csrf'

const MESSAGES: Record<string, string> = {
  INVALID: 'Email or password is incorrect.',
  LOCKED_OUT: 'Too many attempts. Try again in 15 minutes.',
  INACTIVE: 'This account has been deactivated.',
}

export async function loginAction(_prev: string | null, formData: FormData): Promise<string | null> {
  const store = await cookies()
  if (!verifyCsrfToken(store.get(CSRF_COOKIE)?.value, formData.get('csrf'))) {
    return 'Your session expired. Reload the page and try again.'
  }

  const parsed = loginSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  })
  if (!parsed.success) return 'Enter a valid email address and password.'

  const headerList = await headers()
  const result = await attemptLogin(prisma, parsed.data, {
    ip: headerList.get('x-forwarded-for')?.split(',')[0]?.trim(),
    userAgent: headerList.get('user-agent') ?? undefined,
  })

  if (!result.ok) return MESSAGES[result.reason] ?? MESSAGES.INVALID!

  store.set(SESSION_COOKIE, result.token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    expires: result.expiresAt,
  })
  redirect(landingPathFor(result.user.role))
}

export async function logoutAction(): Promise<void> {
  const store = await cookies()
  const token = store.get(SESSION_COOKIE)?.value
  if (token) await destroySession(prisma, token)
  store.delete(SESSION_COOKIE)
  redirect('/admin/login')
}
```

`src/app/admin/login/page.tsx`:

```tsx
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { Field } from '@/components/admin/field'
import { CSRF_COOKIE, issueCsrfToken } from '@/lib/auth/csrf'
import { getCurrentUser } from '@/lib/auth/guard'
import { landingPathFor } from '@/lib/auth/roles'
import { LoginForm } from './login-form'

export default async function LoginPage() {
  const user = await getCurrentUser()
  if (user) redirect(landingPathFor(user.role))

  const store = await cookies()
  let csrf = store.get(CSRF_COOKIE)?.value
  if (!csrf) {
    csrf = issueCsrfToken()
    store.set(CSRF_COOKIE, csrf, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
    })
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6">
      <h1 className="mb-8 font-serif text-3xl text-[var(--color-brass)]">Gala Admin</h1>
      <LoginForm csrf={csrf}>
        <Field label="Email" name="email" type="email" required autoComplete="username" />
        <Field label="Password" name="password" type="password" required autoComplete="current-password" />
      </LoginForm>
    </main>
  )
}
```

`src/app/admin/login/login-form.tsx`:

```tsx
'use client'

import { useActionState } from 'react'
import { loginAction } from './actions'

export function LoginForm({ csrf, children }: { csrf: string; children: React.ReactNode }) {
  const [error, action, pending] = useActionState(loginAction, null)
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="csrf" value={csrf} />
      {children}
      {error ? (
        <p role="alert" className="text-sm text-[var(--color-danger)]">{error}</p>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded bg-[var(--color-brass)] px-4 py-2 font-medium text-[var(--color-ink-deep)] disabled:opacity-60"
      >
        {pending ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  )
}
```

Note: `login-form.tsx` is a fifth created file for this task; add it to the commit.

- [ ] **Step 6: Verify it typechecks and builds**

Run: `npm run typecheck && npm run build`
Expected: zero errors.

- [ ] **Step 7: Commit**

```bash
git add src/lib/validation/admin.ts src/lib/auth/login.ts src/components/admin/field.tsx \
        src/app/admin/login tests/integration/login.test.ts
git commit -m "feat: admin login and logout"
```

---

## Task 13: Admin shell and role-gated navigation

**Files:**
- Create: `src/app/admin/layout.tsx`, `src/app/admin/nav.tsx`, `src/app/admin/page.tsx`, `src/app/admin/checkin/page.tsx`
- Test: `tests/e2e/admin-access.spec.ts`, `tests/e2e/global-setup.ts`, `playwright.config.ts`

**Interfaces:**
- Consumes: `requireRole`, `getCurrentUser` (Task 11), `logoutAction` (Task 12), `hasRole` (Task 6)
- Produces: `NAV_ITEMS: { href: string; label: string; minRole: Role }[]` exported from `src/app/admin/nav.tsx`.

The `checkin` page here is a placeholder that proves the STAFF route exists; the working scanner is built in Plan 4.

- [ ] **Step 1: Create the Playwright config**

`playwright.config.ts`:

```ts
import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: process.env.APP_URL ?? 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: 'npm run build && npm start',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
})
```

- [ ] **Step 2: Write the failing E2E test**

`tests/e2e/admin-access.spec.ts`:

```ts
import { test, expect } from '@playwright/test'

test.describe('admin access control', () => {
  test('redirects an anonymous visitor from the dashboard to login', async ({ page }) => {
    await page.goto('/admin')
    await expect(page).toHaveURL(/\/admin\/login/)
  })

  test('redirects an anonymous visitor from user management to login', async ({ page }) => {
    await page.goto('/admin/users')
    await expect(page).toHaveURL(/\/admin\/login/)
  })

  test('rejects bad credentials with a visible error', async ({ page }) => {
    await page.goto('/admin/login')
    await page.getByLabel('Email').fill('nobody@example.com')
    await page.getByLabel('Password').fill('definitely-wrong')
    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect(page.getByRole('alert')).toContainText('incorrect')
  })

  test('signs an owner in and shows the full navigation', async ({ page }) => {
    await page.goto('/admin/login')
    await page.getByLabel('Email').fill(process.env.ADMIN_SEED_EMAIL!)
    await page.getByLabel('Password').fill(process.env.ADMIN_SEED_PASSWORD!)
    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect(page).toHaveURL(/\/admin$/)
    await expect(page.getByRole('link', { name: 'Admin users' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Invites' })).toBeVisible()
  })

  test('signs out and blocks the dashboard again', async ({ page }) => {
    await page.goto('/admin/login')
    await page.getByLabel('Email').fill(process.env.ADMIN_SEED_EMAIL!)
    await page.getByLabel('Password').fill(process.env.ADMIN_SEED_PASSWORD!)
    await page.getByRole('button', { name: 'Sign in' }).click()
    await page.getByRole('button', { name: 'Sign out' }).click()
    await expect(page).toHaveURL(/\/admin\/login/)
    await page.goto('/admin')
    await expect(page).toHaveURL(/\/admin\/login/)
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm run test:e2e tests/e2e/admin-access.spec.ts`
Expected: FAIL — `/admin` 404s.

- [ ] **Step 4: Implement the shell**

`src/app/admin/nav.tsx`:

```tsx
import Link from 'next/link'
import { hasRole, type Role } from '@/lib/auth/roles'

export const NAV_ITEMS: { href: string; label: string; minRole: Role }[] = [
  { href: '/admin', label: 'Dashboard', minRole: 'ADMIN' },
  { href: '/admin/invites', label: 'Invites', minRole: 'ADMIN' },
  { href: '/admin/guests', label: 'Guests', minRole: 'ADMIN' },
  { href: '/admin/event', label: 'Event', minRole: 'ADMIN' },
  { href: '/admin/checkin', label: 'Check-in', minRole: 'STAFF' },
  { href: '/admin/users', label: 'Admin users', minRole: 'OWNER' },
  { href: '/admin/audit', label: 'Audit log', minRole: 'OWNER' },
]

export function AdminNav({ role }: { role: Role }) {
  return (
    <nav aria-label="Admin navigation" className="flex flex-wrap gap-1">
      {NAV_ITEMS.filter((item) => hasRole(role, item.minRole)).map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className="rounded px-3 py-1.5 text-sm text-[var(--color-text-muted)] hover:bg-[var(--color-surface)] hover:text-[var(--color-text)]"
        >
          {item.label}
        </Link>
      ))}
    </nav>
  )
}
```

`src/app/admin/layout.tsx`:

```tsx
import { getCurrentUser } from '@/lib/auth/guard'
import { logoutAction } from './login/actions'
import { AdminNav } from './nav'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser()

  // The login page is nested under /admin but must render without a shell.
  if (!user) return <>{children}</>

  return (
    <div className="min-h-screen">
      <header className="border-b border-[var(--color-border)] px-4 py-3">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3">
          <span className="font-serif text-lg text-[var(--color-brass)]">Gala Admin</span>
          <AdminNav role={user.role} />
          <form action={logoutAction}>
            <span className="mr-3 text-sm text-[var(--color-text-muted)]">{user.name}</span>
            <button type="submit" className="text-sm underline underline-offset-4">
              Sign out
            </button>
          </form>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
    </div>
  )
}
```

`src/app/admin/page.tsx`:

```tsx
import { requireRole } from '@/lib/auth/guard'

export default async function AdminDashboard() {
  const user = await requireRole('ADMIN')
  return (
    <section>
      <h1 className="font-serif text-2xl">Dashboard</h1>
      <p className="mt-2 text-[var(--color-text-muted)]">
        Signed in as {user.email}. Live counts arrive in a later phase.
      </p>
    </section>
  )
}
```

`src/app/admin/checkin/page.tsx`:

```tsx
import { requireRole } from '@/lib/auth/guard'

export default async function CheckinPage() {
  await requireRole('STAFF')
  return (
    <section>
      <h1 className="font-serif text-2xl">Check-in</h1>
      <p className="mt-2 text-[var(--color-text-muted)]">Scanner arrives in a later phase.</p>
    </section>
  )
}
```

- [ ] **Step 5: Create the E2E owner fixture**

Every E2E spec needs an OWNER to sign in as. Creating it in Playwright's global
setup keeps the tests independent of the seed script (Task 22), which serves
development and production rather than tests.

`tests/e2e/global-setup.ts`:

```ts
import { config } from 'dotenv'
import { PrismaClient } from '@prisma/client'
import { hashPassword } from '../../src/lib/crypto/password'

config({ path: '.env' })

export default async function globalSetup(): Promise<void> {
  const email = process.env.ADMIN_SEED_EMAIL
  const password = process.env.ADMIN_SEED_PASSWORD
  if (!email || !password) {
    throw new Error('ADMIN_SEED_EMAIL and ADMIN_SEED_PASSWORD are required for E2E tests')
  }

  const prisma = new PrismaClient()
  try {
    const passwordHash = await hashPassword(password)
    await prisma.adminUser.upsert({
      where: { email: email.toLowerCase() },
      update: { passwordHash, role: 'OWNER', isActive: true },
      create: { email: email.toLowerCase(), name: 'E2E Owner', role: 'OWNER', passwordHash },
    })
  } finally {
    await prisma.$disconnect()
  }
}
```

Register it by adding one line inside `defineConfig` in `playwright.config.ts`:

```ts
  globalSetup: './tests/e2e/global-setup.ts',
```

- [ ] **Step 6: Run the E2E test**

Run: `npm run test:e2e tests/e2e/admin-access.spec.ts`
Expected: PASS, 5 tests × 2 projects.

- [ ] **Step 7: Commit**

```bash
git add playwright.config.ts src/app/admin/layout.tsx src/app/admin/nav.tsx \
        src/app/admin/page.tsx src/app/admin/checkin tests/e2e/global-setup.ts tests/e2e/admin-access.spec.ts
git commit -m "feat: admin shell with role-gated navigation"
```

---

## Task 14: Admin user repository with last-owner protection

**Files:**
- Create: `src/lib/admin-users/repository.ts`
- Test: `tests/integration/admin-users.test.ts`

**Interfaces:**
- Consumes: `hashPassword` (Task 5), `writeAudit` (Task 9), `Role` (Task 6)
- Produces:
  - `listAdminUsers(db): Promise<AdminUserRow[]>` — `AdminUserRow` is `{ id, email, name, role, isActive, lastLoginAt, createdAt }`
  - `createAdminUser(db, actorId, input): Promise<AdminUserRow>` — input `{ email, name, role, password }`
  - `updateAdminRole(db, actorId, userId, role): Promise<void>`
  - `setAdminActive(db, actorId, userId, isActive): Promise<void>`
  - `resetAdminPassword(db, actorId, userId, password): Promise<void>`
  - `LastOwnerError` — thrown when an operation would remove the final active OWNER
  - `DuplicateEmailError` — thrown on an email collision

- [ ] **Step 1: Write the failing test**

`tests/integration/admin-users.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { testDb, resetDb } from '../helpers/db'
import {
  listAdminUsers, createAdminUser, updateAdminRole, setAdminActive,
  resetAdminPassword, LastOwnerError, DuplicateEmailError,
} from '@/lib/admin-users/repository'
import { verifyPassword } from '@/lib/crypto/password'

const PASSWORD = 'correct horse battery'

beforeEach(resetDb)
afterAll(() => testDb.$disconnect())

async function seedOwner() {
  return createAdminUser(testDb, null, {
    email: 'owner@example.com', name: 'Owner', role: 'OWNER', password: PASSWORD,
  })
}

describe('admin user repository', () => {
  it('creates a user and normalizes the email', async () => {
    const user = await createAdminUser(testDb, null, {
      email: 'Ada@Example.COM', name: 'Ada', role: 'ADMIN', password: PASSWORD,
    })
    expect(user.email).toBe('ada@example.com')
  })

  it('never returns the password hash', async () => {
    const user = await createAdminUser(testDb, null, {
      email: 'ada@example.com', name: 'Ada', role: 'ADMIN', password: PASSWORD,
    })
    expect(user).not.toHaveProperty('passwordHash')
  })

  it('stores a verifiable hash', async () => {
    await createAdminUser(testDb, null, {
      email: 'ada@example.com', name: 'Ada', role: 'ADMIN', password: PASSWORD,
    })
    const row = await testDb.adminUser.findUniqueOrThrow({ where: { email: 'ada@example.com' } })
    expect(await verifyPassword(row.passwordHash, PASSWORD)).toBe(true)
  })

  it('rejects a duplicate email', async () => {
    await createAdminUser(testDb, null, {
      email: 'ada@example.com', name: 'Ada', role: 'ADMIN', password: PASSWORD,
    })
    await expect(
      createAdminUser(testDb, null, {
        email: 'ADA@example.com', name: 'Other', role: 'STAFF', password: PASSWORD,
      }),
    ).rejects.toBeInstanceOf(DuplicateEmailError)
  })

  it('lists users newest first', async () => {
    await seedOwner()
    await createAdminUser(testDb, null, {
      email: 'ada@example.com', name: 'Ada', role: 'ADMIN', password: PASSWORD,
    })
    const list = await listAdminUsers(testDb)
    expect(list.map((u) => u.email)).toEqual(['ada@example.com', 'owner@example.com'])
  })

  it('refuses to demote the last owner', async () => {
    const owner = await seedOwner()
    await expect(updateAdminRole(testDb, owner.id, owner.id, 'ADMIN'))
      .rejects.toBeInstanceOf(LastOwnerError)
  })

  it('refuses to deactivate the last owner', async () => {
    const owner = await seedOwner()
    await expect(setAdminActive(testDb, owner.id, owner.id, false))
      .rejects.toBeInstanceOf(LastOwnerError)
  })

  it('allows demoting an owner when another active owner exists', async () => {
    const first = await seedOwner()
    const second = await createAdminUser(testDb, first.id, {
      email: 'two@example.com', name: 'Two', role: 'OWNER', password: PASSWORD,
    })
    await updateAdminRole(testDb, first.id, second.id, 'ADMIN')
    const row = await testDb.adminUser.findUniqueOrThrow({ where: { id: second.id } })
    expect(row.role).toBe('ADMIN')
  })

  it('does not count an inactive owner as a remaining owner', async () => {
    const first = await seedOwner()
    const second = await createAdminUser(testDb, first.id, {
      email: 'two@example.com', name: 'Two', role: 'OWNER', password: PASSWORD,
    })
    await setAdminActive(testDb, first.id, second.id, false)
    await expect(updateAdminRole(testDb, first.id, first.id, 'ADMIN'))
      .rejects.toBeInstanceOf(LastOwnerError)
  })

  it('revokes sessions when a user is deactivated', async () => {
    const owner = await seedOwner()
    const ada = await createAdminUser(testDb, owner.id, {
      email: 'ada@example.com', name: 'Ada', role: 'ADMIN', password: PASSWORD,
    })
    await testDb.adminSession.create({
      data: { tokenHash: 'h', userId: ada.id, expiresAt: new Date(Date.now() + 60_000) },
    })
    await setAdminActive(testDb, owner.id, ada.id, false)
    expect(await testDb.adminSession.count({ where: { userId: ada.id } })).toBe(0)
  })

  it('resets a password, forces a change, and revokes sessions', async () => {
    const owner = await seedOwner()
    const ada = await createAdminUser(testDb, owner.id, {
      email: 'ada@example.com', name: 'Ada', role: 'ADMIN', password: PASSWORD,
    })
    await testDb.adminSession.create({
      data: { tokenHash: 'h2', userId: ada.id, expiresAt: new Date(Date.now() + 60_000) },
    })
    await resetAdminPassword(testDb, owner.id, ada.id, 'brand new password')
    const row = await testDb.adminUser.findUniqueOrThrow({ where: { id: ada.id } })
    expect(await verifyPassword(row.passwordHash, 'brand new password')).toBe(true)
    expect(row.mustChangePassword).toBe(true)
    expect(await testDb.adminSession.count({ where: { userId: ada.id } })).toBe(0)
  })

  it('audits every mutation', async () => {
    const owner = await seedOwner()
    const ada = await createAdminUser(testDb, owner.id, {
      email: 'ada@example.com', name: 'Ada', role: 'ADMIN', password: PASSWORD,
    })
    await updateAdminRole(testDb, owner.id, ada.id, 'STAFF')
    await setAdminActive(testDb, owner.id, ada.id, false)
    const actions = (await testDb.auditLog.findMany({ orderBy: { createdAt: 'asc' } }))
      .map((l) => l.action)
    expect(actions).toContain('adminUser.create')
    expect(actions).toContain('adminUser.updateRole')
    expect(actions).toContain('adminUser.setActive')
  })

  it('never writes a password into audit meta', async () => {
    const owner = await seedOwner()
    await createAdminUser(testDb, owner.id, {
      email: 'ada@example.com', name: 'Ada', role: 'ADMIN', password: PASSWORD,
    })
    const logs = await testDb.auditLog.findMany()
    expect(JSON.stringify(logs)).not.toContain(PASSWORD)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/integration/admin-users.test.ts`
Expected: FAIL — cannot resolve `@/lib/admin-users/repository`.

- [ ] **Step 3: Implement `src/lib/admin-users/repository.ts`**

```ts
import type { PrismaClient, Prisma } from '@prisma/client'
import { hashPassword } from '@/lib/crypto/password'
import { writeAudit } from '@/lib/audit'
import type { Role } from '@/lib/auth/roles'

export class LastOwnerError extends Error {
  constructor() {
    super('The last active owner cannot be removed, demoted, or deactivated')
    this.name = 'LastOwnerError'
  }
}

export class DuplicateEmailError extends Error {
  constructor(email: string) {
    super(`An admin with the email ${email} already exists`)
    this.name = 'DuplicateEmailError'
  }
}

export type AdminUserRow = {
  id: string
  email: string
  name: string
  role: Role
  isActive: boolean
  lastLoginAt: Date | null
  createdAt: Date
}

const SELECT = {
  id: true, email: true, name: true, role: true,
  isActive: true, lastLoginAt: true, createdAt: true,
} satisfies Prisma.AdminUserSelect

export type CreateAdminInput = {
  email: string
  name: string
  role: Role
  password: string
}

export async function listAdminUsers(db: PrismaClient): Promise<AdminUserRow[]> {
  const rows = await db.adminUser.findMany({ select: SELECT, orderBy: { createdAt: 'desc' } })
  return rows as AdminUserRow[]
}

export async function createAdminUser(
  db: PrismaClient,
  actorId: string | null,
  input: CreateAdminInput,
): Promise<AdminUserRow> {
  const email = input.email.trim().toLowerCase()
  const existing = await db.adminUser.findUnique({ where: { email }, select: { id: true } })
  if (existing) throw new DuplicateEmailError(email)

  const passwordHash = await hashPassword(input.password)

  return db.$transaction(async (tx) => {
    const user = await tx.adminUser.create({
      data: { email, name: input.name.trim(), role: input.role, passwordHash },
      select: SELECT,
    })
    await writeAudit(tx, {
      actorId,
      action: 'adminUser.create',
      entity: 'AdminUser',
      entityId: user.id,
      meta: { email, role: input.role },
    })
    return user as AdminUserRow
  })
}

/** Counts active owners excluding one user, to test whether a change strands the account. */
async function activeOwnersExcluding(tx: Prisma.TransactionClient, userId: string): Promise<number> {
  return tx.adminUser.count({
    where: { role: 'OWNER', isActive: true, id: { not: userId } },
  })
}

export async function updateAdminRole(
  db: PrismaClient,
  actorId: string | null,
  userId: string,
  role: Role,
): Promise<void> {
  await db.$transaction(async (tx) => {
    const user = await tx.adminUser.findUniqueOrThrow({
      where: { id: userId },
      select: { role: true, isActive: true },
    })
    const losingOwner = user.role === 'OWNER' && user.isActive && role !== 'OWNER'
    if (losingOwner && (await activeOwnersExcluding(tx, userId)) === 0) throw new LastOwnerError()

    await tx.adminUser.update({ where: { id: userId }, data: { role } })
    await writeAudit(tx, {
      actorId,
      action: 'adminUser.updateRole',
      entity: 'AdminUser',
      entityId: userId,
      meta: { from: user.role, to: role },
    })
  })
}

export async function setAdminActive(
  db: PrismaClient,
  actorId: string | null,
  userId: string,
  isActive: boolean,
): Promise<void> {
  await db.$transaction(async (tx) => {
    const user = await tx.adminUser.findUniqueOrThrow({
      where: { id: userId },
      select: { role: true, isActive: true },
    })
    const losingOwner = user.role === 'OWNER' && user.isActive && !isActive
    if (losingOwner && (await activeOwnersExcluding(tx, userId)) === 0) throw new LastOwnerError()

    await tx.adminUser.update({ where: { id: userId }, data: { isActive } })
    if (!isActive) await tx.adminSession.deleteMany({ where: { userId } })
    await writeAudit(tx, {
      actorId,
      action: 'adminUser.setActive',
      entity: 'AdminUser',
      entityId: userId,
      meta: { isActive },
    })
  })
}

export async function resetAdminPassword(
  db: PrismaClient,
  actorId: string | null,
  userId: string,
  password: string,
): Promise<void> {
  const passwordHash = await hashPassword(password)
  await db.$transaction(async (tx) => {
    await tx.adminUser.update({
      where: { id: userId },
      data: { passwordHash, mustChangePassword: true },
    })
    await tx.adminSession.deleteMany({ where: { userId } })
    await writeAudit(tx, {
      actorId,
      action: 'adminUser.resetPassword',
      entity: 'AdminUser',
      entityId: userId,
    })
  })
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/integration/admin-users.test.ts`
Expected: PASS, 13 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/admin-users/repository.ts tests/integration/admin-users.test.ts
git commit -m "feat: admin user repository with last-owner protection"
```

---

## Task 15: Admin user management screen

**Files:**
- Create: `src/app/admin/users/page.tsx`, `src/app/admin/users/actions.ts`, `src/components/admin/csrf-input.tsx`, `src/components/admin/table.tsx`
- Test: `tests/e2e/admin-users.spec.ts`

**Interfaces:**
- Consumes: repository functions and error classes (Task 14), `requireRole`/`requireCsrf` (Task 11), Zod schemas (Task 12)
- Produces:
  - `src/components/admin/csrf-input.tsx` — `<CsrfInput />`, an async server component that issues the cookie when absent and renders the hidden field
  - `src/components/admin/table.tsx` — `<Table headers={string[]}>`, `<Th>`, `<Td>`
  - `src/app/admin/users/actions.ts` — `createUserAction`, `changeRoleAction`, `toggleActiveAction`, `resetPasswordAction`, each `(formData: FormData) => Promise<void>`

- [ ] **Step 1: Write the failing E2E test**

`tests/e2e/admin-users.spec.ts`:

```ts
import { test, expect } from '@playwright/test'

async function signInAsOwner(page: import('@playwright/test').Page) {
  await page.goto('/admin/login')
  await page.getByLabel('Email').fill(process.env.ADMIN_SEED_EMAIL!)
  await page.getByLabel('Password').fill(process.env.ADMIN_SEED_PASSWORD!)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(/\/admin$/)
}

test.describe('admin user management', () => {
  test('creates an admin and lists them', async ({ page }) => {
    await signInAsOwner(page)
    await page.getByRole('link', { name: 'Admin users' }).click()

    const email = `staff-${Date.now()}@example.com`
    await page.getByLabel('Email').fill(email)
    await page.getByLabel('Name').fill('Door Staff')
    await page.getByLabel('Role').selectOption('STAFF')
    await page.getByLabel('Temporary password').fill('temporary password 1')
    await page.getByRole('button', { name: 'Create admin' }).click()

    await expect(page.getByRole('cell', { name: email })).toBeVisible()
  })

  test('rejects a duplicate email with a visible message', async ({ page }) => {
    await signInAsOwner(page)
    await page.goto('/admin/users')
    await page.getByLabel('Email').fill(process.env.ADMIN_SEED_EMAIL!)
    await page.getByLabel('Name').fill('Duplicate')
    await page.getByLabel('Role').selectOption('ADMIN')
    await page.getByLabel('Temporary password').fill('temporary password 1')
    await page.getByRole('button', { name: 'Create admin' }).click()
    await expect(page.getByRole('alert')).toContainText('already exists')
  })

  test('refuses to demote the last owner', async ({ page }) => {
    await signInAsOwner(page)
    await page.goto('/admin/users')
    const row = page.getByRole('row', { name: new RegExp(process.env.ADMIN_SEED_EMAIL!) })
    await row.getByLabel('Role').selectOption('ADMIN')
    await row.getByRole('button', { name: 'Save role' }).click()
    await expect(page.getByRole('alert')).toContainText('last active owner')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:e2e tests/e2e/admin-users.spec.ts`
Expected: FAIL — `/admin/users` 404s.

- [ ] **Step 3: Create the shared components**

`src/components/admin/csrf-input.tsx`:

```tsx
import { cookies } from 'next/headers'
import { CSRF_COOKIE, issueCsrfToken } from '@/lib/auth/csrf'

export async function CsrfInput() {
  const store = await cookies()
  let token = store.get(CSRF_COOKIE)?.value
  if (!token) {
    token = issueCsrfToken()
    store.set(CSRF_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
    })
  }
  return <input type="hidden" name="csrf" value={token} />
}
```

`src/components/admin/table.tsx`:

```tsx
export function Table({ headers, children }: { headers: string[]; children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[40rem] border-collapse text-sm">
        <thead>
          <tr className="border-b border-[var(--color-border)] text-left">
            {headers.map((h) => (
              <th key={h} scope="col" className="px-3 py-2 font-medium text-[var(--color-text-muted)]">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  )
}

export function Td({ children }: { children: React.ReactNode }) {
  return <td className="border-b border-[var(--color-border)] px-3 py-2 align-middle">{children}</td>
}
```

- [ ] **Step 4: Implement the actions**

`src/app/admin/users/actions.ts`:

```ts
'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/db'
import { requireCsrf, requireRole } from '@/lib/auth/guard'
import {
  createAdminUser, updateAdminRole, setAdminActive, resetAdminPassword,
  LastOwnerError, DuplicateEmailError,
} from '@/lib/admin-users/repository'
import {
  createAdminSchema, updateAdminRoleSchema, setAdminActiveSchema, resetAdminPasswordSchema,
} from '@/lib/validation/admin'

function fail(message: string): never {
  redirect(`/admin/users?error=${encodeURIComponent(message)}`)
}

function describe(error: unknown): string {
  if (error instanceof LastOwnerError || error instanceof DuplicateEmailError) return error.message
  return 'Something went wrong. Try again.'
}

export async function createUserAction(formData: FormData): Promise<void> {
  const actor = await requireRole('OWNER')
  await requireCsrf(formData)

  const parsed = createAdminSchema.safeParse({
    email: formData.get('email'),
    name: formData.get('name'),
    role: formData.get('role'),
    password: formData.get('password'),
  })
  if (!parsed.success) fail(parsed.error.issues[0]?.message ?? 'Invalid input')

  try {
    await createAdminUser(prisma, actor.id, parsed.data)
  } catch (error) {
    fail(describe(error))
  }
  revalidatePath('/admin/users')
}

export async function changeRoleAction(formData: FormData): Promise<void> {
  const actor = await requireRole('OWNER')
  await requireCsrf(formData)

  const parsed = updateAdminRoleSchema.safeParse({
    userId: formData.get('userId'),
    role: formData.get('role'),
  })
  if (!parsed.success) fail('Invalid role change')

  try {
    await updateAdminRole(prisma, actor.id, parsed.data.userId, parsed.data.role)
  } catch (error) {
    fail(describe(error))
  }
  revalidatePath('/admin/users')
}

export async function toggleActiveAction(formData: FormData): Promise<void> {
  const actor = await requireRole('OWNER')
  await requireCsrf(formData)

  const parsed = setAdminActiveSchema.safeParse({
    userId: formData.get('userId'),
    isActive: formData.get('isActive') === 'true',
  })
  if (!parsed.success) fail('Invalid request')

  try {
    await setAdminActive(prisma, actor.id, parsed.data.userId, parsed.data.isActive)
  } catch (error) {
    fail(describe(error))
  }
  revalidatePath('/admin/users')
}

export async function resetPasswordAction(formData: FormData): Promise<void> {
  const actor = await requireRole('OWNER')
  await requireCsrf(formData)

  const parsed = resetAdminPasswordSchema.safeParse({
    userId: formData.get('userId'),
    password: formData.get('password'),
  })
  if (!parsed.success) fail(parsed.error.issues[0]?.message ?? 'Invalid password')

  try {
    await resetAdminPassword(prisma, actor.id, parsed.data.userId, parsed.data.password)
  } catch (error) {
    fail(describe(error))
  }
  revalidatePath('/admin/users')
}
```

- [ ] **Step 5: Implement the page**

`src/app/admin/users/page.tsx`:

```tsx
import { prisma } from '@/lib/db'
import { requireRole } from '@/lib/auth/guard'
import { listAdminUsers } from '@/lib/admin-users/repository'
import { CsrfInput } from '@/components/admin/csrf-input'
import { Field } from '@/components/admin/field'
import { Table, Td } from '@/components/admin/table'
import { createUserAction, changeRoleAction, toggleActiveAction } from './actions'

const ROLES = ['OWNER', 'ADMIN', 'STAFF'] as const

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  await requireRole('OWNER')
  const { error } = await searchParams
  const users = await listAdminUsers(prisma)

  return (
    <section className="space-y-8">
      <h1 className="font-serif text-2xl">Admin users</h1>

      {error ? (
        <p role="alert" className="rounded border border-[var(--color-danger)] px-3 py-2 text-sm text-[var(--color-danger)]">
          {error}
        </p>
      ) : null}

      <form action={createUserAction} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <CsrfInput />
        <Field label="Email" name="email" type="email" required />
        <Field label="Name" name="name" required />
        <label className="block">
          <span className="mb-1 block text-sm text-[var(--color-text-muted)]">Role</span>
          <select
            name="role"
            defaultValue="ADMIN"
            className="w-full rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2"
          >
            {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </label>
        <Field label="Temporary password" name="password" type="password" required />
        <button
          type="submit"
          className="self-end rounded bg-[var(--color-brass)] px-4 py-2 font-medium text-[var(--color-ink-deep)]"
        >
          Create admin
        </button>
      </form>

      <Table headers={['Email', 'Name', 'Role', 'Status', 'Last sign-in', '']}>
        {users.map((user) => (
          <tr key={user.id}>
            <Td>{user.email}</Td>
            <Td>{user.name}</Td>
            <Td>
              <form action={changeRoleAction} className="flex items-center gap-2">
                <CsrfInput />
                <input type="hidden" name="userId" value={user.id} />
                <label className="sr-only" htmlFor={`role-${user.id}`}>Role</label>
                <select
                  id={`role-${user.id}`}
                  name="role"
                  defaultValue={user.role}
                  aria-label="Role"
                  className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1"
                >
                  {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
                <button type="submit" className="text-xs underline underline-offset-4">
                  Save role
                </button>
              </form>
            </Td>
            <Td>{user.isActive ? 'Active' : 'Deactivated'}</Td>
            <Td>{user.lastLoginAt ? user.lastLoginAt.toISOString().slice(0, 16).replace('T', ' ') : '—'}</Td>
            <Td>
              <form action={toggleActiveAction}>
                <CsrfInput />
                <input type="hidden" name="userId" value={user.id} />
                <input type="hidden" name="isActive" value={user.isActive ? 'false' : 'true'} />
                <button type="submit" className="text-xs underline underline-offset-4">
                  {user.isActive ? 'Deactivate' : 'Reactivate'}
                </button>
              </form>
            </Td>
          </tr>
        ))}
      </Table>
    </section>
  )
}
```

- [ ] **Step 6: Run the E2E test**

Run: `npm run test:e2e tests/e2e/admin-users.spec.ts`
Expected: PASS, 3 tests × 2 projects.

- [ ] **Step 7: Commit**

```bash
git add src/app/admin/users src/components/admin/csrf-input.tsx \
        src/components/admin/table.tsx tests/e2e/admin-users.spec.ts
git commit -m "feat: admin user management screen"
```

---

## Task 16: Invite and guest repository

**Files:**
- Create: `src/lib/invites/repository.ts`, `src/lib/validation/invites.ts`
- Test: `tests/integration/invites.test.ts`

**Interfaces:**
- Consumes: `generateInviteToken`/`hashToken` (Task 4), `deriveInviteStatus` (Task 10), `writeAudit` (Task 9)
- Produces:
  - `createInvite(db, actorId, input): Promise<{ invite: InviteRow; token: string }>` — input `{ label, seatsAllotted, tableNumber?, adminNotes?, primaryGuest: { firstName, lastName, email?, company?, title? } }`. The plaintext token is returned once and never persisted.
  - `listInvites(db, query): Promise<{ rows: InviteRow[]; total: number }>` — query `{ search?, status?, page?, pageSize? }`
  - `getInvite(db, id): Promise<InviteDetail | null>`
  - `updateInvite(db, actorId, id, patch): Promise<void>` — patch `{ label?, seatsAllotted?, tableNumber?, adminNotes? }`
  - `regenerateInviteToken(db, actorId, id): Promise<string>`
  - `deleteInvite(db, actorId, id): Promise<void>`
  - `resolveExtraSeats(db, actorId, id, decision: 'APPROVED' | 'DENIED'): Promise<void>`
  - `listInviteTokens(db, where?): Promise<{ id; label; token }[]>` — decrypts `tokenCipher` for QR export
  - `getInviteToken(db, id): Promise<string | null>`
  - `recomputeInviteStatus(tx, inviteId): Promise<void>`
  - `SeatLimitError` — thrown when guests would exceed `seatsAllotted`

- [ ] **Step 1: Write the failing test**

`tests/integration/invites.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { testDb, resetDb } from '../helpers/db'
import {
  createInvite, listInvites, getInvite, updateInvite,
  regenerateInviteToken, deleteInvite, resolveExtraSeats,
  recomputeInviteStatus, listInviteTokens, getInviteToken, SeatLimitError,
} from '@/lib/invites/repository'
import { hashToken } from '@/lib/crypto/tokens'

beforeEach(resetDb)
afterAll(() => testDb.$disconnect())

const base = {
  label: 'Reyes Party',
  seatsAllotted: 2,
  primaryGuest: { firstName: 'Jordan', lastName: 'Reyes', email: 'jordan@example.com' },
}

describe('invite repository', () => {
  it('creates an invite with a primary guest', async () => {
    const { invite } = await createInvite(testDb, null, base)
    expect(invite.label).toBe('Reyes Party')
    const guests = await testDb.guest.findMany({ where: { inviteId: invite.id } })
    expect(guests).toHaveLength(1)
    expect(guests[0]).toMatchObject({ firstName: 'Jordan', isPrimary: true })
  })

  it('returns a plaintext token that is stored only as a hash', async () => {
    const { invite, token } = await createInvite(testDb, null, base)
    const row = await testDb.invite.findUniqueOrThrow({ where: { id: invite.id } })
    expect(token).toMatch(/^[A-Za-z0-9_-]{32}$/)
    expect(row.tokenHash).toBe(hashToken(token))
  })

  it('never returns the token hash in the invite row', async () => {
    const { invite } = await createInvite(testDb, null, base)
    expect(invite).not.toHaveProperty('tokenHash')
  })

  it('starts every invite PENDING', async () => {
    const { invite } = await createInvite(testDb, null, base)
    expect(invite.status).toBe('PENDING')
  })

  it('searches by label case-insensitively', async () => {
    await createInvite(testDb, null, base)
    await createInvite(testDb, null, { ...base, label: 'Okafor Party' })
    const { rows, total } = await listInvites(testDb, { search: 'reyes' })
    expect(total).toBe(1)
    expect(rows[0]?.label).toBe('Reyes Party')
  })

  it('searches by primary guest name', async () => {
    await createInvite(testDb, null, base)
    const { total } = await listInvites(testDb, { search: 'jordan' })
    expect(total).toBe(1)
  })

  it('filters by status', async () => {
    const { invite } = await createInvite(testDb, null, base)
    await testDb.invite.update({ where: { id: invite.id }, data: { status: 'ATTENDING' } })
    await createInvite(testDb, null, { ...base, label: 'Second' })
    expect((await listInvites(testDb, { status: 'ATTENDING' })).total).toBe(1)
    expect((await listInvites(testDb, { status: 'PENDING' })).total).toBe(1)
  })

  it('paginates', async () => {
    for (let i = 0; i < 5; i++) {
      await createInvite(testDb, null, { ...base, label: `Party ${i}` })
    }
    const page = await listInvites(testDb, { page: 2, pageSize: 2 })
    expect(page.rows).toHaveLength(2)
    expect(page.total).toBe(5)
  })

  it('loads detail including guests', async () => {
    const { invite } = await createInvite(testDb, null, base)
    const detail = await getInvite(testDb, invite.id)
    expect(detail?.guests).toHaveLength(1)
  })

  it('returns null for an unknown invite', async () => {
    expect(await getInvite(testDb, 'missing')).toBeNull()
  })

  it('updates editable fields', async () => {
    const { invite } = await createInvite(testDb, null, base)
    await updateInvite(testDb, null, invite.id, { label: 'Renamed', tableNumber: '12' })
    const row = await testDb.invite.findUniqueOrThrow({ where: { id: invite.id } })
    expect(row.label).toBe('Renamed')
    expect(row.tableNumber).toBe('12')
  })

  it('refuses to shrink seats below the number of guests', async () => {
    const { invite } = await createInvite(testDb, null, base)
    await testDb.guest.create({
      data: { inviteId: invite.id, firstName: 'Sam', lastName: 'Reyes' },
    })
    await expect(updateInvite(testDb, null, invite.id, { seatsAllotted: 1 }))
      .rejects.toBeInstanceOf(SeatLimitError)
  })

  it('regenerates the token and invalidates the old one', async () => {
    const { invite, token } = await createInvite(testDb, null, base)
    const next = await regenerateInviteToken(testDb, null, invite.id)
    expect(next).not.toBe(token)
    const row = await testDb.invite.findUniqueOrThrow({ where: { id: invite.id } })
    expect(row.tokenHash).toBe(hashToken(next))
    expect(row.tokenHash).not.toBe(hashToken(token))
  })

  it('deletes an invite and its guests', async () => {
    const { invite } = await createInvite(testDb, null, base)
    await deleteInvite(testDb, null, invite.id)
    expect(await testDb.invite.count()).toBe(0)
    expect(await testDb.guest.count()).toBe(0)
  })

  it('approving extra seats raises the allowance', async () => {
    const { invite } = await createInvite(testDb, null, base)
    await testDb.invite.update({
      where: { id: invite.id },
      data: { extraSeatsRequested: 2, extraSeatsStatus: 'PENDING' },
    })
    await resolveExtraSeats(testDb, null, invite.id, 'APPROVED')
    const row = await testDb.invite.findUniqueOrThrow({ where: { id: invite.id } })
    expect(row.seatsAllotted).toBe(4)
    expect(row.extraSeatsStatus).toBe('APPROVED')
  })

  it('denying extra seats leaves the allowance alone', async () => {
    const { invite } = await createInvite(testDb, null, base)
    await testDb.invite.update({
      where: { id: invite.id },
      data: { extraSeatsRequested: 2, extraSeatsStatus: 'PENDING' },
    })
    await resolveExtraSeats(testDb, null, invite.id, 'DENIED')
    const row = await testDb.invite.findUniqueOrThrow({ where: { id: invite.id } })
    expect(row.seatsAllotted).toBe(2)
    expect(row.extraSeatsStatus).toBe('DENIED')
  })

  it('recomputes status from guest attendance', async () => {
    const { invite } = await createInvite(testDb, null, base)
    await testDb.guest.updateMany({ where: { inviteId: invite.id }, data: { attending: true } })
    await recomputeInviteStatus(testDb, invite.id)
    const row = await testDb.invite.findUniqueOrThrow({ where: { id: invite.id } })
    expect(row.status).toBe('ATTENDING')
  })

  it('audits creation, update, regeneration, and deletion', async () => {
    const { invite } = await createInvite(testDb, null, base)
    await updateInvite(testDb, null, invite.id, { label: 'Renamed' })
    await regenerateInviteToken(testDb, null, invite.id)
    await deleteInvite(testDb, null, invite.id)
    const actions = (await testDb.auditLog.findMany()).map((l) => l.action)
    expect(actions).toEqual(
      expect.arrayContaining([
        'invite.create', 'invite.update', 'invite.regenerateToken', 'invite.delete',
      ]),
    )
  })

  it('recovers the plaintext token for QR export', async () => {
    const { invite, token } = await createInvite(testDb, null, base)
    expect(await getInviteToken(testDb, invite.id)).toBe(token)
    const all = await listInviteTokens(testDb)
    expect(all).toEqual([{ id: invite.id, label: 'Reyes Party', token }])
  })

  it('recovers the new token after regeneration', async () => {
    const { invite } = await createInvite(testDb, null, base)
    const next = await regenerateInviteToken(testDb, null, invite.id)
    expect(await getInviteToken(testDb, invite.id)).toBe(next)
  })

  it('returns null when recovering an unknown invite', async () => {
    expect(await getInviteToken(testDb, 'missing')).toBeNull()
  })

  it('omits invites whose cipher cannot be opened rather than throwing', async () => {
    const { invite } = await createInvite(testDb, null, base)
    await testDb.invite.update({
      where: { id: invite.id },
      data: { tokenCipher: 'v1.aaaa.bbbb.cccc' },
    })
    await expect(listInviteTokens(testDb)).resolves.toEqual([])
  })

  it('stores the cipher, not the plaintext token', async () => {
    const { invite, token } = await createInvite(testDb, null, base)
    const row = await testDb.invite.findUniqueOrThrow({ where: { id: invite.id } })
    expect(row.tokenCipher).not.toContain(token)
    expect(row.tokenCipher.startsWith('v1.')).toBe(true)
  })

  it('never writes a plaintext token into audit meta', async () => {
    const { invite, token } = await createInvite(testDb, null, base)
    await regenerateInviteToken(testDb, null, invite.id)
    const logs = await testDb.auditLog.findMany()
    expect(JSON.stringify(logs)).not.toContain(token)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/integration/invites.test.ts`
Expected: FAIL — cannot resolve `@/lib/invites/repository`.

- [ ] **Step 3: Implement the validation schemas**

`src/lib/validation/invites.ts`:

```ts
import { z } from 'zod'

export const primaryGuestSchema = z.object({
  firstName: z.string().trim().min(1, 'First name is required').max(80),
  lastName: z.string().trim().min(1, 'Last name is required').max(80),
  email: z.string().trim().toLowerCase().email('Enter a valid email').optional().or(z.literal('')),
  company: z.string().trim().max(160).optional().or(z.literal('')),
  title: z.string().trim().max(160).optional().or(z.literal('')),
})

export const createInviteSchema = z.object({
  label: z.string().trim().min(1, 'Label is required').max(160),
  seatsAllotted: z.coerce.number().int().min(1, 'At least one seat').max(20),
  tableNumber: z.string().trim().max(20).optional().or(z.literal('')),
  adminNotes: z.string().trim().max(2000).optional().or(z.literal('')),
  primaryGuest: primaryGuestSchema,
})

export const updateInviteSchema = z.object({
  label: z.string().trim().min(1).max(160).optional(),
  seatsAllotted: z.coerce.number().int().min(1).max(20).optional(),
  tableNumber: z.string().trim().max(20).optional(),
  adminNotes: z.string().trim().max(2000).optional(),
})

export const inviteQuerySchema = z.object({
  search: z.string().trim().max(120).optional(),
  status: z.enum(['PENDING', 'ATTENDING', 'DECLINED', 'PARTIAL']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
})
```

- [ ] **Step 4: Implement `src/lib/invites/repository.ts`**

```ts
import type { PrismaClient, Prisma } from '@prisma/client'
import { generateInviteToken, hashToken } from '@/lib/crypto/tokens'
import { seal, open } from '@/lib/crypto/secret-box'
import { getEnv } from '@/lib/env'
import { deriveInviteStatus, type InviteStatus } from './status'
import { writeAudit, type AuditClient } from '@/lib/audit'

export class SeatLimitError extends Error {
  constructor(seats: number, guests: number) {
    super(`Cannot reduce to ${seats} seats — this invite already has ${guests} guests`)
    this.name = 'SeatLimitError'
  }
}

export type InviteRow = {
  id: string
  label: string
  seatsAllotted: number
  status: InviteStatus
  tableNumber: string | null
  extraSeatsRequested: number
  extraSeatsStatus: 'NONE' | 'PENDING' | 'APPROVED' | 'DENIED'
  respondedAt: Date | null
  createdAt: Date
  guestCount: number
}

const ROW_SELECT = {
  id: true, label: true, seatsAllotted: true, status: true, tableNumber: true,
  extraSeatsRequested: true, extraSeatsStatus: true, respondedAt: true, createdAt: true,
  _count: { select: { guests: true } },
} satisfies Prisma.InviteSelect

type RawRow = Prisma.InviteGetPayload<{ select: typeof ROW_SELECT }>

function toRow(raw: RawRow): InviteRow {
  const { _count, ...rest } = raw
  return { ...rest, guestCount: _count.guests } as InviteRow
}

export type CreateInviteInput = {
  label: string
  seatsAllotted: number
  tableNumber?: string
  adminNotes?: string
  primaryGuest: {
    firstName: string
    lastName: string
    email?: string
    company?: string
    title?: string
  }
}

export async function createInvite(
  db: PrismaClient,
  actorId: string | null,
  input: CreateInviteInput,
): Promise<{ invite: InviteRow; token: string }> {
  const token = generateInviteToken()

  const invite = await db.$transaction(async (tx) => {
    const created = await tx.invite.create({
      data: {
        tokenHash: hashToken(token),
        tokenCipher: seal(token, getEnv().SESSION_SECRET),
        label: input.label,
        seatsAllotted: input.seatsAllotted,
        tableNumber: input.tableNumber || null,
        adminNotes: input.adminNotes || null,
        guests: {
          create: {
            firstName: input.primaryGuest.firstName,
            lastName: input.primaryGuest.lastName,
            email: input.primaryGuest.email || null,
            company: input.primaryGuest.company || null,
            title: input.primaryGuest.title || null,
            isPrimary: true,
          },
        },
      },
      select: ROW_SELECT,
    })
    await writeAudit(tx, {
      actorId,
      action: 'invite.create',
      entity: 'Invite',
      entityId: created.id,
      meta: { label: input.label, seatsAllotted: input.seatsAllotted },
    })
    return created
  })

  return { invite: toRow(invite), token }
}

export type InviteQuery = {
  search?: string
  status?: InviteStatus
  page?: number
  pageSize?: number
}

export async function listInvites(
  db: PrismaClient,
  query: InviteQuery,
): Promise<{ rows: InviteRow[]; total: number }> {
  const page = query.page ?? 1
  const pageSize = query.pageSize ?? 50
  const search = query.search?.trim()

  const where: Prisma.InviteWhereInput = {
    ...(query.status ? { status: query.status } : {}),
    ...(search
      ? {
          OR: [
            { label: { contains: search, mode: 'insensitive' } },
            { guests: { some: { firstName: { contains: search, mode: 'insensitive' } } } },
            { guests: { some: { lastName: { contains: search, mode: 'insensitive' } } } },
            { guests: { some: { email: { contains: search, mode: 'insensitive' } } } },
            { guests: { some: { company: { contains: search, mode: 'insensitive' } } } },
          ],
        }
      : {}),
  }

  const [raw, total] = await Promise.all([
    db.invite.findMany({
      where,
      select: ROW_SELECT,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    db.invite.count({ where }),
  ])

  return { rows: raw.map(toRow), total }
}

export type InviteDetail = InviteRow & {
  adminNotes: string | null
  extraSeatsReason: string | null
  guests: {
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
    tableNumber: string | null
  }[]
}

export async function getInvite(db: PrismaClient, id: string): Promise<InviteDetail | null> {
  const raw = await db.invite.findUnique({
    where: { id },
    select: {
      ...ROW_SELECT,
      adminNotes: true,
      extraSeatsReason: true,
      guests: {
        select: {
          id: true, firstName: true, lastName: true, badgeName: true, company: true,
          title: true, email: true, phone: true, isPrimary: true, attending: true,
          tableNumber: true,
        },
        orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
      },
    },
  })
  if (!raw) return null
  const { _count, ...rest } = raw
  return { ...rest, guestCount: _count.guests } as InviteDetail
}

export type UpdateInvitePatch = {
  label?: string
  seatsAllotted?: number
  tableNumber?: string
  adminNotes?: string
}

export async function updateInvite(
  db: PrismaClient,
  actorId: string | null,
  id: string,
  patch: UpdateInvitePatch,
): Promise<void> {
  await db.$transaction(async (tx) => {
    if (patch.seatsAllotted !== undefined) {
      const guests = await tx.guest.count({ where: { inviteId: id } })
      if (patch.seatsAllotted < guests) throw new SeatLimitError(patch.seatsAllotted, guests)
    }
    await tx.invite.update({
      where: { id },
      data: {
        ...(patch.label !== undefined ? { label: patch.label } : {}),
        ...(patch.seatsAllotted !== undefined ? { seatsAllotted: patch.seatsAllotted } : {}),
        ...(patch.tableNumber !== undefined ? { tableNumber: patch.tableNumber || null } : {}),
        ...(patch.adminNotes !== undefined ? { adminNotes: patch.adminNotes || null } : {}),
      },
    })
    await writeAudit(tx, {
      actorId, action: 'invite.update', entity: 'Invite', entityId: id, meta: { ...patch },
    })
  })
}

export async function regenerateInviteToken(
  db: PrismaClient,
  actorId: string | null,
  id: string,
): Promise<string> {
  const token = generateInviteToken()
  await db.$transaction(async (tx) => {
    await tx.invite.update({
      where: { id },
      data: { tokenHash: hashToken(token), tokenCipher: seal(token, getEnv().SESSION_SECRET) },
    })
    await writeAudit(tx, {
      actorId, action: 'invite.regenerateToken', entity: 'Invite', entityId: id,
    })
  })
  return token
}

export async function deleteInvite(
  db: PrismaClient,
  actorId: string | null,
  id: string,
): Promise<void> {
  await db.$transaction(async (tx) => {
    const invite = await tx.invite.findUniqueOrThrow({ where: { id }, select: { label: true } })
    await tx.invite.delete({ where: { id } })
    await writeAudit(tx, {
      actorId, action: 'invite.delete', entity: 'Invite', entityId: id,
      meta: { label: invite.label },
    })
  })
}

export async function resolveExtraSeats(
  db: PrismaClient,
  actorId: string | null,
  id: string,
  decision: 'APPROVED' | 'DENIED',
): Promise<void> {
  await db.$transaction(async (tx) => {
    const invite = await tx.invite.findUniqueOrThrow({
      where: { id },
      select: { seatsAllotted: true, extraSeatsRequested: true },
    })
    await tx.invite.update({
      where: { id },
      data: {
        extraSeatsStatus: decision,
        ...(decision === 'APPROVED'
          ? { seatsAllotted: invite.seatsAllotted + invite.extraSeatsRequested }
          : {}),
      },
    })
    await writeAudit(tx, {
      actorId, action: 'invite.resolveExtraSeats', entity: 'Invite', entityId: id,
      meta: { decision, requested: invite.extraSeatsRequested },
    })
  })
}

/**
 * Recovers the plaintext tokens for QR export. Reads `tokenCipher`, never the hash.
 * Invites whose cipher cannot be opened (wrong or rotated SESSION_SECRET) are
 * omitted rather than throwing, so one bad row does not break a 1000-code export.
 */
export async function listInviteTokens(
  db: PrismaClient,
  where: Prisma.InviteWhereInput = {},
): Promise<{ id: string; label: string; token: string }[]> {
  const secret = getEnv().SESSION_SECRET
  const rows = await db.invite.findMany({
    where,
    select: { id: true, label: true, tokenCipher: true },
    orderBy: { label: 'asc' },
  })

  const out: { id: string; label: string; token: string }[] = []
  for (const row of rows) {
    try {
      out.push({ id: row.id, label: row.label, token: open(row.tokenCipher, secret) })
    } catch {
      // Unrecoverable token — the operator must regenerate this invite.
    }
  }
  return out
}

export async function getInviteToken(db: PrismaClient, id: string): Promise<string | null> {
  const row = await db.invite.findUnique({ where: { id }, select: { tokenCipher: true } })
  if (!row) return null
  try {
    return open(row.tokenCipher, getEnv().SESSION_SECRET)
  } catch {
    return null
  }
}

/** Recomputes and persists an invite's status. Call inside the transaction that changed attendance. */
export async function recomputeInviteStatus(tx: AuditClient, inviteId: string): Promise<void> {
  const guests = await tx.guest.findMany({
    where: { inviteId },
    select: { attending: true },
  })
  await tx.invite.update({
    where: { id: inviteId },
    data: { status: deriveInviteStatus(guests) },
  })
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/integration/invites.test.ts`
Expected: PASS, 24 tests.

- [ ] **Step 6: Commit**

```bash
git add src/lib/invites/repository.ts src/lib/validation/invites.ts tests/integration/invites.test.ts
git commit -m "feat: invite and guest repository"
```

---

## Task 17: Invite list and detail screens

**Files:**
- Create: `src/app/admin/invites/page.tsx`, `src/app/admin/invites/actions.ts`, `src/app/admin/invites/[id]/page.tsx`, `src/components/admin/pagination.tsx`, `src/components/admin/status-pill.tsx`
- Test: `tests/e2e/invites.spec.ts`

**Interfaces:**
- Consumes: repository functions (Task 16), Zod schemas (Task 16), `requireRole`/`requireCsrf` (Task 11), `CsrfInput`/`Table`/`Td`/`Field` (Task 15), and `inviteUrl` (Task 20)
- **Dependency note:** complete Task 20 before this task. `regenerateTokenAction` imports
  `inviteUrl` from `@/lib/invites/qr`. Do not stub it.
- Produces: `createInviteAction`, `updateInviteAction`, `deleteInviteAction`, `regenerateTokenAction`, `resolveExtraSeatsAction` — each `(formData: FormData) => Promise<void>`. `<StatusPill status={InviteStatus} />` and `<Pagination page total pageSize basePath />`.

- [ ] **Step 1: Write the failing E2E test**

`tests/e2e/invites.spec.ts`:

```ts
import { test, expect, type Page } from '@playwright/test'

async function signIn(page: Page) {
  await page.goto('/admin/login')
  await page.getByLabel('Email').fill(process.env.ADMIN_SEED_EMAIL!)
  await page.getByLabel('Password').fill(process.env.ADMIN_SEED_PASSWORD!)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(/\/admin$/)
}

test.describe('invite management', () => {
  test('creates an invite and finds it by search', async ({ page }) => {
    await signIn(page)
    await page.goto('/admin/invites')

    const label = `Okafor Party ${Date.now()}`
    await page.getByLabel('Invite label').fill(label)
    await page.getByLabel('Seats').fill('2')
    await page.getByLabel('First name').fill('Ada')
    await page.getByLabel('Last name').fill('Okafor')
    await page.getByRole('button', { name: 'Create invite' }).click()

    await expect(page.getByRole('cell', { name: label })).toBeVisible()

    await page.getByLabel('Search').fill('Okafor')
    await page.getByRole('button', { name: 'Apply' }).click()
    await expect(page.getByRole('cell', { name: label })).toBeVisible()
  })

  test('opens invite detail and renames it', async ({ page }) => {
    await signIn(page)
    await page.goto('/admin/invites')
    await page.getByRole('link', { name: 'Open' }).first().click()

    const renamed = `Renamed ${Date.now()}`
    await page.getByLabel('Invite label').fill(renamed)
    await page.getByRole('button', { name: 'Save changes' }).click()
    await expect(page.getByLabel('Invite label')).toHaveValue(renamed)
  })

  test('regenerates a token and shows it exactly once', async ({ page }) => {
    await signIn(page)
    await page.goto('/admin/invites')
    await page.getByRole('link', { name: 'Open' }).first().click()
    await page.getByRole('button', { name: 'Regenerate QR token' }).click()

    const link = page.getByTestId('invite-url')
    await expect(link).toBeVisible()
    await expect(link).toContainText('/i/')

    await page.reload()
    await expect(page.getByTestId('invite-url')).toHaveCount(0)
  })

  test('refuses to shrink seats below the guest count', async ({ page }) => {
    await signIn(page)
    await page.goto('/admin/invites')
    await page.getByRole('link', { name: 'Open' }).first().click()
    await page.getByLabel('Seats').fill('0')
    await page.getByRole('button', { name: 'Save changes' }).click()
    await expect(page.getByRole('alert')).toBeVisible()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:e2e tests/e2e/invites.spec.ts`
Expected: FAIL — `/admin/invites` 404s.

- [ ] **Step 3: Create the presentational components**

`src/components/admin/status-pill.tsx`:

```tsx
import type { InviteStatus } from '@/lib/invites/status'

const STYLES: Record<InviteStatus, string> = {
  PENDING: 'border-[var(--color-border)] text-[var(--color-text-muted)]',
  ATTENDING: 'border-[var(--color-success)] text-[var(--color-success)]',
  DECLINED: 'border-[var(--color-danger)] text-[var(--color-danger)]',
  PARTIAL: 'border-[var(--color-brass)] text-[var(--color-brass)]',
}

export function StatusPill({ status }: { status: InviteStatus }) {
  return (
    <span className={`rounded-full border px-2 py-0.5 text-xs ${STYLES[status]}`}>
      {status.toLowerCase()}
    </span>
  )
}
```

`src/components/admin/pagination.tsx`:

```tsx
import Link from 'next/link'

export function Pagination(props: {
  page: number
  total: number
  pageSize: number
  buildHref: (page: number) => string
}) {
  const { page, total, pageSize, buildHref } = props
  const lastPage = Math.max(1, Math.ceil(total / pageSize))
  if (lastPage === 1) return null

  return (
    <nav aria-label="Pagination" className="flex items-center gap-3 text-sm">
      {page > 1 ? (
        <Link href={buildHref(page - 1)} className="underline underline-offset-4">Previous</Link>
      ) : null}
      <span className="text-[var(--color-text-muted)]">Page {page} of {lastPage}</span>
      {page < lastPage ? (
        <Link href={buildHref(page + 1)} className="underline underline-offset-4">Next</Link>
      ) : null}
    </nav>
  )
}
```

- [ ] **Step 4: Implement the actions**

`src/app/admin/invites/actions.ts`:

```ts
'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/db'
import { getEnv } from '@/lib/env'
import { requireCsrf, requireRole } from '@/lib/auth/guard'
import {
  createInvite, updateInvite, deleteInvite, regenerateInviteToken,
  resolveExtraSeats, SeatLimitError,
} from '@/lib/invites/repository'
import { createInviteSchema, updateInviteSchema } from '@/lib/validation/invites'
import { inviteUrl } from '@/lib/invites/qr'

function failTo(path: string, message: string): never {
  redirect(`${path}?error=${encodeURIComponent(message)}`)
}

function describe(error: unknown): string {
  if (error instanceof SeatLimitError) return error.message
  return 'Something went wrong. Try again.'
}

export async function createInviteAction(formData: FormData): Promise<void> {
  const actor = await requireRole('ADMIN')
  await requireCsrf(formData)

  const parsed = createInviteSchema.safeParse({
    label: formData.get('label'),
    seatsAllotted: formData.get('seatsAllotted'),
    tableNumber: formData.get('tableNumber') ?? '',
    adminNotes: '',
    primaryGuest: {
      firstName: formData.get('firstName'),
      lastName: formData.get('lastName'),
      email: formData.get('email') ?? '',
      company: formData.get('company') ?? '',
      title: formData.get('title') ?? '',
    },
  })
  if (!parsed.success) {
    failTo('/admin/invites', parsed.error.issues[0]?.message ?? 'Invalid invite')
  }

  await createInvite(prisma, actor.id, parsed.data)
  revalidatePath('/admin/invites')
}

export async function updateInviteAction(formData: FormData): Promise<void> {
  const actor = await requireRole('ADMIN')
  await requireCsrf(formData)

  const id = String(formData.get('id') ?? '')
  const parsed = updateInviteSchema.safeParse({
    label: formData.get('label'),
    seatsAllotted: formData.get('seatsAllotted'),
    tableNumber: formData.get('tableNumber') ?? '',
    adminNotes: formData.get('adminNotes') ?? '',
  })
  if (!parsed.success) {
    failTo(`/admin/invites/${id}`, parsed.error.issues[0]?.message ?? 'Invalid change')
  }

  try {
    await updateInvite(prisma, actor.id, id, parsed.data)
  } catch (error) {
    failTo(`/admin/invites/${id}`, describe(error))
  }
  revalidatePath(`/admin/invites/${id}`)
}

export async function deleteInviteAction(formData: FormData): Promise<void> {
  const actor = await requireRole('ADMIN')
  await requireCsrf(formData)
  await deleteInvite(prisma, actor.id, String(formData.get('id') ?? ''))
  redirect('/admin/invites')
}

/**
 * Regenerates the token and redirects with the plaintext in the query string so
 * the operator can copy it once. It is never persisted and never re-displayed.
 */
export async function regenerateTokenAction(formData: FormData): Promise<void> {
  const actor = await requireRole('ADMIN')
  await requireCsrf(formData)

  const id = String(formData.get('id') ?? '')
  const token = await regenerateInviteToken(prisma, actor.id, id)
  const url = inviteUrl(token, getEnv().APP_URL)
  redirect(`/admin/invites/${id}?inviteUrl=${encodeURIComponent(url)}`)
}

export async function resolveExtraSeatsAction(formData: FormData): Promise<void> {
  const actor = await requireRole('ADMIN')
  await requireCsrf(formData)

  const id = String(formData.get('id') ?? '')
  const decision = formData.get('decision') === 'APPROVED' ? 'APPROVED' : 'DENIED'
  await resolveExtraSeats(prisma, actor.id, id, decision)
  revalidatePath(`/admin/invites/${id}`)
}
```

- [ ] **Step 5: Implement the list page**

`src/app/admin/invites/page.tsx`:

```tsx
import Link from 'next/link'
import { prisma } from '@/lib/db'
import { requireRole } from '@/lib/auth/guard'
import { listInvites } from '@/lib/invites/repository'
import { inviteQuerySchema } from '@/lib/validation/invites'
import { CsrfInput } from '@/components/admin/csrf-input'
import { Field } from '@/components/admin/field'
import { Table, Td } from '@/components/admin/table'
import { StatusPill } from '@/components/admin/status-pill'
import { Pagination } from '@/components/admin/pagination'
import { createInviteAction } from './actions'

const STATUSES = ['PENDING', 'ATTENDING', 'DECLINED', 'PARTIAL'] as const

export default async function InvitesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  await requireRole('ADMIN')
  const params = await searchParams
  const query = inviteQuerySchema.parse({
    search: params.search || undefined,
    status: params.status || undefined,
    page: params.page ?? 1,
    pageSize: 50,
  })
  const { rows, total } = await listInvites(prisma, query)

  const buildHref = (page: number) => {
    const next = new URLSearchParams()
    if (query.search) next.set('search', query.search)
    if (query.status) next.set('status', query.status)
    next.set('page', String(page))
    return `/admin/invites?${next.toString()}`
  }

  return (
    <section className="space-y-8">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="font-serif text-2xl">Invites</h1>
        <div className="flex gap-4 text-sm">
          <Link href="/admin/invites/import" className="underline underline-offset-4">Import CSV</Link>
          <Link href="/api/admin/qr?format=pdf" className="underline underline-offset-4">Download QR sheet</Link>
          <Link href="/api/admin/qr?format=zip" className="underline underline-offset-4">Download QR images</Link>
        </div>
      </div>

      {params.error ? (
        <p role="alert" className="rounded border border-[var(--color-danger)] px-3 py-2 text-sm text-[var(--color-danger)]">
          {params.error}
        </p>
      ) : null}

      <form className="flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="mb-1 block text-sm text-[var(--color-text-muted)]">Search</span>
          <input
            name="search"
            defaultValue={query.search ?? ''}
            className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm text-[var(--color-text-muted)]">Status</span>
          <select
            name="status"
            defaultValue={query.status ?? ''}
            className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2"
          >
            <option value="">All</option>
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <button type="submit" className="rounded border border-[var(--color-border)] px-4 py-2">
          Apply
        </button>
      </form>

      <details className="rounded border border-[var(--color-border)] p-4">
        <summary className="cursor-pointer text-sm">Add a single invite</summary>
        <form action={createInviteAction} className="mt-4 grid gap-4 sm:grid-cols-3">
          <CsrfInput />
          <Field label="Invite label" name="label" required />
          <Field label="Seats" name="seatsAllotted" type="number" defaultValue="1" required />
          <Field label="Table" name="tableNumber" />
          <Field label="First name" name="firstName" required />
          <Field label="Last name" name="lastName" required />
          <Field label="Email" name="email" type="email" />
          <Field label="Company" name="company" />
          <Field label="Title" name="title" />
          <button
            type="submit"
            className="self-end rounded bg-[var(--color-brass)] px-4 py-2 font-medium text-[var(--color-ink-deep)]"
          >
            Create invite
          </button>
        </form>
      </details>

      <Table headers={['Label', 'Seats', 'Guests', 'Table', 'Status', 'Extra seats', '']}>
        {rows.map((invite) => (
          <tr key={invite.id}>
            <Td>{invite.label}</Td>
            <Td>{invite.seatsAllotted}</Td>
            <Td>{invite.guestCount}</Td>
            <Td>{invite.tableNumber ?? '—'}</Td>
            <Td><StatusPill status={invite.status} /></Td>
            <Td>{invite.extraSeatsStatus === 'PENDING' ? `${invite.extraSeatsRequested} pending` : '—'}</Td>
            <Td>
              <Link href={`/admin/invites/${invite.id}`} className="underline underline-offset-4">
                Open
              </Link>
            </Td>
          </tr>
        ))}
      </Table>

      <Pagination page={query.page} total={total} pageSize={query.pageSize} buildHref={buildHref} />
    </section>
  )
}
```

- [ ] **Step 6: Implement the detail page**

`src/app/admin/invites/[id]/page.tsx`:

```tsx
import { notFound } from 'next/navigation'
import { prisma } from '@/lib/db'
import { requireRole } from '@/lib/auth/guard'
import { getInvite } from '@/lib/invites/repository'
import { CsrfInput } from '@/components/admin/csrf-input'
import { Field } from '@/components/admin/field'
import { Table, Td } from '@/components/admin/table'
import { StatusPill } from '@/components/admin/status-pill'
import {
  updateInviteAction, deleteInviteAction, regenerateTokenAction, resolveExtraSeatsAction,
} from '../actions'

export default async function InviteDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ error?: string; inviteUrl?: string }>
}) {
  await requireRole('ADMIN')
  const { id } = await params
  const { error, inviteUrl } = await searchParams
  const invite = await getInvite(prisma, id)
  if (!invite) notFound()

  return (
    <section className="space-y-8">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="font-serif text-2xl">{invite.label}</h1>
        <StatusPill status={invite.status} />
      </div>

      {error ? (
        <p role="alert" className="rounded border border-[var(--color-danger)] px-3 py-2 text-sm text-[var(--color-danger)]">
          {error}
        </p>
      ) : null}

      {inviteUrl ? (
        <div className="rounded border border-[var(--color-brass)] p-4">
          <p className="mb-1 text-sm text-[var(--color-text-muted)]">
            New invite link — copy it now, it will not be shown again.
          </p>
          <code data-testid="invite-url" className="break-all text-sm text-[var(--color-brass)]">
            {inviteUrl}
          </code>
        </div>
      ) : null}

      {invite.extraSeatsStatus === 'PENDING' ? (
        <div className="rounded border border-[var(--color-brass)] p-4">
          <p className="mb-3 text-sm">
            Requested {invite.extraSeatsRequested} extra seat(s).
            {invite.extraSeatsReason ? ` Reason: ${invite.extraSeatsReason}` : ''}
          </p>
          <div className="flex gap-3">
            {(['APPROVED', 'DENIED'] as const).map((decision) => (
              <form key={decision} action={resolveExtraSeatsAction}>
                <CsrfInput />
                <input type="hidden" name="id" value={invite.id} />
                <input type="hidden" name="decision" value={decision} />
                <button type="submit" className="rounded border border-[var(--color-border)] px-3 py-1.5 text-sm">
                  {decision === 'APPROVED' ? 'Approve' : 'Deny'}
                </button>
              </form>
            ))}
          </div>
        </div>
      ) : null}

      <form action={updateInviteAction} className="grid gap-4 sm:grid-cols-3">
        <CsrfInput />
        <input type="hidden" name="id" value={invite.id} />
        <Field label="Invite label" name="label" defaultValue={invite.label} required />
        <Field label="Seats" name="seatsAllotted" type="number" defaultValue={String(invite.seatsAllotted)} required />
        <Field label="Table" name="tableNumber" defaultValue={invite.tableNumber ?? ''} />
        <Field label="Admin notes" name="adminNotes" defaultValue={invite.adminNotes ?? ''} />
        <button
          type="submit"
          className="self-end rounded bg-[var(--color-brass)] px-4 py-2 font-medium text-[var(--color-ink-deep)]"
        >
          Save changes
        </button>
      </form>

      <Table headers={['Name', 'Company', 'Title', 'Email', 'Attending', 'Table']}>
        {invite.guests.map((guest) => (
          <tr key={guest.id}>
            <Td>{guest.firstName} {guest.lastName}{guest.isPrimary ? ' (primary)' : ''}</Td>
            <Td>{guest.company ?? '—'}</Td>
            <Td>{guest.title ?? '—'}</Td>
            <Td>{guest.email ?? '—'}</Td>
            <Td>{guest.attending === null ? '—' : guest.attending ? 'Yes' : 'No'}</Td>
            <Td>{guest.tableNumber ?? invite.tableNumber ?? '—'}</Td>
          </tr>
        ))}
      </Table>

      <div className="flex gap-4">
        <form action={regenerateTokenAction}>
          <CsrfInput />
          <input type="hidden" name="id" value={invite.id} />
          <button type="submit" className="rounded border border-[var(--color-border)] px-4 py-2 text-sm">
            Regenerate QR token
          </button>
        </form>
        <form action={deleteInviteAction}>
          <CsrfInput />
          <input type="hidden" name="id" value={invite.id} />
          <button type="submit" className="rounded border border-[var(--color-danger)] px-4 py-2 text-sm text-[var(--color-danger)]">
            Delete invite
          </button>
        </form>
      </div>
    </section>
  )
}
```

- [ ] **Step 7: Run the E2E test**

Run: `npm run test:e2e tests/e2e/invites.spec.ts`
Expected: PASS, 4 tests × 2 projects.

- [ ] **Step 8: Commit**

```bash
git add src/app/admin/invites src/components/admin/status-pill.tsx \
        src/components/admin/pagination.tsx tests/e2e/invites.spec.ts
git commit -m "feat: invite list and detail screens"
```

---

## Task 18: CSV parsing and validation

**Files:**
- Create: `src/lib/invites/csv.ts`
- Test: `tests/unit/csv.test.ts`

**Interfaces:**
- Consumes: `createInviteSchema` shape (Task 16)
- Produces:
  - `CSV_COLUMNS: readonly string[]` — the accepted header names
  - `type ImportRow = { label; seatsAllotted; tableNumber; adminNotes; primaryGuest: { firstName; lastName; email; company; title } }`
  - `type ParsedRow = { rowNumber: number; raw: Record<string, string>; data: ImportRow | null; errors: string[] }`
  - `parseInviteCsv(text: string): { headerErrors: string[]; rows: ParsedRow[] }`
  - `csvTemplate(): string`

- [ ] **Step 1: Write the failing test**

`tests/unit/csv.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { parseInviteCsv, csvTemplate, CSV_COLUMNS } from '@/lib/invites/csv'

const HEADER = 'label,seatsAllotted,tableNumber,primaryFirstName,primaryLastName,primaryEmail,primaryCompany,primaryTitle,adminNotes'

describe('parseInviteCsv', () => {
  it('parses a valid row', () => {
    const csv = `${HEADER}\nReyes Party,2,12,Jordan,Reyes,jordan@example.com,Acme,VP,VIP`
    const { headerErrors, rows } = parseInviteCsv(csv)
    expect(headerErrors).toEqual([])
    expect(rows).toHaveLength(1)
    expect(rows[0]?.errors).toEqual([])
    expect(rows[0]?.data).toMatchObject({
      label: 'Reyes Party',
      seatsAllotted: 2,
      tableNumber: '12',
      primaryGuest: { firstName: 'Jordan', lastName: 'Reyes', email: 'jordan@example.com' },
    })
  })

  it('numbers rows from 2 so they match the spreadsheet', () => {
    const csv = `${HEADER}\nA,1,,Ada,Okafor,,,,\nB,1,,Sam,Reyes,,,,`
    const { rows } = parseInviteCsv(csv)
    expect(rows.map((r) => r.rowNumber)).toEqual([2, 3])
  })

  it('reports a missing required column', () => {
    const { headerErrors } = parseInviteCsv('label,seatsAllotted\nA,1')
    expect(headerErrors.join(' ')).toMatch(/primaryFirstName/)
  })

  it('accepts columns in any order', () => {
    const csv = 'primaryLastName,primaryFirstName,label,seatsAllotted\nOkafor,Ada,A Party,3'
    const { headerErrors, rows } = parseInviteCsv(csv)
    expect(headerErrors).toEqual([])
    expect(rows[0]?.data?.seatsAllotted).toBe(3)
  })

  it('flags a missing label', () => {
    const csv = `${HEADER}\n,2,,Jordan,Reyes,,,,`
    const { rows } = parseInviteCsv(csv)
    expect(rows[0]?.data).toBeNull()
    expect(rows[0]?.errors.join(' ')).toMatch(/label/i)
  })

  it('flags a non-integer seat count', () => {
    const csv = `${HEADER}\nA,two,,Jordan,Reyes,,,,`
    const { rows } = parseInviteCsv(csv)
    expect(rows[0]?.errors.join(' ')).toMatch(/seats/i)
  })

  it('flags a seat count below one', () => {
    const csv = `${HEADER}\nA,0,,Jordan,Reyes,,,,`
    const { rows } = parseInviteCsv(csv)
    expect(rows[0]?.errors.join(' ')).toMatch(/seats/i)
  })

  it('defaults a blank seat count to 1', () => {
    const csv = `${HEADER}\nA,,,Jordan,Reyes,,,,`
    const { rows } = parseInviteCsv(csv)
    expect(rows[0]?.data?.seatsAllotted).toBe(1)
  })

  it('flags a malformed email', () => {
    const csv = `${HEADER}\nA,1,,Jordan,Reyes,not-an-email,,,`
    const { rows } = parseInviteCsv(csv)
    expect(rows[0]?.errors.join(' ')).toMatch(/email/i)
  })

  it('accepts a blank email', () => {
    const csv = `${HEADER}\nA,1,,Jordan,Reyes,,,,`
    const { rows } = parseInviteCsv(csv)
    expect(rows[0]?.errors).toEqual([])
    expect(rows[0]?.data?.primaryGuest.email).toBe('')
  })

  it('flags a duplicate email within the file', () => {
    const csv = `${HEADER}\nA,1,,Jordan,Reyes,dupe@example.com,,,\nB,1,,Sam,Okafor,dupe@example.com,,,`
    const { rows } = parseInviteCsv(csv)
    expect(rows[0]?.errors).toEqual([])
    expect(rows[1]?.errors.join(' ')).toMatch(/duplicate/i)
  })

  it('treats duplicate emails case-insensitively', () => {
    const csv = `${HEADER}\nA,1,,Jordan,Reyes,dupe@example.com,,,\nB,1,,Sam,Okafor,DUPE@Example.COM,,,`
    const { rows } = parseInviteCsv(csv)
    expect(rows[1]?.errors.join(' ')).toMatch(/duplicate/i)
  })

  it('trims surrounding whitespace', () => {
    const csv = `${HEADER}\n"  Reyes Party ",2,, Jordan , Reyes ,,,,`
    const { rows } = parseInviteCsv(csv)
    expect(rows[0]?.data?.label).toBe('Reyes Party')
    expect(rows[0]?.data?.primaryGuest.firstName).toBe('Jordan')
  })

  it('skips entirely blank lines', () => {
    const csv = `${HEADER}\nA,1,,Jordan,Reyes,,,,\n,,,,,,,,\n`
    const { rows } = parseInviteCsv(csv)
    expect(rows).toHaveLength(1)
  })

  it('returns no rows for a header-only file', () => {
    expect(parseInviteCsv(HEADER).rows).toEqual([])
  })

  it('reports an error for an empty file', () => {
    expect(parseInviteCsv('').headerErrors.length).toBeGreaterThan(0)
  })
})

describe('csvTemplate', () => {
  it('emits every column in the documented order', () => {
    expect(csvTemplate().split('\n')[0]).toBe(CSV_COLUMNS.join(','))
  })

  it('includes one example row', () => {
    expect(csvTemplate().trim().split('\n')).toHaveLength(2)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/csv.test.ts`
Expected: FAIL — cannot resolve `@/lib/invites/csv`.

- [ ] **Step 3: Implement `src/lib/invites/csv.ts`**

```ts
import Papa from 'papaparse'

export const CSV_COLUMNS = [
  'label', 'seatsAllotted', 'tableNumber',
  'primaryFirstName', 'primaryLastName', 'primaryEmail',
  'primaryCompany', 'primaryTitle', 'adminNotes',
] as const

const REQUIRED_COLUMNS = ['label', 'primaryFirstName', 'primaryLastName'] as const

const MAX_SEATS = 20
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export type ImportRow = {
  label: string
  seatsAllotted: number
  tableNumber: string
  adminNotes: string
  primaryGuest: {
    firstName: string
    lastName: string
    email: string
    company: string
    title: string
  }
}

export type ParsedRow = {
  rowNumber: number
  raw: Record<string, string>
  data: ImportRow | null
  errors: string[]
}

function cell(raw: Record<string, string>, key: string): string {
  return (raw[key] ?? '').trim()
}

function parseSeats(value: string, errors: string[]): number {
  if (value === '') return 1
  const seats = Number(value)
  if (!Number.isInteger(seats) || seats < 1 || seats > MAX_SEATS) {
    errors.push(`seats must be a whole number between 1 and ${MAX_SEATS}`)
    return 1
  }
  return seats
}

function validateRow(
  raw: Record<string, string>,
  rowNumber: number,
  seenEmails: Set<string>,
): ParsedRow {
  const errors: string[] = []

  const label = cell(raw, 'label')
  if (!label) errors.push('label is required')

  const firstName = cell(raw, 'primaryFirstName')
  if (!firstName) errors.push('primaryFirstName is required')

  const lastName = cell(raw, 'primaryLastName')
  if (!lastName) errors.push('primaryLastName is required')

  const seatsAllotted = parseSeats(cell(raw, 'seatsAllotted'), errors)

  const email = cell(raw, 'primaryEmail').toLowerCase()
  if (email && !EMAIL_PATTERN.test(email)) {
    errors.push('primaryEmail is not a valid email address')
  } else if (email && seenEmails.has(email)) {
    errors.push(`duplicate email ${email} appears earlier in this file`)
  } else if (email) {
    seenEmails.add(email)
  }

  return {
    rowNumber,
    raw,
    errors,
    data: errors.length
      ? null
      : {
          label,
          seatsAllotted,
          tableNumber: cell(raw, 'tableNumber'),
          adminNotes: cell(raw, 'adminNotes'),
          primaryGuest: {
            firstName,
            lastName,
            email,
            company: cell(raw, 'primaryCompany'),
            title: cell(raw, 'primaryTitle'),
          },
        },
  }
}

export function parseInviteCsv(text: string): { headerErrors: string[]; rows: ParsedRow[] } {
  if (!text.trim()) return { headerErrors: ['The file is empty'], rows: [] }

  const result = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: (h) => h.trim(),
  })

  const headers = result.meta.fields ?? []
  const headerErrors = REQUIRED_COLUMNS
    .filter((column) => !headers.includes(column))
    .map((column) => `Missing required column: ${column}`)

  if (headerErrors.length) return { headerErrors, rows: [] }

  const seenEmails = new Set<string>()
  const rows = result.data
    .filter((raw) => Object.values(raw).some((v) => (v ?? '').trim() !== ''))
    // Row 1 is the header, so data rows start at 2 — matching what the operator sees.
    .map((raw, index) => validateRow(raw, index + 2, seenEmails))

  return { headerErrors: [], rows }
}

export function csvTemplate(): string {
  const example = [
    'Reyes Party', '2', '12', 'Jordan', 'Reyes',
    'jordan@example.com', 'Acme Corp', 'VP Engineering', 'Seated with the board',
  ]
  return `${CSV_COLUMNS.join(',')}\n${example.join(',')}\n`
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/csv.test.ts`
Expected: PASS, 18 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/invites/csv.ts tests/unit/csv.test.ts
git commit -m "feat: CSV parsing and row validation"
```

---

## Task 19: CSV import — transactional commit and screen

**Files:**
- Create: `src/lib/invites/import.ts`, `src/app/admin/invites/import/page.tsx`, `src/app/admin/invites/import/actions.ts`, `src/app/admin/invites/import/import-form.tsx`
- Test: `tests/integration/csv-import.test.ts`, `tests/e2e/csv-import.spec.ts`

**Interfaces:**
- Consumes: `parseInviteCsv`, `ParsedRow`, `csvTemplate` (Task 18); `createInvite` internals — this task writes its own batched insert rather than looping `createInvite`, to keep 1000 rows in one transaction
- Produces:
  - `commitInviteImport(db, actorId, rows: ImportRow[]): Promise<ImportResult>` where `ImportResult` is `{ created: number; skippedExistingEmails: string[] }`
  - `existingEmails(db, emails: string[]): Promise<Set<string>>`
  - `MAX_IMPORT_ROWS = 2000`

- [ ] **Step 1: Write the failing integration test**

`tests/integration/csv-import.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { testDb, resetDb } from '../helpers/db'
import { commitInviteImport, existingEmails, MAX_IMPORT_ROWS } from '@/lib/invites/import'
import { listInviteTokens } from '@/lib/invites/repository'
import { parseInviteCsv } from '@/lib/invites/csv'

const HEADER = 'label,seatsAllotted,tableNumber,primaryFirstName,primaryLastName,primaryEmail,primaryCompany,primaryTitle,adminNotes'

function rowsFrom(csv: string) {
  return parseInviteCsv(csv).rows.map((r) => r.data!).filter(Boolean)
}

beforeEach(resetDb)
afterAll(() => testDb.$disconnect())

describe('commitInviteImport', () => {
  it('creates one invite and one primary guest per row', async () => {
    const rows = rowsFrom(`${HEADER}\nA Party,2,,Ada,Okafor,ada@example.com,,,\nB Party,1,,Sam,Reyes,,,,`)
    const result = await commitInviteImport(testDb, null, rows)
    expect(result.created).toBe(2)
    expect(await testDb.invite.count()).toBe(2)
    expect(await testDb.guest.count()).toBe(2)
    expect(await testDb.guest.count({ where: { isPrimary: true } })).toBe(2)
  })

  it('gives every invite a distinct token hash', async () => {
    const rows = rowsFrom(`${HEADER}\nA,1,,Ada,Okafor,,,,\nB,1,,Sam,Reyes,,,,`)
    await commitInviteImport(testDb, null, rows)
    const invites = await testDb.invite.findMany({ select: { tokenHash: true } })
    expect(new Set(invites.map((i) => i.tokenHash)).size).toBe(2)
  })

  it('stores a recoverable token cipher for every imported invite', async () => {
    const rows = rowsFrom(`${HEADER}
A,1,,Ada,Okafor,,,,
B,1,,Sam,Reyes,,,,`)
    await commitInviteImport(testDb, null, rows)
    const tokens = await listInviteTokens(testDb)
    expect(tokens).toHaveLength(2)
    expect(tokens.every((t) => /^[A-Za-z0-9_-]{32}$/.test(t.token))).toBe(true)
  })

  it('skips rows whose email already exists in the database', async () => {
    await commitInviteImport(testDb, null, rowsFrom(`${HEADER}\nA,1,,Ada,Okafor,ada@example.com,,,`))
    const result = await commitInviteImport(
      testDb, null,
      rowsFrom(`${HEADER}\nDuplicate,1,,Ada,Okafor,ada@example.com,,,\nNew,1,,Sam,Reyes,sam@example.com,,,`),
    )
    expect(result.created).toBe(1)
    expect(result.skippedExistingEmails).toEqual(['ada@example.com'])
    expect(await testDb.invite.count()).toBe(2)
  })

  it('rolls back entirely when any insert fails', async () => {
    const rows = rowsFrom(`${HEADER}\nA,1,,Ada,Okafor,,,,`)
    // A label longer than the column allows forces a database error mid-transaction.
    const bad = [...rows, { ...rows[0]!, label: 'x'.repeat(100_000) }]
    await expect(commitInviteImport(testDb, null, bad)).rejects.toThrow()
    expect(await testDb.invite.count()).toBe(0)
  })

  it('writes a single audit row summarizing the import', async () => {
    await commitInviteImport(testDb, null, rowsFrom(`${HEADER}\nA,1,,Ada,Okafor,,,,\nB,1,,Sam,Reyes,,,,`))
    const logs = await testDb.auditLog.findMany({ where: { action: 'invite.import' } })
    expect(logs).toHaveLength(1)
    expect((logs[0]?.meta as Record<string, unknown>).created).toBe(2)
  })

  it('accepts an empty row list without writing anything', async () => {
    const result = await commitInviteImport(testDb, null, [])
    expect(result.created).toBe(0)
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

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/integration/csv-import.test.ts`
Expected: FAIL — cannot resolve `@/lib/invites/import`.

- [ ] **Step 3: Implement `src/lib/invites/import.ts`**

```ts
import type { PrismaClient } from '@prisma/client'
import { generateInviteToken, hashToken } from '@/lib/crypto/tokens'
import { seal } from '@/lib/crypto/secret-box'
import { getEnv } from '@/lib/env'
import { writeAudit } from '@/lib/audit'
import type { ImportRow } from './csv'

export const MAX_IMPORT_ROWS = 2000

export type ImportResult = {
  created: number
  skippedExistingEmails: string[]
}

export async function existingEmails(
  db: PrismaClient,
  emails: string[],
): Promise<Set<string>> {
  const wanted = emails.filter(Boolean).map((e) => e.toLowerCase())
  if (wanted.length === 0) return new Set()
  const found = await db.guest.findMany({
    where: { email: { in: wanted } },
    select: { email: true },
  })
  return new Set(found.map((g) => g.email!.toLowerCase()))
}

/**
 * Commits an entire import in one transaction. Rows whose primary email already
 * exists are skipped rather than failing the batch — re-importing a corrected
 * spreadsheet is a normal operation, not an error.
 */
export async function commitInviteImport(
  db: PrismaClient,
  actorId: string | null,
  rows: ImportRow[],
): Promise<ImportResult> {
  if (rows.length === 0) return { created: 0, skippedExistingEmails: [] }
  if (rows.length > MAX_IMPORT_ROWS) {
    throw new Error(`Import accepts at most ${MAX_IMPORT_ROWS} rows per file`)
  }

  const taken = await existingEmails(db, rows.map((r) => r.primaryGuest.email))
  const skippedExistingEmails: string[] = []
  const toCreate = rows.filter((row) => {
    const email = row.primaryGuest.email.toLowerCase()
    if (email && taken.has(email)) {
      skippedExistingEmails.push(email)
      return false
    }
    return true
  })

  const secret = getEnv().SESSION_SECRET

  await db.$transaction(
    async (tx) => {
      for (const row of toCreate) {
        const token = generateInviteToken()
        await tx.invite.create({
          data: {
            tokenHash: hashToken(token),
            tokenCipher: seal(token, secret),
            label: row.label,
            seatsAllotted: row.seatsAllotted,
            tableNumber: row.tableNumber || null,
            adminNotes: row.adminNotes || null,
            guests: {
              create: {
                firstName: row.primaryGuest.firstName,
                lastName: row.primaryGuest.lastName,
                email: row.primaryGuest.email || null,
                company: row.primaryGuest.company || null,
                title: row.primaryGuest.title || null,
                isPrimary: true,
              },
            },
          },
        })
      }
      await writeAudit(tx, {
        actorId,
        action: 'invite.import',
        entity: 'Invite',
        meta: { created: toCreate.length, skipped: skippedExistingEmails.length },
      })
    },
    { timeout: 120_000 },
  )

  return { created: toCreate.length, skippedExistingEmails }
}
```

- [ ] **Step 4: Run the integration test**

Run: `npx vitest run tests/integration/csv-import.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Write the failing E2E test**

`tests/e2e/csv-import.spec.ts`:

```ts
import { test, expect, type Page } from '@playwright/test'

const HEADER = 'label,seatsAllotted,tableNumber,primaryFirstName,primaryLastName,primaryEmail,primaryCompany,primaryTitle,adminNotes'

async function signIn(page: Page) {
  await page.goto('/admin/login')
  await page.getByLabel('Email').fill(process.env.ADMIN_SEED_EMAIL!)
  await page.getByLabel('Password').fill(process.env.ADMIN_SEED_PASSWORD!)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(/\/admin$/)
}

async function upload(page: Page, csv: string) {
  await page.getByLabel('CSV file').setInputFiles({
    name: 'invites.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(csv),
  })
  await page.getByRole('button', { name: 'Validate file' }).click()
}

test.describe('CSV import', () => {
  test('previews valid rows then commits them', async ({ page }) => {
    await signIn(page)
    await page.goto('/admin/invites/import')

    const stamp = Date.now()
    await upload(page, `${HEADER}\nImported ${stamp},2,,Ada,Okafor,ada${stamp}@example.com,,,`)

    await expect(page.getByText('1 row ready to import')).toBeVisible()
    await page.getByRole('button', { name: 'Import 1 invite' }).click()
    await expect(page).toHaveURL(/\/admin\/invites/)
    await expect(page.getByRole('cell', { name: `Imported ${stamp}` })).toBeVisible()
  })

  test('shows per-row errors and refuses to import them', async ({ page }) => {
    await signIn(page)
    await page.goto('/admin/invites/import')
    await upload(page, `${HEADER}\n,two,,Ada,,bad-email,,,`)

    await expect(page.getByText(/label is required/)).toBeVisible()
    await expect(page.getByText(/seats must be/)).toBeVisible()
    await expect(page.getByText(/0 rows ready to import/)).toBeVisible()
  })

  test('reports a missing required column', async ({ page }) => {
    await signIn(page)
    await page.goto('/admin/invites/import')
    await upload(page, 'label,seatsAllotted\nA,1')
    await expect(page.getByRole('alert')).toContainText('primaryFirstName')
  })
})
```

- [ ] **Step 6: Implement the import screen**

`src/app/admin/invites/import/actions.ts`:

```ts
'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/db'
import { requireCsrf, requireRole } from '@/lib/auth/guard'
import { parseInviteCsv, type ParsedRow, type ImportRow } from '@/lib/invites/csv'
import { commitInviteImport, MAX_IMPORT_ROWS } from '@/lib/invites/import'

const MAX_FILE_BYTES = 5 * 1024 * 1024

export type PreviewState = {
  headerErrors: string[]
  rows: ParsedRow[]
  payload: string
} | null

export async function validateCsvAction(
  _prev: PreviewState,
  formData: FormData,
): Promise<PreviewState> {
  await requireRole('ADMIN')
  await requireCsrf(formData)

  const file = formData.get('file')
  if (!(file instanceof File) || file.size === 0) {
    return { headerErrors: ['Choose a CSV file'], rows: [], payload: '' }
  }
  if (file.size > MAX_FILE_BYTES) {
    return { headerErrors: ['File is larger than 5 MB'], rows: [], payload: '' }
  }

  const text = await file.text()
  const { headerErrors, rows } = parseInviteCsv(text)

  if (rows.length > MAX_IMPORT_ROWS) {
    return {
      headerErrors: [`File has ${rows.length} rows; the limit is ${MAX_IMPORT_ROWS}`],
      rows: [],
      payload: '',
    }
  }

  const valid = rows.filter((r) => r.data).map((r) => r.data!)
  return { headerErrors, rows, payload: JSON.stringify(valid) }
}

export async function commitCsvAction(formData: FormData): Promise<void> {
  const actor = await requireRole('ADMIN')
  await requireCsrf(formData)

  const payload = String(formData.get('payload') ?? '[]')
  let rows: ImportRow[]
  try {
    const decoded: unknown = JSON.parse(payload)
    if (!Array.isArray(decoded)) throw new Error('not an array')
    rows = decoded as ImportRow[]
  } catch {
    redirect('/admin/invites/import?error=Could+not+read+the+validated+rows')
  }

  const result = await commitInviteImport(prisma, actor.id, rows)
  revalidatePath('/admin/invites')
  redirect(`/admin/invites?imported=${result.created}&skipped=${result.skippedExistingEmails.length}`)
}
```

`src/app/admin/invites/import/import-form.tsx`:

```tsx
'use client'

import { useActionState } from 'react'
import { validateCsvAction, commitCsvAction, type PreviewState } from './actions'

export function ImportForm({ csrf }: { csrf: string }) {
  const [state, validate, pending] = useActionState<PreviewState, FormData>(validateCsvAction, null)
  const readyCount = state?.rows.filter((r) => r.data).length ?? 0
  const errorRows = state?.rows.filter((r) => r.errors.length) ?? []

  return (
    <div className="space-y-8">
      <form action={validate} className="flex flex-wrap items-end gap-4">
        <input type="hidden" name="csrf" value={csrf} />
        <label className="block">
          <span className="mb-1 block text-sm text-[var(--color-text-muted)]">CSV file</span>
          <input type="file" name="file" accept=".csv,text/csv" required className="text-sm" />
        </label>
        <button
          type="submit"
          disabled={pending}
          className="rounded border border-[var(--color-border)] px-4 py-2 disabled:opacity-60"
        >
          {pending ? 'Validating…' : 'Validate file'}
        </button>
      </form>

      {state?.headerErrors.length ? (
        <p role="alert" className="rounded border border-[var(--color-danger)] px-3 py-2 text-sm text-[var(--color-danger)]">
          {state.headerErrors.join('. ')}
        </p>
      ) : null}

      {state && !state.headerErrors.length ? (
        <>
          <p className="text-sm">
            {readyCount} row{readyCount === 1 ? '' : 's'} ready to import
            {errorRows.length ? `, ${errorRows.length} with errors (they will be skipped)` : ''}
          </p>

          {errorRows.length ? (
            <ul className="space-y-1 text-sm text-[var(--color-danger)]">
              {errorRows.map((row) => (
                <li key={row.rowNumber}>Row {row.rowNumber}: {row.errors.join('; ')}</li>
              ))}
            </ul>
          ) : null}

          {readyCount > 0 ? (
            <form action={commitCsvAction}>
              <input type="hidden" name="csrf" value={csrf} />
              <input type="hidden" name="payload" value={state.payload} />
              <button
                type="submit"
                className="rounded bg-[var(--color-brass)] px-4 py-2 font-medium text-[var(--color-ink-deep)]"
              >
                Import {readyCount} invite{readyCount === 1 ? '' : 's'}
              </button>
            </form>
          ) : null}
        </>
      ) : null}
    </div>
  )
}
```

`src/app/admin/invites/import/page.tsx`:

```tsx
import { cookies } from 'next/headers'
import { requireRole } from '@/lib/auth/guard'
import { CSRF_COOKIE, issueCsrfToken } from '@/lib/auth/csrf'
import { CSV_COLUMNS, csvTemplate } from '@/lib/invites/csv'
import { ImportForm } from './import-form'

export default async function ImportPage() {
  await requireRole('ADMIN')

  const store = await cookies()
  let csrf = store.get(CSRF_COOKIE)?.value
  if (!csrf) {
    csrf = issueCsrfToken()
    store.set(CSRF_COOKIE, csrf, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
    })
  }

  return (
    <section className="space-y-8">
      <h1 className="font-serif text-2xl">Import invites</h1>

      <div className="rounded border border-[var(--color-border)] p-4 text-sm">
        <p className="mb-2 text-[var(--color-text-muted)]">
          Required columns: <code>label</code>, <code>primaryFirstName</code>,{' '}
          <code>primaryLastName</code>. Optional: {CSV_COLUMNS.filter(
            (c) => !['label', 'primaryFirstName', 'primaryLastName'].includes(c),
          ).map((c) => <code key={c} className="mr-1">{c}</code>)}
        </p>
        <pre className="overflow-x-auto rounded bg-[var(--color-surface)] p-3 text-xs">
          {csvTemplate()}
        </pre>
      </div>

      <ImportForm csrf={csrf} />
    </section>
  )
}
```

- [ ] **Step 7: Run the E2E test**

Run: `npm run test:e2e tests/e2e/csv-import.spec.ts`
Expected: PASS, 3 tests × 2 projects.

- [ ] **Step 8: Commit**

```bash
git add src/lib/invites/import.ts src/app/admin/invites/import \
        tests/integration/csv-import.test.ts tests/e2e/csv-import.spec.ts
git commit -m "feat: transactional CSV import with validated preview"
```

---

## Task 20: QR code generation

**Files:**
- Create: `src/lib/invites/qr.ts`
- Test: `tests/unit/qr.test.ts`

**Interfaces:**
- Consumes: nothing (takes a base URL as a parameter rather than reading env, so it stays unit-testable)
- Produces:
  - `inviteUrl(token: string, baseUrl: string): string`
  - `renderQrPng(url: string, size?: number): Promise<Buffer>` — default size 600
  - `type QrItem = { label: string; url: string }`
  - `buildQrZip(items: QrItem[]): Promise<Buffer>`
  - `buildQrPdf(items: QrItem[]): Promise<Buffer>` — A4 portrait, 3×4 grid, label beneath each code
  - `safeFilename(label: string): string`

- [ ] **Step 1: Write the failing test**

`tests/unit/qr.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import JSZip from 'jszip'
import { PDFDocument } from 'pdf-lib'
import {
  inviteUrl, renderQrPng, buildQrZip, buildQrPdf, safeFilename,
} from '@/lib/invites/qr'

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47])

describe('inviteUrl', () => {
  it('builds the scan target', () => {
    expect(inviteUrl('abc123', 'https://gala.example.com')).toBe('https://gala.example.com/i/abc123')
  })

  it('tolerates a trailing slash on the base', () => {
    expect(inviteUrl('abc123', 'https://gala.example.com/')).toBe('https://gala.example.com/i/abc123')
  })

  it('percent-encodes a token containing URL-unsafe characters', () => {
    expect(inviteUrl('a/b', 'https://x.test')).toBe('https://x.test/i/a%2Fb')
  })
})

describe('safeFilename', () => {
  it('replaces path separators and spaces', () => {
    expect(safeFilename('Reyes / Okafor Party')).toBe('Reyes-Okafor-Party')
  })

  it('falls back for an empty label', () => {
    expect(safeFilename('   ')).toBe('invite')
  })

  it('truncates a very long label', () => {
    expect(safeFilename('x'.repeat(200)).length).toBeLessThanOrEqual(80)
  })
})

describe('renderQrPng', () => {
  it('returns a PNG buffer', async () => {
    const png = await renderQrPng('https://gala.example.com/i/abc')
    expect(png.subarray(0, 4).equals(PNG_MAGIC)).toBe(true)
  })

  it('honours the requested size', async () => {
    const small = await renderQrPng('https://gala.example.com/i/abc', 200)
    const large = await renderQrPng('https://gala.example.com/i/abc', 800)
    expect(large.length).toBeGreaterThan(small.length)
  })
})

describe('buildQrZip', () => {
  it('contains one PNG per item, named by label', async () => {
    const zip = await buildQrZip([
      { label: 'Reyes Party', url: 'https://x.test/i/a' },
      { label: 'Okafor Party', url: 'https://x.test/i/b' },
    ])
    const archive = await JSZip.loadAsync(zip)
    const names = Object.keys(archive.files).sort()
    expect(names).toEqual(['Okafor-Party.png', 'Reyes-Party.png'])
  })

  it('disambiguates duplicate labels', async () => {
    const zip = await buildQrZip([
      { label: 'Party', url: 'https://x.test/i/a' },
      { label: 'Party', url: 'https://x.test/i/b' },
    ])
    const archive = await JSZip.loadAsync(zip)
    expect(Object.keys(archive.files).sort()).toEqual(['Party-2.png', 'Party.png'])
  })

  it('produces an empty archive for no items', async () => {
    const archive = await JSZip.loadAsync(await buildQrZip([]))
    expect(Object.keys(archive.files)).toHaveLength(0)
  })
})

describe('buildQrPdf', () => {
  it('returns a loadable PDF', async () => {
    const pdf = await buildQrPdf([{ label: 'Reyes Party', url: 'https://x.test/i/a' }])
    const doc = await PDFDocument.load(pdf)
    expect(doc.getPageCount()).toBe(1)
  })

  it('paginates at 12 codes per page', async () => {
    const items = Array.from({ length: 13 }, (_, i) => ({
      label: `Party ${i}`, url: `https://x.test/i/${i}`,
    }))
    const doc = await PDFDocument.load(await buildQrPdf(items))
    expect(doc.getPageCount()).toBe(2)
  })

  it('emits a single empty page for no items', async () => {
    const doc = await PDFDocument.load(await buildQrPdf([]))
    expect(doc.getPageCount()).toBe(1)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/qr.test.ts`
Expected: FAIL — cannot resolve `@/lib/invites/qr`.

- [ ] **Step 3: Implement `src/lib/invites/qr.ts`**

```ts
import QRCode from 'qrcode'
import JSZip from 'jszip'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'

export type QrItem = { label: string; url: string }

const DEFAULT_SIZE = 600

/** A4 in PDF points. */
const PAGE_WIDTH = 595.28
const PAGE_HEIGHT = 841.89
const MARGIN = 36
const COLUMNS = 3
const ROWS = 4
const PER_PAGE = COLUMNS * ROWS
const LABEL_HEIGHT = 14

export function inviteUrl(token: string, baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/i/${encodeURIComponent(token)}`
}

export function safeFilename(label: string): string {
  const cleaned = label
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80)
  return cleaned || 'invite'
}

export async function renderQrPng(url: string, size: number = DEFAULT_SIZE): Promise<Buffer> {
  return QRCode.toBuffer(url, {
    type: 'png',
    errorCorrectionLevel: 'M',
    width: size,
    margin: 1,
    color: { dark: '#000000ff', light: '#ffffffff' },
  })
}

/** Appends a numeric suffix so two invites with the same label do not collide. */
function uniqueName(base: string, used: Set<string>): string {
  let name = `${base}.png`
  let counter = 2
  while (used.has(name)) {
    name = `${base}-${counter}.png`
    counter++
  }
  used.add(name)
  return name
}

export async function buildQrZip(items: QrItem[]): Promise<Buffer> {
  const zip = new JSZip()
  const used = new Set<string>()

  for (const item of items) {
    const png = await renderQrPng(item.url)
    zip.file(uniqueName(safeFilename(item.label), used), png)
  }

  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
}

export async function buildQrPdf(items: QrItem[]): Promise<Buffer> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)

  const cellWidth = (PAGE_WIDTH - MARGIN * 2) / COLUMNS
  const cellHeight = (PAGE_HEIGHT - MARGIN * 2) / ROWS
  const codeSize = Math.min(cellWidth, cellHeight - LABEL_HEIGHT) - 12

  const pageCount = Math.max(1, Math.ceil(items.length / PER_PAGE))

  for (let pageIndex = 0; pageIndex < pageCount; pageIndex++) {
    const page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT])
    const pageItems = items.slice(pageIndex * PER_PAGE, (pageIndex + 1) * PER_PAGE)

    for (const [slot, item] of pageItems.entries()) {
      const column = slot % COLUMNS
      const row = Math.floor(slot / COLUMNS)

      const cellLeft = MARGIN + column * cellWidth
      const cellTop = PAGE_HEIGHT - MARGIN - row * cellHeight

      const png = await doc.embedPng(await renderQrPng(item.url, 600))
      page.drawImage(png, {
        x: cellLeft + (cellWidth - codeSize) / 2,
        y: cellTop - codeSize - 4,
        width: codeSize,
        height: codeSize,
      })

      const label = item.label.length > 32 ? `${item.label.slice(0, 31)}…` : item.label
      const labelWidth = font.widthOfTextAtSize(label, 9)
      page.drawText(label, {
        x: cellLeft + (cellWidth - labelWidth) / 2,
        y: cellTop - codeSize - LABEL_HEIGHT - 4,
        size: 9,
        font,
        color: rgb(0.1, 0.1, 0.1),
      })
    }
  }

  return Buffer.from(await doc.save())
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/qr.test.ts`
Expected: PASS, 12 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/invites/qr.ts tests/unit/qr.test.ts
git commit -m "feat: QR PNG, ZIP, and print-ready PDF generation"
```

---

## Task 21: QR download route

**Files:**
- Create: `src/app/api/admin/qr/route.ts`
- Test: `tests/e2e/qr-download.spec.ts`

**Interfaces:**
- Consumes: `listInviteTokens` (Task 16), `inviteUrl`/`buildQrZip`/`buildQrPdf` (Task 20), `requireRole` (Task 11), `getEnv` (Task 2)
- Produces: `GET /api/admin/qr?format=pdf|zip&status=<InviteStatus>` — returns `application/pdf` or `application/zip` with a `Content-Disposition: attachment` filename.

- [ ] **Step 1: Write the failing E2E test**

`tests/e2e/qr-download.spec.ts`:

```ts
import { test, expect, type Page } from '@playwright/test'

async function signIn(page: Page) {
  await page.goto('/admin/login')
  await page.getByLabel('Email').fill(process.env.ADMIN_SEED_EMAIL!)
  await page.getByLabel('Password').fill(process.env.ADMIN_SEED_PASSWORD!)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(/\/admin$/)
}

test.describe('QR download', () => {
  test('rejects an anonymous request', async ({ request }) => {
    const response = await request.get('/api/admin/qr?format=pdf', { maxRedirects: 0 })
    expect([302, 307, 401, 403]).toContain(response.status())
  })

  test('returns a PDF for a signed-in admin', async ({ page }) => {
    await signIn(page)
    const response = await page.request.get('/api/admin/qr?format=pdf')
    expect(response.status()).toBe(200)
    expect(response.headers()['content-type']).toContain('application/pdf')
    const body = await response.body()
    expect(body.subarray(0, 5).toString()).toBe('%PDF-')
  })

  test('returns a ZIP for a signed-in admin', async ({ page }) => {
    await signIn(page)
    const response = await page.request.get('/api/admin/qr?format=zip')
    expect(response.status()).toBe(200)
    expect(response.headers()['content-type']).toContain('application/zip')
    expect(response.headers()['content-disposition']).toContain('attachment')
  })

  test('rejects an unknown format', async ({ page }) => {
    await signIn(page)
    const response = await page.request.get('/api/admin/qr?format=docx')
    expect(response.status()).toBe(400)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:e2e tests/e2e/qr-download.spec.ts`
Expected: FAIL — the route 404s.

- [ ] **Step 3: Implement `src/app/api/admin/qr/route.ts`**

```ts
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { getEnv } from '@/lib/env'
import { requireRole } from '@/lib/auth/guard'
import { listInviteTokens } from '@/lib/invites/repository'
import { inviteUrl, buildQrPdf, buildQrZip } from '@/lib/invites/qr'

export const dynamic = 'force-dynamic'

const querySchema = z.object({
  format: z.enum(['pdf', 'zip']),
  status: z.enum(['PENDING', 'ATTENDING', 'DECLINED', 'PARTIAL']).optional(),
})

export async function GET(request: Request): Promise<Response> {
  // Redirects to /admin/login for anonymous callers.
  await requireRole('ADMIN')

  const url = new URL(request.url)
  const parsed = querySchema.safeParse({
    format: url.searchParams.get('format'),
    status: url.searchParams.get('status') ?? undefined,
  })
  if (!parsed.success) {
    return Response.json({ error: 'format must be "pdf" or "zip"' }, { status: 400 })
  }

  const { APP_URL } = getEnv()
  const invites = await listInviteTokens(
    prisma,
    parsed.data.status ? { status: parsed.data.status } : {},
  )
  const items = invites.map((invite) => ({
    label: invite.label,
    url: inviteUrl(invite.token, APP_URL),
  }))

  const isPdf = parsed.data.format === 'pdf'
  const body = isPdf ? await buildQrPdf(items) : await buildQrZip(items)

  return new Response(new Uint8Array(body), {
    status: 200,
    headers: {
      'Content-Type': isPdf ? 'application/pdf' : 'application/zip',
      'Content-Disposition': `attachment; filename="gala-qr-codes.${isPdf ? 'pdf' : 'zip'}"`,
      'Cache-Control': 'no-store',
    },
  })
}
```

- [ ] **Step 4: Run the E2E test**

Run: `npm run test:e2e tests/e2e/qr-download.spec.ts`
Expected: PASS, 4 tests × 2 projects.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/admin/qr tests/e2e/qr-download.spec.ts
git commit -m "feat: bulk QR download as PDF or ZIP"
```

---

## Task 22: Seed script

**Files:**
- Create: `prisma/seed.ts`
- Test: `tests/integration/seed.test.ts`

**Interfaces:**
- Consumes: `createAdminUser` (Task 14), `createInvite` (Task 16), `getEnv` (Task 2)
- Produces: `seed(db: PrismaClient, env: SeedEnv): Promise<SeedSummary>` where `SeedEnv` is `{ ADMIN_SEED_EMAIL: string; ADMIN_SEED_PASSWORD: string }` and `SeedSummary` is `{ ownerCreated: boolean; eventCreated: boolean; invitesCreated: number }`. The default export runs `seed(prisma, getEnv())`.

Seeding is **idempotent** — running it twice must not duplicate the owner, the event, or the sample invites.

- [ ] **Step 1: Write the failing test**

`tests/integration/seed.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { testDb, resetDb } from '../helpers/db'
import { seed } from '../../prisma/seed'

const ENV = {
  ADMIN_SEED_EMAIL: 'owner@example.com',
  ADMIN_SEED_PASSWORD: 'seeded password 1',
}

beforeEach(resetDb)
afterAll(() => testDb.$disconnect())

describe('seed', () => {
  it('creates an owner, an event, agenda items, and meal options', async () => {
    const summary = await seed(testDb, ENV)
    expect(summary.ownerCreated).toBe(true)
    expect(summary.eventCreated).toBe(true)

    const owner = await testDb.adminUser.findUniqueOrThrow({ where: { email: ENV.ADMIN_SEED_EMAIL } })
    expect(owner.role).toBe('OWNER')
    expect(await testDb.event.count()).toBe(1)
    expect(await testDb.agendaItem.count()).toBeGreaterThan(0)
    expect(await testDb.mealOption.count()).toBeGreaterThan(0)
  })

  it('creates sample invites with recoverable tokens', async () => {
    const summary = await seed(testDb, ENV)
    expect(summary.invitesCreated).toBeGreaterThan(0)
    const invites = await testDb.invite.findMany()
    expect(invites.every((i) => i.tokenCipher.startsWith('v1.'))).toBe(true)
  })

  it('is idempotent — a second run creates nothing new', async () => {
    await seed(testDb, ENV)
    const counts = {
      users: await testDb.adminUser.count(),
      events: await testDb.event.count(),
      invites: await testDb.invite.count(),
      agenda: await testDb.agendaItem.count(),
      meals: await testDb.mealOption.count(),
    }

    const second = await seed(testDb, ENV)
    expect(second).toEqual({ ownerCreated: false, eventCreated: false, invitesCreated: 0 })
    expect(await testDb.adminUser.count()).toBe(counts.users)
    expect(await testDb.event.count()).toBe(counts.events)
    expect(await testDb.invite.count()).toBe(counts.invites)
    expect(await testDb.agendaItem.count()).toBe(counts.agenda)
    expect(await testDb.mealOption.count()).toBe(counts.meals)
  })

  it('sets an RSVP deadline before the event start', async () => {
    await seed(testDb, ENV)
    const event = await testDb.event.findFirstOrThrow()
    expect(event.rsvpDeadline.getTime()).toBeLessThan(event.startsAt.getTime())
  })

  it('marks the seeded owner as needing a password change', async () => {
    await seed(testDb, ENV)
    const owner = await testDb.adminUser.findUniqueOrThrow({ where: { email: ENV.ADMIN_SEED_EMAIL } })
    expect(owner.mustChangePassword).toBe(true)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/integration/seed.test.ts`
Expected: FAIL — cannot resolve `../../prisma/seed`.

- [ ] **Step 3: Implement `prisma/seed.ts`**

```ts
import { PrismaClient } from '@prisma/client'
import { createAdminUser } from '../src/lib/admin-users/repository'
import { createInvite } from '../src/lib/invites/repository'
import { getEnv } from '../src/lib/env'

export type SeedEnv = { ADMIN_SEED_EMAIL: string; ADMIN_SEED_PASSWORD: string }
export type SeedSummary = { ownerCreated: boolean; eventCreated: boolean; invitesCreated: number }

/** Placeholder event content. Replace via the admin Event screen, not by editing this file. */
const EVENT = {
  name: 'The 2026 Annual Gala',
  tagline: 'An evening of recognition',
  startsAt: new Date('2026-11-14T18:00:00Z'),
  timezone: 'America/New_York',
  venueName: 'The Grand Hall',
  address: '1 Placeholder Avenue, New York, NY',
  dressCode: 'Black tie',
  rsvpDeadline: new Date('2026-10-24T23:59:00Z'),
}

const AGENDA = [
  { title: 'Cocktail reception', startsAt: new Date('2026-11-14T18:00:00Z'), description: 'Champagne and canapés in the atrium.' },
  { title: 'Dinner service', startsAt: new Date('2026-11-14T19:00:00Z'), description: 'Seated dinner in the Grand Hall.' },
  { title: 'Awards programme', startsAt: new Date('2026-11-14T20:30:00Z'), description: 'Recognition of the year.' },
  { title: 'After-party', startsAt: new Date('2026-11-14T22:00:00Z'), description: 'Live music in the mezzanine bar.' },
]

const MEALS = [
  { label: 'Beef', description: 'Braised short rib with root vegetables' },
  { label: 'Fish', description: 'Pan-seared halibut with fennel' },
  { label: 'Vegetarian', description: 'Wild mushroom risotto' },
  { label: 'Vegan', description: 'Charred aubergine with tahini and grains' },
]

const SAMPLE_INVITES = [
  { label: 'Reyes Party', seatsAllotted: 2, tableNumber: '4', primaryGuest: { firstName: 'Jordan', lastName: 'Reyes', email: 'jordan.reyes@example.com', company: 'Northwind', title: 'VP Operations' } },
  { label: 'Okafor Party', seatsAllotted: 4, tableNumber: '7', primaryGuest: { firstName: 'Ada', lastName: 'Okafor', email: 'ada.okafor@example.com', company: 'Acme Corp', title: 'Chief Counsel' } },
  { label: 'Lindqvist Party', seatsAllotted: 1, tableNumber: '2', primaryGuest: { firstName: 'Mira', lastName: 'Lindqvist', email: 'mira.lindqvist@example.com', company: 'Helios', title: 'Director of Research' } },
]

export async function seed(db: PrismaClient, env: SeedEnv): Promise<SeedSummary> {
  const email = env.ADMIN_SEED_EMAIL.trim().toLowerCase()

  let ownerCreated = false
  if (!(await db.adminUser.findUnique({ where: { email }, select: { id: true } }))) {
    const owner = await createAdminUser(db, null, {
      email,
      name: 'Event Owner',
      role: 'OWNER',
      password: env.ADMIN_SEED_PASSWORD,
    })
    await db.adminUser.update({ where: { id: owner.id }, data: { mustChangePassword: true } })
    ownerCreated = true
  }

  let eventCreated = false
  if ((await db.event.count()) === 0) {
    await db.event.create({
      data: {
        ...EVENT,
        agendaItems: { create: AGENDA.map((item, index) => ({ ...item, sortOrder: index })) },
        mealOptions: { create: MEALS.map((meal, index) => ({ ...meal, sortOrder: index })) },
      },
    })
    eventCreated = true
  }

  let invitesCreated = 0
  if ((await db.invite.count()) === 0) {
    for (const invite of SAMPLE_INVITES) {
      await createInvite(db, null, invite)
      invitesCreated++
    }
  }

  return { ownerCreated, eventCreated, invitesCreated }
}

if (process.argv[1]?.includes('seed')) {
  const prisma = new PrismaClient()
  seed(prisma, getEnv())
    .then((summary) => {
      console.log('Seed complete:', summary)
    })
    .catch((error: unknown) => {
      console.error('Seed failed:', error)
      process.exitCode = 1
    })
    .finally(() => prisma.$disconnect())
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/integration/seed.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Seed the development database**

Run: `npm run db:seed`
Expected: `Seed complete: { ownerCreated: true, eventCreated: true, invitesCreated: 3 }`.
Sign in at `/admin/login` with `ADMIN_SEED_EMAIL` and `ADMIN_SEED_PASSWORD`.

- [ ] **Step 6: Commit**

```bash
git add prisma/seed.ts tests/integration/seed.test.ts
git commit -m "feat: idempotent database seed"
```

---

## Task 23: CI pipeline and coverage gate

**Files:**
- Create: `.github/workflows/ci.yml`, `README.md`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: every `npm` script from Task 1
- Produces: a CI workflow that fails on lint errors, type errors, test failures, coverage below 80%, or a broken build.

- [ ] **Step 1: Confirm the coverage gate fails when it should**

Run: `npm run test:coverage`
Expected: PASS with all four thresholds (lines, functions, branches, statements) at or above 80%. If any is below, add the missing tests before continuing — do not lower the threshold.

- [ ] **Step 2: Write the workflow**

`.github/workflows/ci.yml`:

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  verify:
    runs-on: ubuntu-latest

    services:
      mongo:
        image: mongo:8
        ports: ['27018:27017']
        options: >-
          --health-cmd "mongosh --quiet --eval 'db.adminCommand({ping:1})'"
          --health-interval 10s
          --health-timeout 5s
          --health-retries 10
        env:
          MONGO_INITDB_DATABASE: gala

    env:
      DATABASE_URL: mongodb://127.0.0.1:27018/gala?replicaSet=rs0&directConnection=true
      DATABASE_URL_TEST: mongodb://127.0.0.1:27018/gala_test?replicaSet=rs0&directConnection=true
      APP_URL: http://localhost:3000
      SESSION_SECRET: ci-session-secret-at-least-32-characters
      ADMIN_SEED_EMAIL: owner@example.com
      ADMIN_SEED_PASSWORD: ci-seed-password-1

    steps:
      - uses: actions/checkout@v4

      - uses: uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm

      - run: npm ci

      - name: Promote MongoDB to a single-node replica set
        run: |
          npx -y mongosh@2 --quiet --port 27018 --eval             'rs.initiate({_id:"rs0",members:[{_id:0,host:"127.0.0.1:27018"}]})' || true
          npx -y mongosh@2 --quiet --port 27018 --eval             'for(let i=0;i<30;i++){if(rs.status().myState===1){quit(0)};sleep(1000)};quit(1)'

      - name: Push the schema to both databases
        run: |
          npx prisma db push
          DATABASE_URL="$DATABASE_URL_TEST" npx prisma db push

      - run: npm run typecheck
      - run: npm run lint
      - run: npm run test:coverage

      - name: Install Playwright browsers
        run: npx playwright install --with-deps chromium

      - run: npm run test:e2e

      - uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: playwright-report
          path: playwright-report/
          retention-days: 7
```

- [ ] **Step 3: Write the README**

`README.md`:

````markdown
# Gala RSVP Portal

QR-based RSVP portal for a single corporate gala, with an admin backend for
guest-list management, QR generation, and door check-in.

## Requirements

- Node.js 20.11 or later
- npm 10
- MongoDB 8 (Community is fine) - the repo starts its own replica set on port 27018

## Setup

```bash
npm install
cp .env.example .env        # then fill in DATABASE_URL and SESSION_SECRET
mkdir -p .mongo/data && npm run db:start &     # local replica set on 27018
npx -y mongosh@2 --quiet --port 27018 --eval 'rs.initiate({_id:"rs0",members:[{_id:0,host:"127.0.0.1:27018"}]})'
npx prisma db push
DATABASE_URL="mongodb://127.0.0.1:27018/gala_test?replicaSet=rs0" npx prisma db push
npm run db:seed
npm run dev
```

Sign in at http://localhost:3000/admin/login using `ADMIN_SEED_EMAIL` and
`ADMIN_SEED_PASSWORD`. Change the password immediately.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Development server |
| `npm test` | Unit and integration tests |
| `npm run test:coverage` | Tests with the 80% coverage gate |
| `npm run test:e2e` | Playwright end-to-end tests |
| `npm run typecheck` | TypeScript, no emit |
| `npm run db:start` | Local MongoDB replica set on port 27018 |
| `npm run db:push` | Sync the Prisma schema to MongoDB |
| `npm run db:seed` | Idempotent seed |

## Environment

Every variable in `.env.example` is required; the app refuses to start without
them. `SESSION_SECRET` both signs sessions and encrypts invite tokens at rest —
**rotating it makes existing QR codes unrecoverable for bulk re-export.** Guests
can still scan their codes (lookup uses the hash), but you would have to
regenerate tokens to reprint a sheet.

## Documentation

- Design: `docs/superpowers/specs/2026-08-21-gala-rsvp-portal-design.md`
- Plan: `docs/superpowers/plans/2026-08-21-foundation-and-admin-backend.md`
````

- [ ] **Step 4: Verify the whole suite locally**

Run: `npm run typecheck && npm run lint && npm run test:coverage && npm run test:e2e`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/ci.yml README.md .gitignore
git commit -m "ci: verification pipeline with coverage gate"
```

---

## Definition of done

Plan 1 is complete when all of the following are true:

- [ ] `npm run typecheck`, `npm run lint`, `npm run test:coverage`, and `npm run test:e2e` all pass locally and in CI
- [ ] Coverage is at or above 80% on lines, functions, branches, and statements
- [ ] An OWNER can sign in, create an ADMIN and a STAFF user, and cannot demote or deactivate the last OWNER
- [ ] A STAFF user signing in lands on `/admin/checkin` and is redirected away from `/admin`, `/admin/invites`, and `/admin/users`
- [ ] A 500-row CSV imports in one transaction, with per-row errors shown before commit and no partial writes on failure
- [ ] `/api/admin/qr?format=pdf` returns a printable sheet whose codes resolve to `/i/<token>` URLs
- [ ] Every admin mutation appears in `AuditLog` with the acting user
- [ ] No plaintext invite token appears in any log, audit row, or error message

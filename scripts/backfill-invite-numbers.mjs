// One-time migration for databases created before Invite.number existed.
//
// `Invite.number` is required and unique. Run this BEFORE `npm run db:push`
// on a database that already holds invites: MongoDB cannot build the unique
// index while more than one document lacks the field (they all collide on
// `null`), so the push itself fails until every invite is numbered. And
// even once the index exists, Prisma refuses to read a document missing a
// required field, so an unnumbered invite would 500 the admin list.
//
// Numbers are assigned in creation order, 1..n, to invites that have none.
// Invites that already carry a number are left alone, and new numbers
// continue after the highest existing one. Safe to re-run.
//
//   node scripts/backfill-invite-numbers.mjs
//   npm run db:push
//
// Reads DATABASE_URL from the environment (or .env) like the app does.

import { config } from 'dotenv'
import { PrismaClient } from '@prisma/client'

config({ path: '.env' })

const db = new PrismaClient()

try {
  // Prisma's typed client cannot select documents whose required field is
  // absent, so this runs as raw MongoDB commands against the collection.
  const unnumbered = await db.$runCommandRaw({
    find: 'Invite',
    filter: { number: { $exists: false } },
    projection: { _id: 1, createdAt: 1 },
    sort: { createdAt: 1 },
    batchSize: 10_000,
  })
  const docs = unnumbered.cursor?.firstBatch ?? []

  const highest = await db.$runCommandRaw({
    find: 'Invite',
    filter: { number: { $exists: true } },
    projection: { number: 1 },
    sort: { number: -1 },
    limit: 1,
  })
  let next = (highest.cursor?.firstBatch?.[0]?.number ?? 0) + 1

  if (docs.length === 0) {
    console.log('Every invite already has a number; nothing to do.')
  } else {
    const updates = docs.map((doc) => ({
      q: { _id: doc._id },
      u: { $set: { number: next++ } },
    }))
    const result = await db.$runCommandRaw({ update: 'Invite', updates })
    console.log(`Numbered ${result.nModified ?? result.n} invite(s); next free number is ${next}.`)
  }
} finally {
  await db.$disconnect()
}

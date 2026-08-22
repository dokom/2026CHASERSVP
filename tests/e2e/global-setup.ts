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

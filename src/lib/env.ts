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

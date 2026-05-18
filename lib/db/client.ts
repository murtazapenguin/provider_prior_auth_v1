import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@/app/generated/prisma/client'

function makePrismaClient() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set')
  const pool = new Pool({ connectionString: url })
  const adapter = new PrismaPg(pool)
  return new PrismaClient({ adapter })
}

// Lazy proxy — the Pool is created on first property access, not at import time.
// This prevents issues when DATABASE_URL is loaded by dotenv after module imports.
let _client: PrismaClient | undefined

function getClient(): PrismaClient {
  if (!_client) _client = makePrismaClient()
  return _client
}

type PrismaClientType = PrismaClient

export const prisma: PrismaClientType = new Proxy({} as PrismaClientType, {
  get(_target, prop: string | symbol) {
    const client = getClient()
    const value = (client as unknown as Record<string | symbol, unknown>)[prop]
    return typeof value === 'function' ? (value as Function).bind(client) : value
  },
})

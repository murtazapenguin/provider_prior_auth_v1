import { describe, it, expect } from 'vitest'

describe('smoke', () => {
  it('arithmetic works', () => {
    expect(1 + 1).toBe(2)
  })

  it('path alias @/lib resolves', async () => {
    // Dynamically import — confirms the @/* alias is wired up.
    // No DB connection needed (Prisma client is a lazy singleton).
    const mod = await import('@/lib/ai/index')
    expect(typeof mod.aiHealth).toBe('function')
    expect(typeof mod.aiFetch).toBe('function')
  })
})

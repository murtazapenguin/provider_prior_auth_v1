import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/client'
import { fastForward } from '@/lib/payer/simulator'

export async function POST() {
  const result = await fastForward(prisma)
  return NextResponse.json(result)
}

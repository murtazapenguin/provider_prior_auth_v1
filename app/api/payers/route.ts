import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/client'

export async function GET() {
  const payers = await prisma.payer.findMany({
    orderBy: { name: 'asc' },
    select: { id: true, name: true },
  })
  return NextResponse.json(payers)
}

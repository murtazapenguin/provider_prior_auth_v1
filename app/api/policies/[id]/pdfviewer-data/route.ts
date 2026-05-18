import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/client'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const policy = await prisma.policy.findUnique({
    where: { id },
    select: { pageImages: true },
  })

  if (!policy) return NextResponse.json({ error: 'Policy not found' }, { status: 404 })
  if (!policy.pageImages) return NextResponse.json({ error: 'No page images for this policy' }, { status: 404 })

  return NextResponse.json(policy.pageImages)
}

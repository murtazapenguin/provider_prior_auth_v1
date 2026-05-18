import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/client'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const q = (searchParams.get('q') ?? '').trim()

  const patients = await prisma.patient.findMany({
    where: q
      ? {
          OR: [
            { firstName: { contains: q, mode: 'insensitive' } },
            { lastName: { contains: q, mode: 'insensitive' } },
          ],
        }
      : undefined,
    select: { id: true, firstName: true, lastName: true, dob: true },
    orderBy: { lastName: 'asc' },
    take: 20,
  })

  return NextResponse.json(patients)
}

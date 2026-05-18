import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db/client'
import { getProviderId } from '@/lib/api/auth'
import { recordEvent } from '@/lib/audit/log'

const CodeSchema = z.object({
  codeType: z.enum(['CPT', 'HCPCS', 'J', 'Q', 'ICD10']),
  code: z.string(),
  modifier: z.string().optional(),
  description: z.string(),
  isPrimary: z.boolean(),
  derivedBy: z.enum(['ai', 'provider', 'ai-then-confirmed']),
  confidence: z.number().min(0).max(1).optional(),
})

const BodySchema = z.object({ codes: z.array(CodeSchema).min(1) })

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const providerId = getProviderId(request)

  const parsed = BodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ detail: parsed.error.issues[0]?.message ?? 'Invalid request' }, { status: 400 })
  }

  const pa = await prisma.priorAuth.findUnique({ where: { id } })
  if (!pa) return NextResponse.json({ detail: `PA '${id}' not found` }, { status: 404 })

  await prisma.priorAuthCode.deleteMany({ where: { priorAuthId: id } })

  await prisma.priorAuthCode.createMany({
    data: parsed.data.codes.map((c) => ({ ...c, priorAuthId: id })),
  })

  await recordEvent({
    priorAuthId: id,
    type: 'codes_updated',
    actor: providerId,
    metadata: { count: parsed.data.codes.length },
  })

  return NextResponse.json({ ok: true })
}

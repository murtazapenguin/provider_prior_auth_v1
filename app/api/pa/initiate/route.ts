import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db/client'
import type { Prisma } from '@/app/generated/prisma/client'
import { getProviderId } from '@/lib/api/auth'
import { findApplicablePolicies } from '@/lib/policies/lookup'

const BodySchema = z.object({
  codeType: z.enum(['CPT', 'HCPCS']),
  code: z.string().min(1),
  payerId: z.string().min(1),
  patientId: z.string().optional(),
  newPatient: z
    .object({
      firstName: z.string().min(1),
      lastName: z.string().min(1),
      dob: z.string(),
      sex: z.string().min(1),
      memberId: z.string().min(1),
      planName: z.string().min(1),
    })
    .optional(),
  priority: z.enum(['standard', 'expedited', 'urgent']).default('standard'),
  priorityRationale: z.string().optional(),
})

export async function POST(request: Request) {
  const providerId = getProviderId(request)

  const parsed = BodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ detail: 'Invalid request body', errors: parsed.error.flatten() }, { status: 400 })
  }
  const body = parsed.data

  // Pre-flight validation (outside transaction so we can return clean 4xx codes).
  const payer = await prisma.payer.findUnique({ where: { id: body.payerId } })
  if (!payer) {
    return NextResponse.json({ detail: `Payer '${body.payerId}' not found` }, { status: 422 })
  }

  const policies = await findApplicablePolicies(prisma, {
    codeType: body.codeType,
    code: body.code,
    coverage: { payerId: body.payerId },
  })

  if (policies.length === 0) {
    return NextResponse.json({ necessityStatus: 'not_required' })
  }

  const hasPatient = body.patientId != null || body.newPatient != null
  if (!hasPatient) {
    return NextResponse.json({
      necessityStatus: 'pa_required',
      policyTitle: policies[0].title,
    })
  }

  // We're going to actually create the PA — enforce the rationale rule.
  if (
    body.priority !== 'standard' &&
    (!body.priorityRationale || body.priorityRationale.trim().length === 0)
  ) {
    return NextResponse.json(
      { detail: 'Rationale is required for Expedited / Urgent PAs' },
      { status: 400 }
    )
  }

  // If existing patient was supplied, verify it before opening the transaction.
  if (body.patientId != null) {
    const existing = await prisma.patient.findUnique({ where: { id: body.patientId } })
    if (!existing) {
      return NextResponse.json({ detail: `Patient '${body.patientId}' not found` }, { status: 404 })
    }
  }

  // Atomic write: patient (if new) + coverage + encounter + PA + code + audit event.
  // If any step fails, the whole chain rolls back so we never leave orphan rows.
  const paId = await prisma.$transaction(async (tx) => {
    let patientId: string

    if (body.patientId != null) {
      patientId = body.patientId
    } else {
      const np = body.newPatient!
      const patient = await tx.patient.create({
        data: {
          firstName: np.firstName,
          lastName: np.lastName,
          dob: new Date(np.dob),
          sex: np.sex,
        },
      })
      await tx.coverage.create({
        data: {
          patientId: patient.id,
          payerId: body.payerId,
          planName: np.planName,
          memberId: np.memberId,
          benefitCategory: 'medical',
          effectiveFrom: new Date(),
          isPrimary: true,
        },
      })
      patientId = patient.id
    }

    const encounter = await tx.encounter.create({
      data: {
        patientId,
        providerId,
        encounterDate: new Date(),
        placeOfService: '11',
      },
    })

    const pa = await tx.priorAuth.create({
      data: {
        encounterId: encounter.id,
        providerId,
        payerId: body.payerId,
        status: 'draft',
        priority: body.priority,
        priorityRationale:
          body.priority === 'standard'
            ? null
            : body.priorityRationale?.trim() ?? null,
      },
    })

    await tx.priorAuthCode.create({
      data: {
        priorAuthId: pa.id,
        codeType: body.codeType,
        code: body.code.toUpperCase(),
        description: '',
        isPrimary: true,
        derivedBy: 'provider',
      },
    })

    await tx.paEvent.create({
      data: {
        priorAuthId: pa.id,
        type: 'pa_created',
        fromStatus: null,
        toStatus: null,
        actor: providerId,
        metadata: {
          encounterId: encounter.id,
          payerId: body.payerId,
          initiatedManually: true,
        } as Prisma.InputJsonValue,
      },
    })

    return pa.id
  })

  return NextResponse.json(
    {
      necessityStatus: 'pa_required',
      paId,
      policyTitle: policies[0].title,
    },
    { status: 201 }
  )
}

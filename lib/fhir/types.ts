/**
 * lib/fhir/types.ts
 *
 * Zod schemas + inferred TS types for the subset of FHIR R4 resources our
 * domain consumes. We deliberately model only the fields we read — discarding
 * the rest keeps the boundary narrow and our adapters honest.
 *
 * R4 spec: https://www.hl7.org/fhir/R4/resourcelist.html
 * Epic specifics: https://fhir.epic.com/Specifications
 *
 * Notes on Epic quirks captured here:
 *  - `Coverage.status` is optional in some Epic versions; caller treats
 *    `undefined` as "active". (Schema makes it optional.)
 *  - `Encounter.period.end` is `null` for active encounters; the Period
 *    schema accepts `null` on `end` to reflect that.
 *  - `Observation.value[x]` is polymorphic. We model `valueQuantity` and
 *    `valueCodeableConcept` (the most common in cards we read) and also
 *    accept `valueString` / `valueBoolean` opportunistically. Others are
 *    discarded.
 */

import { z } from 'zod'

/* ───────────────────────────────────────────────────────────────────────────
 *  Shared primitive shapes
 * ───────────────────────────────────────────────────────────────────────── */

export const CodingSchema = z.object({
  system: z.string().optional(),
  code: z.string().optional(),
  display: z.string().optional(),
})
export type Coding = z.infer<typeof CodingSchema>

export const CodeableConceptSchema = z.object({
  text: z.string().optional(),
  coding: z.array(CodingSchema).optional(),
})
export type CodeableConcept = z.infer<typeof CodeableConceptSchema>

export const ReferenceSchema = z.object({
  reference: z.string().optional(),
  display: z.string().optional(),
  type: z.string().optional(),
})
export type Reference = z.infer<typeof ReferenceSchema>

export const IdentifierSchema = z.object({
  system: z.string().optional(),
  value: z.string().optional(),
  use: z.string().optional(),
  type: CodeableConceptSchema.optional(),
})
export type Identifier = z.infer<typeof IdentifierSchema>

export const HumanNameSchema = z.object({
  use: z.string().optional(),
  text: z.string().optional(),
  family: z.string().optional(),
  given: z.array(z.string()).optional(),
  prefix: z.array(z.string()).optional(),
  suffix: z.array(z.string()).optional(),
})
export type HumanName = z.infer<typeof HumanNameSchema>

/**
 * Period.end is nullable (Epic returns `null` for active encounters).
 */
export const PeriodSchema = z.object({
  start: z.string().optional(),
  end: z.string().nullable().optional(),
})
export type Period = z.infer<typeof PeriodSchema>

export const QuantitySchema = z.object({
  value: z.number().optional(),
  unit: z.string().optional(),
  system: z.string().optional(),
  code: z.string().optional(),
  comparator: z.string().optional(),
})
export type Quantity = z.infer<typeof QuantitySchema>

export const AttachmentSchema = z.object({
  contentType: z.string().optional(),
  url: z.string().optional(),
  title: z.string().optional(),
  data: z.string().optional(),
  size: z.number().optional(),
  creation: z.string().optional(),
  language: z.string().optional(),
})
export type Attachment = z.infer<typeof AttachmentSchema>

export const MetaSchema = z.object({
  versionId: z.string().optional(),
  lastUpdated: z.string().optional(),
})
export type Meta = z.infer<typeof MetaSchema>

/* ───────────────────────────────────────────────────────────────────────────
 *  Bundle (paginated search results)
 * ───────────────────────────────────────────────────────────────────────── */

export const BundleLinkSchema = z.object({
  relation: z.string(),
  url: z.string(),
})
export type BundleLink = z.infer<typeof BundleLinkSchema>

/**
 * Factory for typed Bundle schemas. Each resource adapter calls this with
 * its own entry-resource schema.
 *
 *   const PatientBundle = BundleSchema(PatientSchema)
 */
export function BundleSchema<TEntry extends z.ZodTypeAny>(entrySchema: TEntry) {
  return z.object({
    resourceType: z.literal('Bundle'),
    type: z.string(),
    total: z.number().int().optional(),
    link: z.array(BundleLinkSchema).optional(),
    entry: z
      .array(
        z.object({
          fullUrl: z.string().optional(),
          resource: entrySchema,
        }),
      )
      .optional(),
  })
}

/* ───────────────────────────────────────────────────────────────────────────
 *  Patient
 *  Spec: https://www.hl7.org/fhir/R4/patient.html
 *  Epic notes: https://fhir.epic.com/Specifications (Patient.Read R4)
 *
 *  Strict-enum on `gender`: R4 fixed value set {male, female, other, unknown}.
 *  If a tenant returns off-spec we'd rather fail validation than silently
 *  swallow the discrepancy.
 * ───────────────────────────────────────────────────────────────────────── */

export const PatientSchema = z.object({
  resourceType: z.literal('Patient'),
  id: z.string(),
  meta: MetaSchema.optional(),
  identifier: z.array(IdentifierSchema).optional(),
  active: z.boolean().optional(),
  name: z.array(HumanNameSchema).optional(),
  telecom: z
    .array(z.object({ system: z.string().optional(), value: z.string().optional(), use: z.string().optional() }))
    .optional(),
  gender: z.enum(['male', 'female', 'other', 'unknown']).optional(),
  birthDate: z.string().optional(),
  deceasedBoolean: z.boolean().optional(),
  deceasedDateTime: z.string().optional(),
})
export type Patient = z.infer<typeof PatientSchema>

/* ───────────────────────────────────────────────────────────────────────────
 *  Encounter
 *  Spec: https://www.hl7.org/fhir/R4/encounter.html
 * ───────────────────────────────────────────────────────────────────────── */

export const EncounterSchema = z.object({
  resourceType: z.literal('Encounter'),
  id: z.string(),
  meta: MetaSchema.optional(),
  status: z.string(),
  class: CodingSchema.optional(),
  type: z.array(CodeableConceptSchema).optional(),
  serviceType: CodeableConceptSchema.optional(),
  subject: ReferenceSchema.optional(),
  period: PeriodSchema.optional(),
  participant: z
    .array(
      z.object({
        type: z.array(CodeableConceptSchema).optional(),
        individual: ReferenceSchema.optional(),
      }),
    )
    .optional(),
  reasonCode: z.array(CodeableConceptSchema).optional(),
  serviceProvider: ReferenceSchema.optional(),
})
export type Encounter = z.infer<typeof EncounterSchema>

/* ───────────────────────────────────────────────────────────────────────────
 *  Coverage
 *  Spec: https://www.hl7.org/fhir/R4/coverage.html
 *
 *  Epic quirk: `.status` is optional. Callers default missing to "active".
 * ───────────────────────────────────────────────────────────────────────── */

export const CoverageClassSchema = z.object({
  type: CodeableConceptSchema.optional(),
  value: z.string().optional(),
  name: z.string().optional(),
})
export type CoverageClass = z.infer<typeof CoverageClassSchema>

export const CoverageSchema = z.object({
  resourceType: z.literal('Coverage'),
  id: z.string(),
  meta: MetaSchema.optional(),
  status: z.string().optional(),
  type: CodeableConceptSchema.optional(),
  subscriberId: z.string().optional(),
  beneficiary: ReferenceSchema.optional(),
  payor: z.array(ReferenceSchema).optional(),
  class: z.array(CoverageClassSchema).optional(),
  identifier: z.array(IdentifierSchema).optional(),
  period: PeriodSchema.optional(),
  relationship: CodeableConceptSchema.optional(),
})
export type Coverage = z.infer<typeof CoverageSchema>

/* ───────────────────────────────────────────────────────────────────────────
 *  Practitioner
 *  Spec: https://www.hl7.org/fhir/R4/practitioner.html
 * ───────────────────────────────────────────────────────────────────────── */

export const PractitionerSchema = z.object({
  resourceType: z.literal('Practitioner'),
  id: z.string(),
  meta: MetaSchema.optional(),
  identifier: z.array(IdentifierSchema).optional(),
  active: z.boolean().optional(),
  name: z.array(HumanNameSchema).optional(),
  qualification: z
    .array(
      z.object({
        identifier: z.array(IdentifierSchema).optional(),
        code: CodeableConceptSchema.optional(),
        period: PeriodSchema.optional(),
      }),
    )
    .optional(),
})
export type Practitioner = z.infer<typeof PractitionerSchema>

/* ───────────────────────────────────────────────────────────────────────────
 *  ServiceRequest — "the order" (CT 70450 lives in code.coding[0].code)
 *  Spec: https://www.hl7.org/fhir/R4/servicerequest.html
 * ───────────────────────────────────────────────────────────────────────── */

export const ServiceRequestSchema = z.object({
  resourceType: z.literal('ServiceRequest'),
  id: z.string(),
  meta: MetaSchema.optional(),
  status: z.string(),
  intent: z.string(),
  category: z.array(CodeableConceptSchema).optional(),
  code: CodeableConceptSchema.optional(),
  subject: ReferenceSchema.optional(),
  encounter: ReferenceSchema.optional(),
  authoredOn: z.string().optional(),
  requester: ReferenceSchema.optional(),
  reasonCode: z.array(CodeableConceptSchema).optional(),
  reasonReference: z.array(ReferenceSchema).optional(),
})
export type ServiceRequest = z.infer<typeof ServiceRequestSchema>

/* ───────────────────────────────────────────────────────────────────────────
 *  DocumentReference + Binary
 *  Spec: https://www.hl7.org/fhir/R4/documentreference.html
 *        https://www.hl7.org/fhir/R4/binary.html
 * ───────────────────────────────────────────────────────────────────────── */

export const DocumentReferenceSchema = z.object({
  resourceType: z.literal('DocumentReference'),
  id: z.string(),
  meta: MetaSchema.optional(),
  status: z.string(),
  type: CodeableConceptSchema.optional(),
  category: z.array(CodeableConceptSchema).optional(),
  subject: ReferenceSchema.optional(),
  date: z.string().optional(),
  author: z.array(ReferenceSchema).optional(),
  description: z.string().optional(),
  content: z.array(
    z.object({
      attachment: AttachmentSchema,
      format: CodingSchema.optional(),
    }),
  ),
  context: z
    .object({
      encounter: z.array(ReferenceSchema).optional(),
      period: PeriodSchema.optional(),
    })
    .optional(),
})
export type DocumentReference = z.infer<typeof DocumentReferenceSchema>

export const BinarySchema = z.object({
  resourceType: z.literal('Binary'),
  id: z.string().optional(),
  meta: MetaSchema.optional(),
  contentType: z.string().optional(),
  data: z.string().optional(), // base64 — only present on JSON path; raw-bytes path bypasses.
})
export type Binary = z.infer<typeof BinarySchema>

/* ───────────────────────────────────────────────────────────────────────────
 *  Condition
 *  Spec: https://www.hl7.org/fhir/R4/condition.html
 * ───────────────────────────────────────────────────────────────────────── */

export const ConditionSchema = z.object({
  resourceType: z.literal('Condition'),
  id: z.string(),
  meta: MetaSchema.optional(),
  clinicalStatus: CodeableConceptSchema.optional(),
  verificationStatus: CodeableConceptSchema.optional(),
  category: z.array(CodeableConceptSchema).optional(),
  severity: CodeableConceptSchema.optional(),
  code: CodeableConceptSchema.optional(),
  subject: ReferenceSchema.optional(),
  encounter: ReferenceSchema.optional(),
  onsetDateTime: z.string().optional(),
  onsetPeriod: PeriodSchema.optional(),
  recordedDate: z.string().optional(),
})
export type Condition = z.infer<typeof ConditionSchema>

/* ───────────────────────────────────────────────────────────────────────────
 *  Observation
 *  Spec: https://www.hl7.org/fhir/R4/observation.html
 *
 *  value[x] is polymorphic — we model the variants we consume.
 * ───────────────────────────────────────────────────────────────────────── */

export const ObservationSchema = z.object({
  resourceType: z.literal('Observation'),
  id: z.string(),
  meta: MetaSchema.optional(),
  status: z.string(),
  category: z.array(CodeableConceptSchema).optional(),
  code: CodeableConceptSchema,
  subject: ReferenceSchema.optional(),
  encounter: ReferenceSchema.optional(),
  effectiveDateTime: z.string().optional(),
  effectivePeriod: PeriodSchema.optional(),
  issued: z.string().optional(),
  valueQuantity: QuantitySchema.optional(),
  valueCodeableConcept: CodeableConceptSchema.optional(),
  valueString: z.string().optional(),
  valueBoolean: z.boolean().optional(),
})
export type Observation = z.infer<typeof ObservationSchema>

/**
 * lib/smart/postLaunchRouting.ts
 *
 * Pure post-launch routing logic. Once a SmartSession exists (real OAuth
 * callback OR mock-mode standalone seeding), this decides where the
 * provider lands:
 *
 *   encounterContext + existing PriorAuth     →  /pa/{paId}
 *   encounterContext + no PriorAuth           →  /queue?encounter={encounterId}
 *   patientContext only (no encounter)        →  /queue?patient={patientId}
 *   neither                                   →  /queue
 *
 * The Prisma client is injected so this stays unit-testable without a
 * live DB and reusable across mock-mode standalone launch + (future)
 * real OAuth callback paths.
 *
 * Note: `encounterContext` and `patientContext` are FHIR resource ids in
 * the same format Epic returns and our seed fixtures use (e.g.
 * "encounter-botox", "patient-priya-shah"). Encounter.id and Patient.id
 * in our Prisma schema use those same values, so a direct findUnique
 * by id is the correct lookup.
 */

export interface PostLaunchRoutingInput {
  patientContext: string | null
  encounterContext: string | null
}

export interface PostLaunchPrismaLike {
  priorAuth: {
    findFirst(args: {
      where: { encounterId: string }
      select?: { id: true }
    }): Promise<{ id: string } | null>
  }
}

/**
 * Compute the post-launch destination URL.
 *
 * Returns a path that the caller passes to `next/navigation.redirect()`.
 * The returned path is always app-internal (always starts with "/").
 */
export async function computePostLaunchDestination(
  input: PostLaunchRoutingInput,
  prisma: PostLaunchPrismaLike,
): Promise<string> {
  if (input.encounterContext) {
    const existing = await prisma.priorAuth.findFirst({
      where: { encounterId: input.encounterContext },
      select: { id: true },
    })
    if (existing) {
      return `/pa/${existing.id}`
    }
    return `/queue?encounter=${encodeURIComponent(input.encounterContext)}`
  }

  if (input.patientContext) {
    return `/queue?patient=${encodeURIComponent(input.patientContext)}`
  }

  return '/queue'
}

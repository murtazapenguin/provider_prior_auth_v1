/**
 * Payer-policies catalog query — drives the /payer-policies tab.
 *
 * Returns one bucket per payer with at least one policy, including
 * per-payer counts, service-category breakdown, and the policy list
 * sorted alphabetically (policies without codes pushed to the bottom).
 *
 * Multi-payer ready: the page renders whatever the DB has — adding a
 * new payer's policies is purely an ingestion concern.
 */

import { prisma } from '@/lib/db/client'
import { categorizeCode, type ServiceCategory } from './serviceCategory'

export interface PayerPolicyRow {
  id: string
  title: string
  publishStatus: string
  criteriaCount: number
  codeCount: number
  /** Derived from the policy's first applicable code; null when codeless. */
  category: ServiceCategory | null
}

export interface ServiceBreakdownEntry {
  key: string
  label: string
  chipClass: string
  count: number
}

export interface PayerPolicyBucket {
  payer: { id: string; name: string; shortCode: string }
  policies: PayerPolicyRow[]
  totalCount: number
  reachableCount: number
  serviceBreakdown: ServiceBreakdownEntry[]
}

export async function getPayerPolicyBuckets(): Promise<PayerPolicyBucket[]> {
  // Payers with at least one policy.
  const payers = await prisma.payer.findMany({
    where: { policies: { some: {} } },
    orderBy: { name: 'asc' },
    include: {
      policies: {
        orderBy: { title: 'asc' },
        select: {
          id: true,
          title: true,
          publishStatus: true,
          _count: { select: { criteria: true, applicableCodes: true } },
          applicableCodes: {
            select: { codeType: true, code: true },
            take: 1,
          },
        },
      },
    },
  })

  return payers
    .map((payer) => {
      const policies: PayerPolicyRow[] = payer.policies.map((p) => {
        const firstCode = p.applicableCodes[0]
        const category = firstCode ? categorizeCode(firstCode.codeType, firstCode.code) : null
        return {
          id: p.id,
          title: p.title,
          publishStatus: p.publishStatus,
          criteriaCount: p._count.criteria,
          codeCount: p._count.applicableCodes,
          category,
        }
      })

      // Sort: policies WITH codes first (alpha), then codeless (alpha).
      policies.sort((a, b) => {
        if ((a.codeCount > 0) !== (b.codeCount > 0)) {
          return a.codeCount > 0 ? -1 : 1
        }
        return a.title.localeCompare(b.title)
      })

      const reachableCount = policies.filter((p) => p.codeCount > 0).length

      // Service-category histogram (only counts policies with codes).
      const breakdownMap: Record<string, ServiceBreakdownEntry> = {}
      for (const p of policies) {
        if (!p.category) continue
        if (!breakdownMap[p.category.key]) {
          breakdownMap[p.category.key] = {
            key: p.category.key,
            label: p.category.label,
            chipClass: p.category.chipClass,
            count: 0,
          }
        }
        breakdownMap[p.category.key].count += 1
      }
      const serviceBreakdown = Object.values(breakdownMap).sort((a, b) => b.count - a.count)

      return {
        payer: { id: payer.id, name: payer.name, shortCode: payer.shortCode },
        policies,
        totalCount: policies.length,
        reachableCount,
        serviceBreakdown,
      }
    })
    // Sort buckets by policy count desc (high-coverage payers first).
    .sort((a, b) => b.totalCount - a.totalCount)
}

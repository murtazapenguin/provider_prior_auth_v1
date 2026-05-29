/**
 * Service categorization — buckets PriorAuthCode rows into a small set of
 * service categories for dashboard rollups + colored chips.
 *
 * Their reference design uses PT / OT / ST (Physical / Occupational / Speech
 * therapy).  Our domain is broader — diverse CPT/HCPCS codes across imaging,
 * drugs, DME, procedures, labs — so we map by code prefix instead.
 */

export interface ServiceCategory {
  /** Stable key for grouping. */
  key: string
  /** Short display label (chip text). */
  label: string
  /** Tailwind color classes for the chip — bg + text. */
  chipClass: string
}

const CATEGORIES: Record<string, ServiceCategory> = {
  drug: { key: 'drug', label: 'Drug', chipClass: 'bg-purple-100 text-purple-700' },
  imaging: { key: 'imaging', label: 'Imaging', chipClass: 'bg-cyan-100 text-cyan-700' },
  procedure: { key: 'procedure', label: 'Procedure', chipClass: 'bg-pink-100 text-pink-700' },
  dme: { key: 'dme', label: 'DME', chipClass: 'bg-amber-100 text-amber-700' },
  lab: { key: 'lab', label: 'Lab', chipClass: 'bg-green-100 text-green-700' },
  evaluation: { key: 'evaluation', label: 'E&M', chipClass: 'bg-blue-100 text-blue-700' },
  other: { key: 'other', label: 'Other', chipClass: 'bg-gray-100 text-gray-700' },
}

export function categorizeCode(codeType: string, code: string): ServiceCategory {
  const upper = code.toUpperCase()
  // HCPCS J-codes are drugs.
  if (codeType === 'HCPCS' && upper.startsWith('J')) return CATEGORIES.drug
  // HCPCS E/K-codes are DME (durable medical equipment).
  if (codeType === 'HCPCS' && (upper.startsWith('E') || upper.startsWith('K'))) return CATEGORIES.dme
  if (codeType === 'CPT') {
    const n = parseInt(code.replace(/[^0-9]/g, ''), 10)
    if (Number.isFinite(n)) {
      if (n >= 70000 && n < 80000) return CATEGORIES.imaging
      if (n >= 80000 && n < 90000) return CATEGORIES.lab
      if (n >= 99000 && n < 100000) return CATEGORIES.evaluation
      if (n < 70000) return CATEGORIES.procedure
    }
  }
  return CATEGORIES.other
}

export const ALL_CATEGORIES: ServiceCategory[] = Object.values(CATEGORIES)

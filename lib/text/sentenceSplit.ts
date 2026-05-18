// Shared sentence-fragment helpers for AI citation highlighting.
//
// AI quotes are often paraphrased or stitched together: ellipsis-joined
// fragments ("phrase one … phrase two") and run-together sentences that
// don't appear contiguously in the source (the underlying note has bullet
// markers, extra phrases between, etc.). We split each supporting text on
// ellipsis AND sentence boundaries so every cohesive piece can match
// independently when we look it up in the source document.
//
// Used by:
//   - components/pa/EvidenceCheckModal.tsx (docContainsSupport — routes a
//     citation to the doc that actually contains its quote)
//   - components/pa/DocumentPdfViewer.tsx (text-on-page fallback for
//     legacy clinical notes / extracted-text attachments)
//
// Replaces the previously-duplicated regex + filter logic that lived in
// both EvidenceCheckModal and the (now-deleted) NoteHighlighter.

// Sentence-boundary heuristic: ellipsis OR period/!/? followed by whitespace
// and a capital letter / digit / dash. Avoids splitting "Mr. Smith".
// Also splits on hard newlines.
const SENTENCE_SPLIT = /(?:\s*(?:\.{3,}|…)\s*)|(?:[.!?]\s+(?=[A-Z0-9-]))|\n+/g

// Fragments shorter than this are too generic to be a useful highlight target
// (e.g. "the", "and the patient") and produce false-positive matches.
export const MIN_FRAGMENT_LEN = 12

/**
 * Split a single supporting-text quote into the set of cohesive fragments
 * that can be matched verbatim against a source document.
 *
 * Each fragment has its trailing sentence punctuation trimmed so the
 * caller's substring/regex match doesn't fail when the source has a
 * trailing period that the split discarded.
 */
export function splitSupportingText(text: string): string[] {
  if (!text) return []
  const out: string[] = []
  for (const piece of text.split(SENTENCE_SPLIT)) {
    const trimmed = piece.trim().replace(/[.,;:!?]+$/, '').trim()
    if (trimmed.length >= MIN_FRAGMENT_LEN) out.push(trimmed)
  }
  return out
}

/**
 * Collect the unique fragments across many supporting-text quotes.
 * Order is preserved (longest fragments first — useful when building an
 * alternation regex so longer matches win over shorter overlapping ones).
 */
export function collectSupportingFragments(texts: readonly string[]): string[] {
  const set = new Set<string>()
  for (const t of texts) {
    for (const piece of splitSupportingText(t)) {
      set.add(piece)
    }
  }
  return Array.from(set).sort((a, b) => b.length - a.length)
}

/** Escape a string for safe interpolation into a regex. */
export function escapeForRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Build a case-insensitive alternation regex that matches any of the
 * supporting-text fragments. Returns null when the supporting texts produce
 * no fragments meeting the length threshold (caller should treat that as
 * "no highlights to render").
 */
export function buildSupportingTextRegex(texts: readonly string[]): RegExp | null {
  const fragments = collectSupportingFragments(texts)
  if (fragments.length === 0) return null
  return new RegExp(`(${fragments.map(escapeForRegex).join('|')})`, 'gi')
}

/**
 * Cheap "does this doc actually contain the supporting text?" check.
 * Used to route a citation to the doc that contains its quote when the AI
 * named the wrong source. Returns true as soon as any fragment matches.
 */
export function docContainsSupport(
  docText: string | null | undefined,
  supportingTexts: readonly string[]
): boolean {
  if (!docText) return false
  const lower = docText.toLowerCase()
  for (const text of supportingTexts) {
    for (const piece of splitSupportingText(text)) {
      if (lower.includes(piece.toLowerCase())) return true
    }
  }
  return false
}

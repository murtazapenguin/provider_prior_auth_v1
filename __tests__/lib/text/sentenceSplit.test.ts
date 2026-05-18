/**
 * __tests__/lib/text/sentenceSplit.test.ts
 *
 * Unit tests for the shared citation-fragment helpers in `lib/text/sentenceSplit.ts`.
 *
 * Background: pre-Phase-6, the same SPLIT regex + fragment-extraction logic
 * was duplicated between `components/ui/NoteHighlighter.tsx` and
 * `components/pa/EvidenceCheckModal.tsx`. Phase 6 / Session 7 (T8) deletes
 * NoteHighlighter and extracts the shared logic to `lib/text/sentenceSplit.ts`
 * so the surviving consumers — DocumentPdfViewer's text-on-page fallback and
 * EvidenceCheckModal's docContainsSupport router — share one definition.
 *
 * Maps to TC-IDs:
 *  - WF-PROV-citation-jump (citation routing depends on the fragment-match
 *    behavior these helpers encapsulate)
 */

import { describe, expect, it } from 'vitest'

import {
  MIN_FRAGMENT_LEN,
  buildSupportingTextRegex,
  collectSupportingFragments,
  docContainsSupport,
  escapeForRegex,
  splitSupportingText,
} from '@/lib/text/sentenceSplit'

describe('splitSupportingText', () => {
  it('returns [] for empty / nullish strings', () => {
    expect(splitSupportingText('')).toEqual([])
  })

  it('splits a multi-sentence quote into fragments >= MIN_FRAGMENT_LEN', () => {
    const text = 'Patient has chronic migraine. Failed amitriptyline trial.'
    const out = splitSupportingText(text)
    expect(out).toContain('Patient has chronic migraine')
    expect(out).toContain('Failed amitriptyline trial')
    // No fragment shorter than MIN_FRAGMENT_LEN should survive.
    for (const f of out) expect(f.length).toBeGreaterThanOrEqual(MIN_FRAGMENT_LEN)
  })

  it('drops fragments shorter than 12 characters', () => {
    const text = 'OK. The patient also has photophobia and phonophobia.'
    const out = splitSupportingText(text)
    // "OK" is too short — should not appear
    expect(out).not.toContain('OK')
    expect(out.some((f) => f.includes('photophobia'))).toBe(true)
  })

  it('handles ellipsis-stitched quotes', () => {
    const text = 'severe headache for three days … no prior history of similar headaches'
    const out = splitSupportingText(text)
    expect(out).toContain('severe headache for three days')
    expect(out).toContain('no prior history of similar headaches')
  })

  it('handles three-dot ellipsis as well as the unicode form', () => {
    const text = 'severe headache ... no prior history'
    const out = splitSupportingText(text)
    expect(out).toContain('severe headache')
    expect(out).toContain('no prior history')
  })

  it('does not split on "Mr." / "Dr." abbreviations followed by lowercase', () => {
    const text = 'Mr. smith reported chronic migraine and amitriptyline failure.'
    const out = splitSupportingText(text)
    // The regex requires a CAPITAL after the period; "smith" is lowercase, so
    // the whole sentence stays as one fragment.
    expect(out.length).toBe(1)
    expect(out[0]).toContain('Mr. smith reported')
  })

  it('strips trailing sentence punctuation from each fragment', () => {
    const text = 'Patient denies headache.'
    const out = splitSupportingText(text)
    expect(out).toEqual(['Patient denies headache'])
  })

  it('splits on hard newlines', () => {
    const text = 'first long enough sentence here\nsecond long enough sentence here'
    const out = splitSupportingText(text)
    expect(out).toContain('first long enough sentence here')
    expect(out).toContain('second long enough sentence here')
  })
})

describe('collectSupportingFragments', () => {
  it('deduplicates fragments across multiple supporting texts', () => {
    const a = 'Patient has chronic migraine. Failed amitriptyline.'
    const b = 'Patient has chronic migraine. Photophobia noted.'
    const out = collectSupportingFragments([a, b])
    // Same fragment from both inputs → one entry.
    const dupes = out.filter((f) => f === 'Patient has chronic migraine')
    expect(dupes.length).toBe(1)
  })

  it('sorts fragments longest-first so regex alternation prefers longer matches', () => {
    const out = collectSupportingFragments([
      'short fragment here',
      'this fragment is considerably longer than the other',
    ])
    // Two distinct fragments expected
    expect(out.length).toBe(2)
    // First one is the longer one
    expect(out[0].length).toBeGreaterThanOrEqual(out[1].length)
  })

  it('returns [] when all inputs are too short', () => {
    expect(collectSupportingFragments(['OK', 'yes', 'no'])).toEqual([])
  })
})

describe('escapeForRegex', () => {
  it('escapes regex metacharacters', () => {
    expect(escapeForRegex('a.b*c+d?')).toBe('a\\.b\\*c\\+d\\?')
    expect(escapeForRegex('(foo|bar)')).toBe('\\(foo\\|bar\\)')
  })

  it('leaves alphanumerics untouched', () => {
    expect(escapeForRegex('chronic migraine')).toBe('chronic migraine')
  })
})

describe('buildSupportingTextRegex', () => {
  it('returns null when no fragments meet the length threshold', () => {
    expect(buildSupportingTextRegex(['OK', 'yes'])).toBeNull()
  })

  it('matches any of the fragments case-insensitively', () => {
    const re = buildSupportingTextRegex(['Patient has chronic migraine. Failed amitriptyline trial.'])
    expect(re).not.toBeNull()
    expect(re!.test('the patient HAS chronic Migraine today')).toBe(true)
    re!.lastIndex = 0
    expect(re!.test('she had a successful amitriptyline trial yesterday')).toBe(false)
  })

  it('escapes regex metacharacters in the fragment', () => {
    // "(a special abbreviation)" contains parens — must be escaped or the
    // regex would treat them as a group.
    const re = buildSupportingTextRegex(['Diagnosis: chronic migraine (CM)'])
    expect(re).not.toBeNull()
    expect(re!.test('Diagnosis: chronic migraine (CM) per ICHD-3.')).toBe(true)
  })
})

describe('docContainsSupport', () => {
  const doc = `
    Chief Complaint: Severe headache for 3 days, worst-ever quality.
    HPI: New-onset thunderclap headache. Photophobia and phonophobia present.
    Plan: CT head without contrast ordered.
  `.trim()

  it('returns false when docText is null or empty', () => {
    expect(docContainsSupport(null, ['anything'])).toBe(false)
    expect(docContainsSupport('', ['anything'])).toBe(false)
  })

  it('returns false when no supporting fragment is found', () => {
    expect(docContainsSupport(doc, ['The patient enjoyed a walk in the park.'])).toBe(false)
  })

  it('returns true on a case-insensitive substring match of a long-enough fragment', () => {
    // "New-onset thunderclap headache" appears verbatim (modulo case) in the
    // HPI line — long enough (>= MIN_FRAGMENT_LEN) to drive a match.
    expect(docContainsSupport(doc, ['New-onset thunderclap headache'])).toBe(true)
  })

  it('matches any of multiple fragments (short-circuits on first hit)', () => {
    expect(
      docContainsSupport(doc, [
        'The patient enjoyed a walk in the park.',
        'CT head without contrast ordered',
      ])
    ).toBe(true)
  })

  it('does not match a fragment shorter than MIN_FRAGMENT_LEN', () => {
    // "CT head" alone is 7 chars — under MIN_FRAGMENT_LEN — and would
    // produce false positives across unrelated docs, so it's discarded.
    expect(docContainsSupport(doc, ['CT head'])).toBe(false)
  })
})

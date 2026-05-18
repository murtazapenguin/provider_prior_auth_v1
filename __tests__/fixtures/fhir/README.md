# FHIR test fixtures

Synthesized to match the FHIR R4 spec + Epic's documented sandbox quirks
(`Coverage.status` optional, `Encounter.period.end: null` for active visits,
polymorphic `Observation.value[x]`, etc.). Identifier values mirror the
shape of Epic's published sandbox examples
(<https://fhir.epic.com/Documentation?docId=testpatients>) without being
exact wire captures — live Epic sandbox verification is deferred to
`tasks/phase-6-epic-verification.md`.

Each file under this tree is a fixture for one resource type and one named
sandbox scenario. They drive the Vitest suites in `__tests__/lib/fhir/*` via
`fetchImpl` injection (no live network).

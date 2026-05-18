export class NoActiveCoverageError extends Error {
  readonly patientId: string
  readonly encounterDate: Date

  constructor(patientId: string, encounterDate: Date) {
    super(
      `No active primary coverage found for patient "${patientId}" on ${encounterDate.toISOString().slice(0, 10)}`
    )
    this.name = 'NoActiveCoverageError'
    this.patientId = patientId
    this.encounterDate = encounterDate
    // Maintains proper prototype chain in transpiled ES5 targets.
    Object.setPrototypeOf(this, NoActiveCoverageError.prototype)
  }
}

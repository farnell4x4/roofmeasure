/**
 * The whole-unit value shown in the measurement UI and used as the input to
 * measurement calculations. Keep every displayed measurement and calculation
 * on this helper so a future precision change has one source of truth.
 */
export function roundMeasurement(value: number) {
  return Number.isFinite(value) ? Math.round(value) : 0
}
